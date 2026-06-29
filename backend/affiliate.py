"""
Affiliate / referral system.

Keyed by ``device_id`` so it works for every player regardless of auth state
(Google, email, or Local-only via Gaming Hub).

Collections:
- ``affiliate_codes``      : { device_id (unique), code (unique), created_at }
- ``affiliate_redemptions``: { referrer_device_id, referee_device_id (unique),
                               code, referrer_granted, referee_granted, at }

Rewards (defaults the user signed off on):
- Referrer: +50 gems per referral, capped at MAX_GRANTS_PER_REFERRER
- Referee : +25 gems + $10k starter cash, one-time per device

Grants are fanned into the existing ``pending_grants`` collection so the
client picks them up via the unchanged ``/grants/claim`` poll on next tick.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/affiliate", tags=["affiliate"])

REFERRER_REWARD_GEMS = 50
REFEREE_REWARD_GEMS = 25
REFEREE_REWARD_CASH = 10_000
MAX_GRANTS_PER_REFERRER = 100
CODE_LEN = 8
CODE_ALPHABET = string.ascii_uppercase + string.digits


# ---------- Models ----------
class RedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    device_id: str = Field(min_length=1)
    player_name: Optional[str] = None


# ---------- DB injection (mirrors auth_email.py) ----------
_state: dict[str, Any] = {}


def attach(db: Any) -> None:
    _state["db"] = db


def _db() -> Any:
    db = _state.get("db")
    if db is None:
        raise RuntimeError("affiliate.attach(db) was never called")
    return db


async def ensure_indexes() -> None:
    db = _db()
    await db.affiliate_codes.create_index("device_id", unique=True, name="affcodes_device_uniq")
    await db.affiliate_codes.create_index("code", unique=True, name="affcodes_code_uniq")
    await db.affiliate_redemptions.create_index("referee_device_id", unique=True, name="affred_referee_uniq")
    await db.affiliate_redemptions.create_index("referrer_device_id", name="affred_referrer_idx")


# ---------- Internals ----------
def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


async def _ensure_code_for_device(device_id: str) -> str:
    """Get or create the device's unique invite code. Race-safe via the
    unique index on ``device_id`` — duplicate inserts hit DuplicateKeyError
    and we fall back to reading the winning row."""
    db = _db()
    existing = await db.affiliate_codes.find_one({"device_id": device_id}, {"_id": 0, "code": 1})
    if existing:
        return existing["code"]

    # Up to 20 attempts to avoid the (vanishingly small) collision case.
    from pymongo.errors import DuplicateKeyError

    for _ in range(20):
        code = _new_code()
        try:
            await db.affiliate_codes.insert_one({
                "device_id": device_id,
                "code": code,
                "created_at": datetime.now(timezone.utc),
            })
            return code
        except DuplicateKeyError:
            again = await db.affiliate_codes.find_one({"device_id": device_id}, {"_id": 0, "code": 1})
            if again:
                return again["code"]
            continue
    raise HTTPException(status_code=500, detail="Could not allocate invite code")


async def _stats_for(referrer_device_id: str) -> dict[str, int]:
    db = _db()
    count = await db.affiliate_redemptions.count_documents({"referrer_device_id": referrer_device_id})
    capped = min(count, MAX_GRANTS_PER_REFERRER)
    return {
        "referrals_count": count,
        "gems_earned": capped * REFERRER_REWARD_GEMS,
        "gems_per_referral": REFERRER_REWARD_GEMS,
        "cap": MAX_GRANTS_PER_REFERRER,
    }


async def _grant(device_id: str, *, gems: int = 0, cash: int = 0) -> None:
    if gems == 0 and cash == 0:
        return
    inc: dict[str, int] = {}
    if gems:
        inc["gems"] = gems
    if cash:
        inc["cash"] = cash
    await _db().pending_grants.update_one(
        {"device_id": device_id},
        {"$inc": inc},
        upsert=True,
    )


async def _record_redemption(
    *, referrer_device_id: str, referee_device_id: str, code: str,
    referrer_granted: bool, referee_granted: bool,
) -> None:
    from pymongo.errors import DuplicateKeyError
    try:
        await _db().affiliate_redemptions.insert_one({
            "referrer_device_id": referrer_device_id,
            "referee_device_id": referee_device_id,
            "code": code,
            "referrer_granted_gems": REFERRER_REWARD_GEMS if referrer_granted else 0,
            "referee_granted_gems": REFEREE_REWARD_GEMS if referee_granted else 0,
            "referee_granted_cash": REFEREE_REWARD_CASH if referee_granted else 0,
            "at": datetime.now(timezone.utc),
        })
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="You've already redeemed an invite code.")


async def _redeem(*, code: str, referee_device_id: str) -> dict[str, Any]:
    db = _db()
    code_norm = code.upper().strip()

    referrer = await db.affiliate_codes.find_one({"code": code_norm}, {"_id": 0, "device_id": 1})
    if not referrer:
        raise HTTPException(status_code=404, detail="That invite code doesn't exist.")
    if referrer["device_id"] == referee_device_id:
        raise HTTPException(status_code=400, detail="You can't redeem your own invite code.")

    if await db.affiliate_redemptions.find_one({"referee_device_id": referee_device_id}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="You've already redeemed an invite code.")

    referrer_count = await db.affiliate_redemptions.count_documents(
        {"referrer_device_id": referrer["device_id"]},
    )
    referrer_eligible = referrer_count < MAX_GRANTS_PER_REFERRER

    await _record_redemption(
        referrer_device_id=referrer["device_id"],
        referee_device_id=referee_device_id,
        code=code_norm,
        referrer_granted=referrer_eligible,
        referee_granted=True,
    )

    if referrer_eligible:
        await _grant(referrer["device_id"], gems=REFERRER_REWARD_GEMS)
    await _grant(referee_device_id, gems=REFEREE_REWARD_GEMS, cash=REFEREE_REWARD_CASH)

    return {
        "ok": True,
        "referrer_gems_awarded": REFERRER_REWARD_GEMS if referrer_eligible else 0,
        "referee_gems_awarded": REFEREE_REWARD_GEMS,
        "referee_cash_awarded": REFEREE_REWARD_CASH,
        "referrer_capped": not referrer_eligible,
    }


# ---------- Public for auth_email.py ----------
async def apply_referral_on_signup(*, code: str, referee_device_id: str, referee_name: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Called from /auth/email/register so first-time signups can attach
    a referral atomically with account creation. Returns the redemption
    result, or None if no rewards were granted (already redeemed etc).
    Errors bubble up as HTTPException; the auth handler chooses to swallow."""
    return await _redeem(code=code, referee_device_id=referee_device_id)


# ---------- Routes ----------
@router.get("/me")
async def my_affiliate(device_id: str):
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    code = await _ensure_code_for_device(device_id)
    stats = await _stats_for(device_id)
    redeemed = await _db().affiliate_redemptions.find_one(
        {"referee_device_id": device_id},
        {"_id": 0, "code": 1, "at": 1},
    )
    return {
        "code": code,
        "redeemed_code": redeemed["code"] if redeemed else None,
        **stats,
        "share_url_path": f"/?invite={code}",
    }


@router.post("/redeem")
async def redeem(payload: RedeemIn):
    return await _redeem(code=payload.code, referee_device_id=payload.device_id)
