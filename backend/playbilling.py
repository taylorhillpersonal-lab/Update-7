"""Google Play Billing — server-side purchase verification.

The Android client (expo-iap) initiates the purchase, receives a
`purchaseToken` + `productId` from Google Play, and POSTs them here.
We verify the purchase against the Android Publisher API and credit the
user only after Google confirms it's real and not already
consumed/refunded.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments/playbilling", tags=["playbilling"])

ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"

# Lazy/optional Google API imports — server still boots fine even if the
# service-account JSON isn't yet provided by the operator.
_publisher_client = None


def _get_publisher_client():
    global _publisher_client
    if _publisher_client is not None:
        return _publisher_client
    json_path = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH", "").strip()
    if not json_path or not os.path.isfile(json_path):
        raise HTTPException(
            status_code=503,
            detail=(
                "Play Billing not configured: set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH "
                "to the path of your Google Cloud service-account JSON key."
            ),
        )
    try:
        from google.oauth2 import service_account  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"google-api-python-client not installed: {exc}")
    credentials = service_account.Credentials.from_service_account_file(
        json_path, scopes=[ANDROID_PUBLISHER_SCOPE],
    )
    _publisher_client = build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)
    return _publisher_client


class PlayBillingVerifyRequest(BaseModel):
    package_name: str
    product_id: str
    purchase_token: str
    device_id: str


def _setup(server_module):  # called once from server.py at import time
    """Register the router with the FastAPI api_router and expose helpers
    that need access to the existing Mongo collections + catalog + grants
    logic without creating a circular import."""

    db = server_module.db
    now_iso = server_module.now_iso
    store_catalog = server_module.STORE_CATALOG
    resolve_item = server_module._resolve_item  # async

    @router.post("/verify")
    async def verify_playbilling_purchase(req: PlayBillingVerifyRequest) -> Dict[str, Any]:
        if not req.purchase_token or not req.product_id or not req.package_name:
            raise HTTPException(status_code=400, detail="Missing required field")
        if req.product_id not in store_catalog:
            raise HTTPException(status_code=400, detail=f"Unknown product_id: {req.product_id}")

        # Reject re-purchase of one-time packs (remove_ads, starter bundle,
        # follow-up bundle) — but never block an idempotent retry of the
        # same purchaseToken (that path returns "duplicate" below).
        ONE_TIME = {"remove_ads", "bundle_starter", "bundle_followup"}
        if req.product_id in ONE_TIME:
            owned_paid = await db.payment_transactions.find_one(
                {
                    "device_id": req.device_id,
                    "pack_id": req.product_id,
                    "status": "paid",
                    "purchase_token": {"$ne": req.purchase_token},
                },
                {"_id": 1},
            )
            owned_grant = await db.admin_package_grants.find_one(
                {"device_id": req.device_id, "pack_id": req.product_id},
                {"_id": 1},
            )
            if owned_paid or owned_grant:
                raise HTTPException(status_code=409, detail="Already purchased")

        # Idempotent replay protection — re-confirming the same purchaseToken
        # just returns the existing record.
        existing = await db.payment_transactions.find_one(
            {"purchase_token": req.purchase_token, "provider": "play_billing"},
            {"_id": 0},
        )
        if existing:
            return {
                "status": "duplicate",
                "session_id": existing.get("session_id"),
                "payment_status": existing.get("status"),
                "gems": int(existing.get("gems", 0) or 0),
                "investors": int(existing.get("investors", 0) or 0),
                "keys": int(existing.get("keys", 0) or 0),
                "remove_ads": bool(existing.get("remove_ads", False)),
                "product": existing.get("product", "gems"),
            }

        publisher = _get_publisher_client()
        try:
            purchase = (
                publisher.purchases()
                .products()
                .get(packageName=req.package_name, productId=req.product_id, token=req.purchase_token)
                .execute()
            )
        except Exception as exc:
            logger.exception("Play Billing verify failed")
            raise HTTPException(status_code=400, detail=f"androidpublisher.get failed: {exc}")

        # Google: purchaseState 0 = purchased, 1 = cancelled, 2 = pending.
        purchase_state = purchase.get("purchaseState")
        if purchase_state == 2:
            raise HTTPException(status_code=202, detail="Purchase is pending — try again after confirmation")
        if purchase_state != 0:
            raise HTTPException(status_code=400, detail=f"Purchase not in PURCHASED state ({purchase_state})")
        # consumptionState 1 = consumed (already credited). Block double-credit.
        if purchase.get("consumptionState") == 1:
            raise HTTPException(status_code=400, detail="Purchase already consumed")

        item = await resolve_item(req.product_id)
        # First-purchase 2× doubler applies ONLY to plain gem packs (see
        # server.py rationale). Bundles + loot-key + remove-ads have fixed
        # advertised quantities and must be credited verbatim.
        eligible_for_doubler = item.get("product") == "gems"
        player_doc = await db.players.find_one(
            {"device_id": req.device_id}, {"_id": 0, "first_purchase_used": 1},
        )
        first_bonus = eligible_for_doubler and not bool(
            player_doc and player_doc.get("first_purchase_used")
        )
        mult = 2 if first_bonus else 1
        gems_grant = int(item["gems"]) * mult
        inv_grant = int(item["investors"]) * mult
        keys_grant = int(item["keys"]) * mult

        # Reuse session_id namespace, prefix `pb_` so it's distinguishable.
        import uuid as _uuid
        session_id = f"pb_{_uuid.uuid4().hex}"

        txn_doc = {
            "session_id": session_id,
            "device_id": req.device_id,
            "pack_id": req.product_id,
            "product": item["product"],
            "gems": gems_grant,
            "investors": inv_grant,
            "keys": keys_grant,
            "remove_ads": item["remove_ads"],
            "amount_cents": item["price_cents"],
            "first_purchase_bonus": first_bonus,
            "status": "paid",
            "provider": "play_billing",
            "purchase_token": req.purchase_token,
            "package_name": req.package_name,
            "google_purchase_state": purchase_state,
            "google_consumption_state": purchase.get("consumptionState"),
            "google_acknowledgement_state": purchase.get("acknowledgementState"),
            "google_purchase_time_millis": purchase.get("purchaseTimeMillis"),
            "google_order_id": purchase.get("orderId"),
            "created_at": now_iso(),
            "paid_at": now_iso(),
        }
        await db.payment_transactions.insert_one(txn_doc)
        if first_bonus:
            await db.players.update_one(
                {"device_id": req.device_id},
                {"$set": {"first_purchase_used": True, "first_purchase_used_at": now_iso()}},
                upsert=True,
            )

        # Acknowledge the purchase on Google's side so it isn't auto-refunded
        # after 3 days. Consumables will additionally be CONSUMED by the
        # client's finishTransaction(isConsumable=true) call; we acknowledge
        # here as a safety net in case the client crashes before that.
        try:
            if purchase.get("acknowledgementState") != 1:
                publisher.purchases().products().acknowledge(
                    packageName=req.package_name,
                    productId=req.product_id,
                    token=req.purchase_token,
                    body={"developerPayload": session_id},
                ).execute()
        except Exception as exc:
            logger.warning("Play Billing acknowledge failed (non-fatal): %s", exc)

        return {
            "status": "verified",
            "session_id": session_id,
            "payment_status": "paid",
            "gems": gems_grant,
            "investors": inv_grant,
            "keys": keys_grant,
            "remove_ads": item["remove_ads"],
            "product": item["product"],
            "first_purchase_bonus": first_bonus,
            "is_consumable": req.product_id != "remove_ads",
        }

    @router.get("/config")
    async def playbilling_config() -> Dict[str, Any]:
        json_path = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH", "").strip()
        return {
            "package_name": os.environ.get("ANDROID_PACKAGE_NAME", "com.tycoonempire.app"),
            "configured": bool(json_path and os.path.isfile(json_path)),
            "product_ids": list(store_catalog.keys()),
            "non_consumable_product_ids": ["remove_ads"],
        }

    return router
