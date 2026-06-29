/**
 * Samsung Gaming Hub link detection.
 *
 * Contract: if the app is opened with `?source=gaming_hub` in the URL
 * (web) or as a deep-link query param (mobile), we treat the device as
 * "connected to a gaming hub account" and unlock the Local-only sign-in
 * path. The flag is persisted, so once a hub has handed the user over the
 * connection sticks across launches until storage is cleared.
 *
 * NOTE: This is the contract Gaming Hub partners can target today; if/when
 * Samsung exposes a richer hand-off (e.g. an identity token), we extend
 * this module instead of touching screens.
 */
import { Platform } from "react-native";
import * as Linking from "expo-linking";

import { storage } from "@/src/utils/storage";

const HUB_FLAG_KEY = "tycoon_hub_connected";
const HUB_SOURCE_VALUE = "gaming_hub";
const SOURCE_PARAM = "source";

function parseSourceFromUrl(url: string): string | null {
  if (!url) return null;
  // Match `?source=gaming_hub` or `&source=gaming_hub` (case-insensitive
  // on the key, case-sensitive on the value to keep partner contracts
  // explicit).
  const m = url.match(/[?&#]source=([^&#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Snapshot of the hub state once detection settles. */
export type HubState = {
  connected: boolean;
  /** Detection finished — UI may now decide which auth path to show. */
  ready: boolean;
};

export async function isHubConnected(): Promise<boolean> {
  const v = (await storage.getItem(HUB_FLAG_KEY, "")) ?? "";
  return v === "1";
}

/** Persist the hub-connected flag. Called when the source param is seen. */
async function setHubConnected(): Promise<void> {
  await storage.setItem(HUB_FLAG_KEY, "1");
}

/** Resolve the cold-start URL — web URL on web, initial deep link on native. */
async function getEntryUrl(): Promise<string | null> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.search + window.location.hash;
  }
  return await Linking.getInitialURL();
}

/**
 * One-shot bootstrap: read the entry URL, persist the flag if matched,
 * and report the current state. Safe to call on every cold start —
 * once persisted the flag stays set.
 */
export async function detectHubOnBoot(): Promise<HubState> {
  const url = (await getEntryUrl()) ?? "";
  const source = parseSourceFromUrl(url);
  if (source === HUB_SOURCE_VALUE) {
    await setHubConnected();
    return { connected: true, ready: true };
  }
  return { connected: await isHubConnected(), ready: true };
}

/** Returns the invite code from the entry URL (?invite=ABCD1234), if any. */
export async function readInviteFromEntryUrl(): Promise<string | null> {
  const url = (await getEntryUrl()) ?? "";
  const m = url.match(/[?&#]invite=([A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

export const HUB_KEYS = { flag: HUB_FLAG_KEY, source: SOURCE_PARAM, value: HUB_SOURCE_VALUE };
