// Google Play Billing hook — Android-only. On non-Android platforms the
// shop screen continues to use the existing Google Pay web checkout flow.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// Lazy require so that web/iOS bundles don't fail if expo-iap can't link.
let IAP: any = null;
if (Platform.OS === "android") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    IAP = require("expo-iap");
  } catch {
    IAP = null;
  }
}

export type PlayBillingProduct = {
  id: string;
  title: string;
  description: string;
  displayPrice: string;
};

export type PlayBillingPurchaseResult = {
  status: "verified" | "duplicate" | "cancelled" | "error";
  session_id?: string;
  payment_status?: string;
  gems?: number;
  investors?: number;
  keys?: number;
  remove_ads?: boolean;
  product?: string;
  first_purchase_bonus?: boolean;
  is_consumable?: boolean;
  message?: string;
};

const PRODUCT_IDS = [
  "pack_xs", "pack_s", "pack_m", "pack_l", "pack_xl",
  "remove_ads",
  "keys_s", "keys_m", "keys_l",
  "bundle_starter", "bundle_followup", "bundle_value", "bundle_mogul", "bundle_ultimate",
];

const PACKAGE_NAME = "com.tycoonempire.app"; // keep in sync with app.json -> android.package

async function verifyOnBackend(productId: string, purchaseToken: string, deviceId: string) {
  const res = await fetch(`${BASE}/api/payments/playbilling/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      package_name: PACKAGE_NAME,
      product_id: productId,
      purchase_token: purchaseToken,
      device_id: deviceId,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail || `verify failed (${res.status})`);
  return body as PlayBillingPurchaseResult;
}

export function usePlayBilling(deviceId: string | undefined) {
  const [available, setAvailable] = useState(false);
  const [products, setProducts] = useState<PlayBillingProduct[]>([]);
  const subsRef = useRef<{ remove: () => void }[]>([]);
  const pendingRef = useRef<Map<string, (r: PlayBillingPurchaseResult) => void>>(new Map());

  useEffect(() => {
    if (Platform.OS !== "android" || !IAP) return;
    let cancelled = false;

    const init = async () => {
      try {
        await IAP.initConnection();
        if (cancelled) return;
        const fetched = await IAP.fetchProducts({ skus: PRODUCT_IDS, type: "inapp" }).catch(
          // older expo-iap versions used getProducts
          async () => IAP.getProducts?.({ skus: PRODUCT_IDS }) ?? [],
        );
        if (cancelled) return;
        const list: PlayBillingProduct[] = (Array.isArray(fetched) ? fetched : fetched?.products ?? []).map(
          (p: any) => ({
            id: p.id ?? p.productId ?? p.sku,
            title: p.title ?? p.name ?? p.id,
            description: p.description ?? "",
            displayPrice: p.displayPrice ?? p.localizedPrice ?? p.price ?? "",
          }),
        );
        setProducts(list);
        setAvailable(true);

        const updateSub = IAP.purchaseUpdatedListener?.(async (purchase: any) => {
          const productId = purchase.productId ?? purchase.id;
          const purchaseToken = purchase.purchaseToken ?? purchase.transactionReceipt;
          if (!deviceId || !productId || !purchaseToken) return;
          let result: PlayBillingPurchaseResult;
          try {
            result = await verifyOnBackend(productId, purchaseToken, deviceId);
          } catch (e: any) {
            result = { status: "error", message: e?.message || "verify failed" };
          }
          if (result.status === "verified" || result.status === "duplicate") {
            try {
              const isConsumable = productId !== "remove_ads";
              await IAP.finishTransaction?.({ purchase, isConsumable });
            } catch {
              /* non-fatal */
            }
          }
          const cb = pendingRef.current.get(productId);
          if (cb) {
            cb(result);
            pendingRef.current.delete(productId);
          }
        });
        const errSub = IAP.purchaseErrorListener?.((err: any) => {
          // Resolve any waiter for any product with a cancelled/error result.
          const msg = err?.message || "purchase error";
          pendingRef.current.forEach((cb) => cb({ status: err?.code === "E_USER_CANCELLED" ? "cancelled" : "error", message: msg }));
          pendingRef.current.clear();
        });
        if (updateSub) subsRef.current.push(updateSub);
        if (errSub) subsRef.current.push(errSub);
      } catch {
        setAvailable(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      subsRef.current.forEach((s) => { try { s.remove?.(); } catch { /* */ } });
      subsRef.current = [];
      try { IAP.endConnection?.(); } catch { /* */ }
    };
  }, [deviceId]);

  const buy = useCallback(
    async (productId: string): Promise<PlayBillingPurchaseResult> => {
      if (Platform.OS !== "android" || !IAP || !available) {
        return { status: "error", message: "Play Billing unavailable on this platform" };
      }
      if (!deviceId) return { status: "error", message: "Device id missing" };
      return new Promise<PlayBillingPurchaseResult>((resolve) => {
        pendingRef.current.set(productId, resolve);
        try {
          const req = { request: { skus: [productId], sku: productId }, type: "inapp" };
          (IAP.requestPurchase?.(req) ?? IAP.requestProductPurchase?.(productId))?.catch?.((err: any) => {
            pendingRef.current.delete(productId);
            resolve({ status: "error", message: err?.message || "request failed" });
          });
        } catch (e: any) {
          pendingRef.current.delete(productId);
          resolve({ status: "error", message: e?.message || "request failed" });
        }
      });
    },
    [available, deviceId],
  );

  const restore = useCallback(async (): Promise<string[]> => {
    if (Platform.OS !== "android" || !IAP || !deviceId) return [];
    try {
      const purchases = (await (IAP.getAvailablePurchases?.() ?? IAP.getPurchaseHistories?.() ?? [])) as any[];
      const restored: string[] = [];
      for (const p of purchases) {
        const productId = p.productId ?? p.id;
        const purchaseToken = p.purchaseToken ?? p.transactionReceipt;
        if (!productId || !purchaseToken) continue;
        try {
          const r = await verifyOnBackend(productId, purchaseToken, deviceId);
          if (r.status === "verified" || r.status === "duplicate") restored.push(productId);
        } catch {
          /* ignore */
        }
      }
      return restored;
    } catch {
      return [];
    }
  }, [deviceId]);

  return { isAndroid: Platform.OS === "android", available, products, buy, restore };
}
