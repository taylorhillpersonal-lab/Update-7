from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
from html import escape
import time
import uuid as uuidlib
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent

# ----- Centralised API keys ------------------------------------------------
# `backend/api_keys.py` is the single source of truth for every third-party
# secret (Stripe, Resend, AdMob, etc.). On import we run its sync engine,
# which fans the values out to backend/.env, frontend/app.json, and the
# relevant frontend TS files. That way editing `api_keys.py` is the ONLY
# step the operator needs to update keys everywhere in the app.
try:
    from . import api_keys as _api_keys  # type: ignore  # noqa: E402
except ImportError:
    import api_keys as _api_keys  # type: ignore  # noqa: E402

try:
    _api_keys.sync_all()
except Exception as _e:  # pragma: no cover - never crash startup on a sync issue
    logging.getLogger(__name__).warning("api_keys sync_all() failed: %s", _e)

# Re-load .env AFTER the sync so any freshly-written values take effect.
load_dotenv(ROOT_DIR / '.env', override=True)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def _ws_ip(ws: WebSocket) -> str:
    xff = ws.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return ws.client.host if ws.client else ""


# ---------- Models ----------
class SyncRequest(BaseModel):
    device_id: str
    name: str = "Anonymous Tycoon"
    net_worth: float = 0
    prestige_points: int = 0
    cash: float = 0
    gems: int = 0
    total_levels: int = 0
    save_data: Optional[Dict[str, Any]] = None
    achievements: Optional[List[str]] = None


class Profile(BaseModel):
    device_id: str
    name: str
    net_worth: float
    prestige_points: int
    cash: float = 0
    gems: int = 0
    total_levels: int = 0
    updated_at: str


class LeaderboardEntry(Profile):
    rank: int


class LeaderboardResponse(BaseModel):
    entries: List[LeaderboardEntry]
    me: Optional[LeaderboardEntry] = None


METRIC_FIELDS = {
    "net_worth": "net_worth",
    "cash": "cash",
    "gems": "gems",
    "levels": "total_levels",
    "investors": "prestige_points",
}


def _entry(doc: Dict[str, Any], rank: int) -> "LeaderboardEntry":
    return LeaderboardEntry(
        device_id=doc.get("device_id", ""),
        name=doc.get("name", "Anonymous Tycoon"),
        net_worth=float(doc.get("net_worth", 0)),
        prestige_points=int(doc.get("prestige_points", 0)),
        cash=float(doc.get("cash", 0)),
        gems=int(doc.get("gems", 0)),
        total_levels=int(doc.get("total_levels", 0)),
        updated_at=doc.get("updated_at", ""),
        rank=rank,
    )


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Idle Business Tycoon API"}


@api_router.post("/sync", response_model=Profile)
async def sync_profile(req: SyncRequest, request: Request):
    name = (req.name or "Anonymous Tycoon").strip()[:24] or "Anonymous Tycoon"
    update = {
        "device_id": req.device_id,
        "name": name,
        "net_worth": float(req.net_worth),
        "prestige_points": int(req.prestige_points),
        "cash": float(req.cash),
        "gems": int(req.gems),
        "total_levels": int(req.total_levels),
        "updated_at": now_iso(),
        "last_ip": _client_ip(request),
    }
    if req.achievements is not None:
        update["achievements"] = [str(a) for a in req.achievements][:200]
    if req.save_data is not None:
        update["save_data"] = req.save_data

    await db.players.update_one(
        {"device_id": req.device_id},
        {"$set": update},
        upsert=True,
    )
    return Profile(**{k: update[k] for k in (
        "device_id", "name", "net_worth", "prestige_points",
        "cash", "gems", "total_levels", "updated_at",
    )})


@api_router.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(metric: str = "net_worth", limit: int = 100, device_id: Optional[str] = None):
    field = METRIC_FIELDS.get(metric, "net_worth")
    cursor = db.players.find(
        {},
        {"_id": 0, "save_data": 0},
    ).sort(field, -1).limit(min(limit, 200))
    entries: List[LeaderboardEntry] = []
    me: Optional[LeaderboardEntry] = None
    rank = 1
    async for doc in cursor:
        entry = _entry(doc, rank)
        entries.append(entry)
        if device_id and doc.get("device_id") == device_id:
            me = entry
        rank += 1
    # If the player isn't in the visible top list, compute their true rank.
    if device_id and me is None:
        my = await db.players.find_one({"device_id": device_id}, {"_id": 0, "save_data": 0})
        if my:
            my_val = float(my.get(field, 0))
            higher = await db.players.count_documents({field: {"$gt": my_val}})
            me = _entry(my, higher + 1)
    return LeaderboardResponse(entries=entries, me=me)


@api_router.get("/player/{device_id}")
async def get_player(device_id: str):
    doc = await db.players.find_one({"device_id": device_id}, {"_id": 0, "save_data": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Player not found")
    city = await db.cities.find_one({"member_ids": device_id}, {"_id": 0, "name": 1, "tag": 1})
    doc["city_name"] = city["name"] if city else None
    doc["city_tag"] = city.get("tag") if city else None
    return doc


# ---------- Cities (clans) ----------
CITY_BOOST_PER_MEMBER = 0.02   # +2% income per member
CITY_BOOST_MAX_MEMBERS = 10    # capped at +20%
CITY_PRIZE_POOL = 25000        # weekly gem pool (display)
CITY_FOUND_COST = 1000         # gems to found a City (deducted client-side)
# Shared, gem-purchased City upgrades that boost EVERY member's income.
CITY_UPGRADE_PER_LEVEL = 0.03  # +3% income to all citizens per level
CITY_UPGRADE_BASE_COST = 500   # gems for the first upgrade
CITY_UPGRADE_GROWTH = 1.5      # cost multiplier per level
CITY_UPGRADE_MAX_LEVEL = 25    # caps at +75%


class CityCreate(BaseModel):
    device_id: str
    name: str
    tag: str = ""


class CityAction(BaseModel):
    device_id: str


def upgrade_cost(level: int) -> int:
    """Gem cost to buy the next City upgrade given the current level."""
    raw = CITY_UPGRADE_BASE_COST * (CITY_UPGRADE_GROWTH ** level)
    return int(round(raw / 10) * 10)


def member_boost(member_count: int) -> float:
    return round(min(member_count, CITY_BOOST_MAX_MEMBERS) * CITY_BOOST_PER_MEMBER, 3)


def city_boost(member_count: int, upgrade_level: int = 0) -> float:
    return round(1 + member_boost(member_count) + upgrade_level * CITY_UPGRADE_PER_LEVEL, 3)


async def build_city_detail(city: Dict[str, Any]) -> Dict[str, Any]:
    member_ids = city.get("member_ids", [])
    upgrade_level = int(city.get("upgrade_level", 0))
    cursor = db.players.find({"device_id": {"$in": member_ids}}, {"_id": 0, "save_data": 0})
    members = []
    total = 0.0
    async for p in cursor:
        nw = float(p.get("net_worth", 0))
        total += nw
        members.append({
            "device_id": p.get("device_id"),
            "name": p.get("name", "Anonymous Tycoon"),
            "net_worth": nw,
            "prestige_points": int(p.get("prestige_points", 0)),
            "is_mayor": p.get("device_id") == city.get("mayor_device_id"),
        })
    members.sort(key=lambda m: m["net_worth"], reverse=True)
    maxed = upgrade_level >= CITY_UPGRADE_MAX_LEVEL

    # Pending join requests (only meaningful to the Mayor). Resolve names.
    req_ids = city.get("join_requests", [])
    pending_requests = []
    if req_ids:
        name_map: Dict[str, Dict[str, Any]] = {}
        rc = db.players.find({"device_id": {"$in": req_ids}}, {"_id": 0, "save_data": 0})
        async for p in rc:
            name_map[p.get("device_id")] = p
        for rid in req_ids:
            p = name_map.get(rid, {})
            pending_requests.append({
                "device_id": rid,
                "name": p.get("name", "Anonymous Tycoon"),
                "net_worth": float(p.get("net_worth", 0)),
                "prestige_points": int(p.get("prestige_points", 0)),
            })

    return {
        "id": city["id"],
        "name": city["name"],
        "tag": city.get("tag", ""),
        "mayor_device_id": city.get("mayor_device_id"),
        "member_count": len(member_ids),
        "boost": city_boost(len(member_ids), upgrade_level),
        "member_boost": member_boost(len(member_ids)),
        "upgrade_level": upgrade_level,
        "upgrade_boost": round(upgrade_level * CITY_UPGRADE_PER_LEVEL, 3),
        "next_upgrade_cost": None if maxed else upgrade_cost(upgrade_level),
        "upgrade_maxed": maxed,
        "total_net_worth": total,
        "members": members,
        "join_policy": city.get("join_policy", "manual"),
        "pending_requests": pending_requests,
        "pending_count": len(pending_requests),
    }


@api_router.get("/cities/mine")
async def my_city(device_id: str):
    city = await db.cities.find_one({"member_ids": device_id})
    if not city:
        return {"city": None}
    return {"city": await build_city_detail(city)}


@api_router.get("/cities")
async def list_cities(limit: int = 50, device_id: Optional[str] = None):
    cities = [c async for c in db.cities.find({})]
    out = []
    for c in cities:
        detail = await build_city_detail(c)
        out.append({
            "id": detail["id"],
            "name": detail["name"],
            "tag": detail["tag"],
            "member_count": detail["member_count"],
            "boost": detail["boost"],
            "total_net_worth": detail["total_net_worth"],
            "join_policy": detail["join_policy"],
            "requested": bool(device_id) and device_id in c.get("join_requests", []),
        })
    out.sort(key=lambda c: c["total_net_worth"], reverse=True)
    for i, c in enumerate(out):
        c["rank"] = i + 1
    return {"cities": out[:min(limit, 100)], "prize_pool": CITY_PRIZE_POOL}


@api_router.post("/cities")
async def create_city(req: CityCreate):
    name = req.name.strip()[:24]
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if await db.cities.find_one({"member_ids": req.device_id}):
        raise HTTPException(status_code=400, detail="You're already in a City")
    if await db.cities.find_one({"name_lower": name.lower()}):
        raise HTTPException(status_code=400, detail="That City name is taken")
    city = {
        "id": uuidlib.uuid4().hex,
        "name": name,
        "name_lower": name.lower(),
        "tag": req.tag.strip()[:5].upper(),
        "mayor_device_id": req.device_id,
        "member_ids": [req.device_id],
        "upgrade_level": 0,
        "join_policy": "manual",
        "join_requests": [],
        "created_at": now_iso(),
    }
    await db.cities.insert_one(dict(city))
    await db.players.update_one({"device_id": req.device_id}, {"$set": {"city_id": city["id"]}}, upsert=True)
    return await build_city_detail(city)


@api_router.post("/cities/{cid}/join")
async def join_city(cid: str, req: CityAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    # Already a member? just return the city.
    if req.device_id in city.get("member_ids", []):
        return {"status": "joined", "city": await build_city_detail(city)}

    policy = city.get("join_policy", "manual")
    if policy == "open":
        # leave any existing city first, then join immediately
        await db.cities.update_many({"member_ids": req.device_id}, {"$pull": {"member_ids": req.device_id}})
        await db.cities.update_one({"id": cid}, {"$addToSet": {"member_ids": req.device_id}, "$pull": {"join_requests": req.device_id}})
        await db.players.update_one({"device_id": req.device_id}, {"$set": {"city_id": cid}}, upsert=True)
        await _reconcile_vacated_cities(req.device_id, keep=cid)
        fresh = await db.cities.find_one({"id": cid})
        return {"status": "joined", "city": await build_city_detail(fresh)}

    # Manual approval: queue a join request for the Mayor to approve.
    await db.cities.update_one({"id": cid}, {"$addToSet": {"join_requests": req.device_id}})
    return {"status": "requested"}


@api_router.post("/cities/{cid}/cancel-request")
async def cancel_join_request(cid: str, req: CityAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    await db.cities.update_one({"id": cid}, {"$pull": {"join_requests": req.device_id}})
    return {"status": "cancelled"}


class RequestAction(BaseModel):
    device_id: str          # the Mayor making the decision
    target_device_id: str   # the applicant being approved/rejected


@api_router.post("/cities/{cid}/requests/approve")
async def approve_request(cid: str, req: RequestAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    if city.get("mayor_device_id") != req.device_id:
        raise HTTPException(status_code=403, detail="Only the Mayor can approve members")
    if req.target_device_id not in city.get("join_requests", []):
        raise HTTPException(status_code=404, detail="No pending request from that player")
    # remove applicant from any current membership, add to this city
    await db.cities.update_many({"member_ids": req.target_device_id}, {"$pull": {"member_ids": req.target_device_id}})
    await db.cities.update_one(
        {"id": cid},
        {"$addToSet": {"member_ids": req.target_device_id}, "$pull": {"join_requests": req.target_device_id}},
    )
    await db.players.update_one({"device_id": req.target_device_id}, {"$set": {"city_id": cid}}, upsert=True)
    await _reconcile_vacated_cities(req.target_device_id, keep=cid)
    fresh = await db.cities.find_one({"id": cid})
    return await build_city_detail(fresh)


@api_router.post("/cities/{cid}/requests/reject")
async def reject_request(cid: str, req: RequestAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    if city.get("mayor_device_id") != req.device_id:
        raise HTTPException(status_code=403, detail="Only the Mayor can manage requests")
    await db.cities.update_one({"id": cid}, {"$pull": {"join_requests": req.target_device_id}})
    fresh = await db.cities.find_one({"id": cid})
    return await build_city_detail(fresh)


@api_router.post("/cities/{cid}/kick")
async def kick_member(cid: str, req: RequestAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    if city.get("mayor_device_id") != req.device_id:
        raise HTTPException(status_code=403, detail="Only the Mayor can remove members")
    if req.target_device_id == city.get("mayor_device_id"):
        raise HTTPException(status_code=400, detail="The Mayor can't be removed")
    if req.target_device_id not in city.get("member_ids", []):
        raise HTTPException(status_code=404, detail="That player isn't in your City")
    await db.cities.update_one({"id": cid}, {"$pull": {"member_ids": req.target_device_id}})
    await db.players.update_one({"device_id": req.target_device_id}, {"$set": {"city_id": None}})
    fresh = await db.cities.find_one({"id": cid})
    return await build_city_detail(fresh)


class PolicyReq(BaseModel):
    device_id: str
    join_policy: str


@api_router.post("/cities/{cid}/policy")
async def set_city_policy(cid: str, req: PolicyReq):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    if city.get("mayor_device_id") != req.device_id:
        raise HTTPException(status_code=403, detail="Only the Mayor can change the join policy")
    policy = req.join_policy if req.join_policy in ("open", "manual") else "manual"
    update: Dict[str, Any] = {"$set": {"join_policy": policy}}
    # Switching to open auto-admits everyone who was waiting.
    if policy == "open":
        waiting = city.get("join_requests", [])
        if waiting:
            await db.cities.update_many({"member_ids": {"$in": waiting}}, {"$pull": {"member_ids": {"$in": waiting}}})
            await db.cities.update_one({"id": cid}, {"$addToSet": {"member_ids": {"$each": waiting}}})
            await db.players.update_many({"device_id": {"$in": waiting}}, {"$set": {"city_id": cid}})
            update["$set"]["join_requests"] = []
    await db.cities.update_one({"id": cid}, update)
    fresh = await db.cities.find_one({"id": cid})
    return await build_city_detail(fresh)


@api_router.post("/cities/{cid}/leave")
async def leave_city(cid: str, req: CityAction):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    await db.cities.update_one({"id": cid}, {"$pull": {"member_ids": req.device_id}})
    await db.players.update_one({"device_id": req.device_id}, {"$set": {"city_id": None}})
    await _reconcile_vacated_cities(req.device_id, keep=None)
    return {"ok": True}


@api_router.get("/cities/{cid}")
async def city_detail(cid: str):
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    return await build_city_detail(city)


@api_router.post("/cities/{cid}/upgrade")
async def upgrade_city(cid: str, req: CityAction):
    """Buy a shared City upgrade that boosts every member's income.
    Gems are deducted client-side; this persists the shared upgrade level."""
    city = await db.cities.find_one({"id": cid})
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    if req.device_id not in city.get("member_ids", []):
        raise HTTPException(status_code=403, detail="Join the City first")
    level = int(city.get("upgrade_level", 0))
    if level >= CITY_UPGRADE_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="City is fully upgraded")
    await db.cities.update_one({"id": cid}, {"$inc": {"upgrade_level": 1}})
    fresh = await db.cities.find_one({"id": cid})
    return await build_city_detail(fresh)


async def _reconcile_vacated_cities(device_id: str, keep: Optional[str]):
    async for c in db.cities.find({}):
        if c["id"] == keep:
            continue
        members = c.get("member_ids", [])
        if not members:
            await db.cities.delete_one({"id": c["id"]})
        elif c.get("mayor_device_id") not in members:
            await db.cities.update_one({"id": c["id"]}, {"$set": {"mayor_device_id": members[0]}})


# ---------- Payments (Google Pay direct API for gem packs) ----------
# Stripe was completely removed. The store now uses Google Pay TEST environment
# directly — tokens come from Google Pay JS API and are credited as opaque
# strings (no third-party processor in the middle).
GPAY_ENV = os.environ.get("GOOGLE_PAY_ENV", "TEST").upper()
GPAY_MERCHANT_ID = os.environ.get("GOOGLE_PAY_MERCHANT_ID", "TEST_MERCHANT_ID")
GPAY_MERCHANT_NAME = os.environ.get("GOOGLE_PAY_MERCHANT_NAME", "Idle Business Tycoon (TEST)")

# Prices defined strictly server-side. Never trust client amounts.
# Unified store catalog — every item that costs real money lives here.
# All base prices END IN .99 (price_cents ends in 99).
STORE_CATALOG: Dict[str, Dict[str, Any]] = {
    # Gem packs
    "pack_xs": {"name": "100 Gems", "price_cents": 99, "gems": 100, "investors": 0, "remove_ads": False, "product": "gems"},
    "pack_s": {"name": "550 Gems", "price_cents": 499, "gems": 550, "investors": 0, "remove_ads": False, "product": "gems"},
    "pack_m": {"name": "1,200 Gems", "price_cents": 999, "gems": 1200, "investors": 0, "remove_ads": False, "product": "gems"},
    "pack_l": {"name": "2,500 Gems", "price_cents": 1999, "gems": 2500, "investors": 0, "remove_ads": False, "product": "gems"},
    "pack_xl": {"name": "6,500 Gems", "price_cents": 4999, "gems": 6500, "investors": 0, "remove_ads": False, "product": "gems"},
    # Remove ads
    "remove_ads": {"name": "Remove Ads", "price_cents": 1499, "gems": 0, "investors": 0, "remove_ads": True, "product": "remove_ads"},
    # Loot key bundles
    "keys_s": {"name": "5 Loot Keys", "price_cents": 199, "gems": 0, "investors": 0, "keys": 5, "remove_ads": False, "product": "keys"},
    "keys_m": {"name": "20 Loot Keys", "price_cents": 499, "gems": 0, "investors": 0, "keys": 20, "remove_ads": False, "product": "keys"},
    "keys_l": {"name": "50 Loot Keys", "price_cents": 999, "gems": 0, "investors": 0, "keys": 50, "remove_ads": False, "product": "keys"},
    # Bundles (investors = prestige points)
    "bundle_starter": {"name": "Starter Bundle", "price_cents": 499, "gems": 2500, "investors": 100, "keys": 10, "remove_ads": True, "product": "bundle"},
    "bundle_followup": {"name": "Tycoon Boost Bundle", "price_cents": 499, "gems": 2500, "investors": 500, "keys": 10, "remove_ads": False, "product": "bundle"},
    "bundle_value": {"name": "Value Pack", "price_cents": 999, "gems": 500, "investors": 300, "keys": 15, "remove_ads": False, "product": "bundle"},
    "bundle_mogul": {"name": "Mega Mogul Bundle", "price_cents": 1999, "gems": 1500, "investors": 1000, "keys": 30, "remove_ads": False, "product": "bundle"},
    "bundle_ultimate": {"name": "Ultimate Empire Bundle", "price_cents": 4999, "gems": 3000, "investors": 3000, "keys": 60, "remove_ads": False, "product": "bundle"},
}


def _round_to_99(cents: int) -> int:
    """Round a price to the nearest whole dollar minus a cent (.99 ending), min $0.99."""
    dollars = max(1, round(cents / 100))
    return dollars * 100 - 1


# Bundle deals always run a permanent 60% off promotion; key packs a permanent 50% off.
PERMANENT_SALES: Dict[str, int] = {
    "bundle_value": 60,
    "bundle_mogul": 60,
    "bundle_ultimate": 60,
    "keys_s": 50,
    "keys_m": 50,
    "keys_l": 50,
}


async def _sales_map() -> Dict[str, int]:
    out: Dict[str, int] = dict(PERMANENT_SALES)
    now = datetime.now(timezone.utc)
    expired: List[str] = []
    async for s in db.store_sales.find({}, {"_id": 0}):
        exp = s.get("expires_at")
        if exp is not None:
            if isinstance(exp, str):
                try:
                    exp = datetime.fromisoformat(exp)
                except ValueError:
                    exp = None
            if exp is not None:
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp <= now:
                    expired.append(s["pack_id"])
                    continue
        pct = int(s.get("discount_pct", 0))
        if 0 < pct <= 90:
            out[s["pack_id"]] = pct
    # Lazily clean up any expired timed sales.
    for pid in expired:
        await db.store_sales.delete_one({"pack_id": pid})
    return out


def _final_cents(base_cents: int, discount_pct: int) -> int:
    if discount_pct <= 0:
        return base_cents
    return _round_to_99(base_cents * (100 - discount_pct) / 100)


# Exact sale prices (in cents) that bypass the default .99 rounding.
PRICE_OVERRIDES: Dict[str, int] = {
    "keys_m": 249,  # 20 Loot Keys -> $2.49
}


def _priced(pack_id: str, base_cents: int, discount_pct: int) -> tuple:
    """Return (final_cents, effective_discount_pct), honoring exact overrides."""
    if pack_id in PRICE_OVERRIDES:
        final = PRICE_OVERRIDES[pack_id]
        pct = round((1 - final / base_cents) * 100) if base_cents > 0 else discount_pct
        return final, pct
    return _final_cents(base_cents, discount_pct), discount_pct


class CheckoutRequest(BaseModel):
    device_id: str
    pack_id: str
    return_url: str


async def _resolve_item(pack_id: str) -> Dict[str, Any]:
    base = STORE_CATALOG.get(pack_id)
    if not base:
        raise HTTPException(status_code=400, detail="Invalid pack")
    sales = await _sales_map()
    discount = sales.get(pack_id, 0)
    final, discount = _priced(pack_id, base["price_cents"], discount)
    return {
        "name": base["name"],
        "base_cents": base["price_cents"],
        "discount_pct": discount,
        "price_cents": final,
        "gems": base["gems"],
        "investors": base["investors"],
        "keys": base.get("keys", 0),
        "remove_ads": base["remove_ads"],
        "product": base["product"],
    }


# Items that may only be purchased once per device. Re-purchase attempts
# (whether via Google Pay checkout or the Play Billing verify endpoint)
# get rejected with HTTP 409 and the player-visible message
# "Already purchased".
ONE_TIME_PACK_IDS = {"remove_ads", "bundle_starter", "bundle_followup"}


async def _device_already_owns(device_id: str, pack_id: str) -> bool:
    """True if this device has already paid for the given one-time pack OR
    received it as an admin grant."""
    if pack_id not in ONE_TIME_PACK_IDS:
        return False
    if not (device_id or "").strip():
        return False
    paid = await db.payment_transactions.find_one(
        {"device_id": device_id, "pack_id": pack_id, "status": "paid"},
        {"_id": 1},
    )
    if paid:
        return True
    granted = await db.admin_package_grants.find_one(
        {"device_id": device_id, "pack_id": pack_id},
        {"_id": 1},
    )
    return bool(granted)


@api_router.post("/payments/checkout")
async def create_checkout(req: CheckoutRequest):
    """Create a pending Google Pay transaction and return the URL of our
    self-hosted Google Pay checkout page. The frontend opens this URL in a
    browser/WebView; the page runs Google Pay JS (TEST environment, all major
    card networks) and POSTs the token back to /payments/googlepay/confirm.
    """
    if await _device_already_owns(req.device_id, req.pack_id):
        raise HTTPException(status_code=409, detail="Already purchased")
    item = await _resolve_item(req.pack_id)
    # First-purchase doubler: if this player has never had a successful purchase
    # credited, double the in-game rewards on this checkout. Price unchanged.
    player_doc = await db.players.find_one(
        {"device_id": req.device_id}, {"_id": 0, "first_purchase_used": 1},
    )
    # First-purchase 2× doubler applies ONLY to plain gem packs. Bundles,
    # loot-key packs, and remove-ads have fixed advertised quantities, so
    # doubling them would deliver more than the card promises (bug
    # reported by users: "bundles don't match their descriptions").
    eligible_for_doubler = item.get("product") == "gems"
    first_bonus = eligible_for_doubler and not bool(
        player_doc and player_doc.get("first_purchase_used")
    )
    mult = 2 if first_bonus else 1
    gems_grant = int(item["gems"]) * mult
    inv_grant = int(item["investors"]) * mult
    keys_grant = int(item["keys"]) * mult

    session_id = f"gpay_{uuidlib.uuid4().hex}"

    await db.payment_transactions.insert_one({
        "session_id": session_id,
        "device_id": req.device_id,
        "pack_id": req.pack_id,
        "product": item["product"],
        "gems": gems_grant,
        "investors": inv_grant,
        "keys": keys_grant,
        "remove_ads": item["remove_ads"],
        "amount_cents": item["price_cents"],
        "first_purchase_bonus": first_bonus,
        "status": "pending",
        "provider": "google_pay",
        "environment": GPAY_ENV,
        "created_at": now_iso(),
    })

    # Build the URL of our hosted Google Pay page. The frontend already passes
    # an absolute return_url; we host the page on the same backend so it lives
    # under /api/payments/googlepay/page and the iframe/webview/browser can
    # post the token straight back to this API.
    backend_base = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or ""
    if not backend_base:
        # Fallback: derive from the return_url's origin so the page is reachable
        # from whatever environment the client is running in.
        try:
            from urllib.parse import urlparse
            parsed = urlparse(req.return_url)
            backend_base = f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            backend_base = ""
    from urllib.parse import quote
    page_url = (
        f"{backend_base}/api/payments/googlepay/page"
        f"?session_id={session_id}&return_url={quote(req.return_url, safe='')}"
    )

    return {
        "url": page_url,
        "session_id": session_id,
        "gems": gems_grant,
        "investors": inv_grant,
        "keys": keys_grant,
        "remove_ads": item["remove_ads"],
        "product": item["product"],
        "first_purchase_bonus": first_bonus,
    }


@api_router.get("/payments/status/{session_id}")
async def payment_status(session_id: str):
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Unknown session")
    return {
        "payment_status": "paid" if txn.get("status") == "paid" else "unpaid",
        "gems": int(txn.get("gems", 0) or 0),
        "investors": int(txn.get("investors", 0) or 0),
        "keys": int(txn.get("keys", 0) or 0),
        "remove_ads": bool(txn.get("remove_ads", False)),
        "product": txn.get("product", "gems"),
        "first_purchase_bonus": bool(txn.get("first_purchase_bonus")),
    }


class GooglePayConfirmRequest(BaseModel):
    session_id: str
    token: str
    card_network: Optional[str] = None
    card_details: Optional[str] = None
    email: Optional[str] = None


@api_router.post("/payments/googlepay/confirm")
async def googlepay_confirm(req: GooglePayConfirmRequest):
    """Receive the Google Pay payment token from the hosted checkout page,
    mark the transaction paid, and burn the first-purchase doubler. In TEST
    mode the token is treated as an opaque proof that the user completed the
    Google Pay sheet — no decryption / processor call happens.
    """
    if not req.token:
        raise HTTPException(status_code=400, detail="Missing Google Pay token")
    txn = await db.payment_transactions.find_one({"session_id": req.session_id})
    if not txn:
        raise HTTPException(status_code=404, detail="Unknown session")
    if txn.get("status") == "paid":
        # Idempotent — duplicate confirm just returns the existing record.
        return {"payment_status": "paid", "already_paid": True}

    await db.payment_transactions.update_one(
        {"session_id": req.session_id},
        {"$set": {
            "status": "paid",
            "paid_at": now_iso(),
            "gpay_token": req.token,
            "gpay_card_network": req.card_network,
            "gpay_card_details": req.card_details,
            "gpay_email": req.email,
        }},
    )
    if txn.get("first_purchase_bonus"):
        await db.players.update_one(
            {"device_id": txn["device_id"]},
            {"$set": {"first_purchase_used": True, "first_purchase_used_at": now_iso()}},
            upsert=True,
        )
    return {"payment_status": "paid", "already_paid": False}


@api_router.get("/payments/googlepay/config")
async def googlepay_config():
    """Public Google Pay configuration the frontend / hosted page can use to
    build PaymentDataRequest objects (no secrets)."""
    return {
        "environment": GPAY_ENV,
        "merchant_id": GPAY_MERCHANT_ID,
        "merchant_name": GPAY_MERCHANT_NAME,
        "allowed_card_networks": ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "JCB"],
        "allowed_auth_methods": ["PAN_ONLY", "CRYPTOGRAM_3DS"],
    }


@api_router.get("/payments/googlepay/page")
async def googlepay_page(session_id: str, return_url: str = ""):
    """Self-hosted Google Pay checkout page. Loaded inside WebBrowser /
    WebView from the app. Runs Google Pay JS (TEST env) and on token receipt
    POSTs to /payments/googlepay/confirm, then redirects back to return_url."""
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Unknown session")

    amount_dollars = int(txn.get("amount_cents", 0)) / 100.0
    item_name = STORE_CATALOG.get(txn.get("pack_id", ""), {}).get("name", "Purchase")
    safe_name = escape(item_name)
    html = f"""<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\" />
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
<title>Google Pay Checkout</title>
<script async src=\"https://pay.google.com/gp/p/js/pay.js\"></script>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; min-height: 100%; background: #0d1426; color: #f7f8ff; font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; }}
  .wrap {{ max-width: 480px; margin: 0 auto; padding: 32px 24px 64px; }}
  .badge {{ display:inline-block; padding:4px 10px; border-radius:999px; background:#1f2a44; color:#9cb0ff; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; margin-bottom: 24px; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  .sub {{ color:#8c99c5; font-size: 14px; margin: 0 0 24px; }}
  .card {{ background:#162038; border-radius:16px; padding:20px 18px; margin-bottom:20px; }}
  .row {{ display:flex; justify-content:space-between; padding:6px 0; font-size:15px; }}
  .row .lbl {{ color:#8c99c5; }}
  .total {{ font-size: 28px; font-weight: 700; margin-top: 8px; }}
  #gpay-container {{ display:flex; justify-content:center; margin-top: 8px; min-height:48px; }}
  #status {{ margin-top: 16px; min-height: 24px; text-align:center; font-size: 14px; color:#9cb0ff; }}
  .err {{ color:#ff6b6b; }}
  .ok {{ color:#7df0a1; }}
  .networks {{ margin-top:18px; color:#566186; font-size:12px; text-align:center; }}
</style>
</head>
<body>
  <div class=\"wrap\">
    <span class=\"badge\" data-testid=\"gpay-env-badge\">{escape(GPAY_ENV)} ENVIRONMENT</span>
    <h1 data-testid=\"gpay-item-name\">{safe_name}</h1>
    <p class=\"sub\">Pay securely with Google Pay</p>
    <div class=\"card\">
      <div class=\"row\"><span class=\"lbl\">Item</span><span>{safe_name}</span></div>
      <div class=\"row\"><span class=\"lbl\">Currency</span><span>USD</span></div>
      <div class=\"row\"><span class=\"lbl\">Total</span><span class=\"total\" data-testid=\"gpay-total\">${amount_dollars:.2f}</span></div>
    </div>
    <div id=\"gpay-container\" data-testid=\"gpay-button-container\"></div>
    <p id=\"status\" data-testid=\"gpay-status\"></p>
    <p class=\"networks\">Accepts Visa, Mastercard, American Express, Discover, JCB</p>
  </div>
<script>
(function() {{
  var SESSION_ID = {json.dumps(session_id)};
  var RETURN_URL = {json.dumps(return_url or "")};
  var TOTAL_PRICE = {json.dumps(f"{amount_dollars:.2f}")};
  var ITEM_NAME = {json.dumps(item_name)};
  var ENV = {json.dumps(GPAY_ENV)};
  var MERCHANT_ID = {json.dumps(GPAY_MERCHANT_ID)};
  var MERCHANT_NAME = {json.dumps(GPAY_MERCHANT_NAME)};

  var statusEl = document.getElementById('status');
  var paymentsClient = null;

  var baseRequest = {{ apiVersion: 2, apiVersionMinor: 0 }};
  var cardPaymentMethod = {{
    type: 'CARD',
    parameters: {{
      allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
      allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'JCB'],
      billingAddressRequired: false
    }},
    tokenizationSpecification: {{
      // TEST environment uses the example gateway so the JS API can return
      // a sample, non-chargeable token without any merchant onboarding.
      type: 'PAYMENT_GATEWAY',
      parameters: {{ gateway: 'example', gatewayMerchantId: 'exampleGatewayMerchantId' }}
    }}
  }};

  function setStatus(msg, cls) {{
    statusEl.textContent = msg;
    statusEl.className = cls || '';
  }}

  function onPayLoaded() {{
    if (!window.google || !google.payments) {{
      setStatus('Google Pay library failed to load', 'err');
      return;
    }}
    paymentsClient = new google.payments.api.PaymentsClient({{ environment: ENV }});
    var isReadyReq = Object.assign({{}}, baseRequest, {{ allowedPaymentMethods: [cardPaymentMethod] }});
    paymentsClient.isReadyToPay(isReadyReq)
      .then(function(res) {{
        if (res.result) {{
          var btn = paymentsClient.createButton({{
            onClick: onGPayClicked,
            buttonColor: 'black',
            buttonType: 'pay',
            buttonSizeMode: 'fill'
          }});
          btn.setAttribute('data-testid', 'gpay-button');
          document.getElementById('gpay-container').appendChild(btn);
        }} else {{
          setStatus('Google Pay is not available on this device/browser', 'err');
        }}
      }})
      .catch(function(err) {{
        setStatus('Google Pay readiness check failed: ' + err, 'err');
      }});
  }}

  function buildPaymentDataRequest() {{
    return Object.assign({{}}, baseRequest, {{
      allowedPaymentMethods: [cardPaymentMethod],
      transactionInfo: {{
        totalPriceStatus: 'FINAL',
        totalPrice: TOTAL_PRICE,
        currencyCode: 'USD',
        countryCode: 'US'
      }},
      merchantInfo: {{
        merchantName: MERCHANT_NAME,
        merchantId: MERCHANT_ID
      }}
    }});
  }}

  function onGPayClicked() {{
    setStatus('Opening Google Pay sheet…', '');
    paymentsClient.loadPaymentData(buildPaymentDataRequest())
      .then(function(paymentData) {{
        setStatus('Confirming payment…', '');
        var pmd = paymentData && paymentData.paymentMethodData;
        var token = pmd && pmd.tokenizationData && pmd.tokenizationData.token;
        var card = pmd && pmd.info ? (pmd.info.cardNetwork || '') : '';
        var details = pmd && pmd.info ? (pmd.info.cardDetails || '') : '';
        var email = paymentData && paymentData.email ? paymentData.email : null;
        return fetch('/api/payments/googlepay/confirm', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{
            session_id: SESSION_ID,
            token: token || 'TEST_TOKEN_' + Date.now(),
            card_network: card,
            card_details: details,
            email: email
          }})
        }}).then(function(r) {{ return r.json(); }});
      }})
      .then(function(result) {{
        if (result && result.payment_status === 'paid') {{
          setStatus('Payment successful — redirecting…', 'ok');
          var sep = RETURN_URL.indexOf('?') >= 0 ? '&' : '?';
          var dest = RETURN_URL ? (RETURN_URL + sep + 'status=success&session_id=' + encodeURIComponent(SESSION_ID)) : '';
          setTimeout(function() {{ if (dest) window.location.href = dest; }}, 600);
        }} else {{
          setStatus('Payment could not be confirmed. Please try again.', 'err');
        }}
      }})
      .catch(function(err) {{
        if (err && err.statusCode === 'CANCELED') {{
          setStatus('Payment cancelled', '');
        }} else {{
          setStatus('Payment failed: ' + (err && err.message ? err.message : err), 'err');
        }}
      }});
  }}

  // Poll until the pay.js script has loaded, then bootstrap.
  var tries = 0;
  var iv = setInterval(function() {{
    tries += 1;
    if (window.google && google.payments && google.payments.api) {{
      clearInterval(iv);
      onPayLoaded();
    }} else if (tries > 50) {{
      clearInterval(iv);
      setStatus('Could not load Google Pay (network blocked?)', 'err');
    }}
  }}, 100);
}})();
</script>
</body>
</html>
"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html)


def _fmt_price(cents: int) -> str:
    return f"${cents / 100:.2f}"


# ---------- Purchase history (player + admin) ----------
@api_router.get("/payments/history")
async def payments_history(device_id: str):
    """Player-facing purchase history. Combines paid Google Pay /
    Play Billing transactions with admin freebies, so the UI can show
    "Free (granted by admin)" without inferring it from price.
    """
    if not (device_id or "").strip():
        raise HTTPException(status_code=400, detail="device_id required")
    items: List[Dict[str, Any]] = []
    async for txn in db.payment_transactions.find(
        {"device_id": device_id, "status": "paid"}, {"_id": 0},
    ).sort("paid_at", -1):
        pack_id = txn.get("pack_id", "")
        catalog = STORE_CATALOG.get(pack_id, {})
        amount = int(txn.get("amount_cents", 0) or 0)
        items.append({
            "id": txn.get("session_id") or txn.get("purchase_token") or pack_id,
            "pack_id": pack_id,
            "pack_name": catalog.get("name", pack_id),
            "product": txn.get("product", catalog.get("product", "gems")),
            "amount_cents": amount,
            "amount_label": _fmt_price(amount) if amount > 0 else "Free",
            "paid_at": txn.get("paid_at") or txn.get("created_at"),
            "source": "purchase",
            "provider": txn.get("provider", "google_pay"),
            "gems": int(txn.get("gems", 0) or 0),
            "investors": int(txn.get("investors", 0) or 0),
            "keys": int(txn.get("keys", 0) or 0),
            "remove_ads": bool(txn.get("remove_ads", False)),
            "first_purchase_bonus": bool(txn.get("first_purchase_bonus", False)),
        })
    async for g in db.admin_package_grants.find(
        {"device_id": device_id}, {"_id": 0},
    ).sort("created_at", -1):
        pack_id = g.get("pack_id", "")
        catalog = STORE_CATALOG.get(pack_id, {})
        items.append({
            "id": g.get("id"),
            "pack_id": pack_id,
            "pack_name": g.get("pack_name") or catalog.get("name", pack_id),
            "product": catalog.get("product", "gems"),
            "amount_cents": 0,
            "amount_label": "Free (admin grant)",
            "paid_at": g.get("created_at"),
            "source": "admin_grant",
            "provider": "admin",
            "gems": int(g.get("gems", 0) or 0),
            "investors": int(g.get("investors", 0) or 0),
            "keys": int(g.get("keys", 0) or 0),
            "remove_ads": bool(g.get("remove_ads", False)),
            "first_purchase_bonus": False,
        })
    items.sort(key=lambda x: x.get("paid_at") or "", reverse=True)
    return {"items": items}


async def _collect_admin_purchases(
    *,
    device_id: Optional[str],
    from_date: Optional[str],
    to_date: Optional[str],
    source: Optional[str],
    limit: int,
) -> Dict[str, Any]:
    """Shared loader for the JSON + CSV admin endpoints.

    - `device_id` is a case-insensitive substring match on the player UUID.
    - `from_date` / `to_date` are inclusive ISO date strings (YYYY-MM-DD or
      full ISO 8601); rows with `paid_at >= from_date` and `paid_at <= to_date`.
    - `source` filters to "purchase" | "admin_grant" | None (both).

    Date strings are validated by the route handlers via `_parse_date_param`
    before reaching this helper.
    """
    txn_query: Dict[str, Any] = {"status": "paid"}
    grant_query: Dict[str, Any] = {}

    # Date range — compare on stored ISO strings, which sort lexicographically.
    paid_range: Dict[str, Any] = {}
    created_range: Dict[str, Any] = {}
    if from_date:
        paid_range["$gte"] = from_date
        created_range["$gte"] = from_date
    if to_date:
        # If a bare date is provided, extend to end-of-day so the bound is inclusive.
        upper = to_date if "T" in to_date else (to_date + "T23:59:59.999999+00:00")
        paid_range["$lte"] = upper
        created_range["$lte"] = upper
    if paid_range:
        txn_query["paid_at"] = paid_range
    if created_range:
        grant_query["created_at"] = created_range

    needle = (device_id or "").strip().lower()
    want_purchases = source in (None, "", "all", "purchase")
    want_grants = source in (None, "", "all", "admin_grant")

    items: List[Dict[str, Any]] = []
    fetch_limit = max(limit, 1) * 2  # over-fetch so post-filter limit still has room

    if want_purchases:
        async for txn in db.payment_transactions.find(
            txn_query, {"_id": 0},
        ).sort("paid_at", -1).limit(fetch_limit):
            did = (txn.get("device_id") or "")
            if needle and needle not in did.lower():
                continue
            pack_id = txn.get("pack_id", "")
            catalog = STORE_CATALOG.get(pack_id, {})
            amount = int(txn.get("amount_cents", 0) or 0)
            items.append({
                "id": txn.get("session_id") or txn.get("purchase_token") or pack_id,
                "device_id": did,
                "pack_id": pack_id,
                "pack_name": catalog.get("name", pack_id),
                "amount_cents": amount,
                "amount_label": _fmt_price(amount) if amount > 0 else "Free",
                "paid_at": txn.get("paid_at") or txn.get("created_at"),
                "source": "purchase",
                "provider": txn.get("provider", "google_pay"),
                "first_purchase_bonus": bool(txn.get("first_purchase_bonus", False)),
            })

    if want_grants:
        async for g in db.admin_package_grants.find(
            grant_query, {"_id": 0},
        ).sort("created_at", -1).limit(fetch_limit):
            did = (g.get("device_id") or "")
            if needle and needle not in did.lower():
                continue
            pack_id = g.get("pack_id", "")
            catalog = STORE_CATALOG.get(pack_id, {})
            items.append({
                "id": g.get("id"),
                "device_id": did,
                "pack_id": pack_id,
                "pack_name": g.get("pack_name") or catalog.get("name", pack_id),
                "amount_cents": 0,
                "amount_label": "Free (admin grant)",
                "paid_at": g.get("created_at"),
                "source": "admin_grant",
                "provider": "admin",
                "first_purchase_bonus": False,
            })

    items.sort(key=lambda x: x.get("paid_at") or "", reverse=True)
    items = items[:limit]
    revenue_cents = sum(int(it.get("amount_cents", 0) or 0) for it in items if it.get("source") == "purchase")
    return {
        "items": items,
        "revenue_cents": revenue_cents,
        "revenue_label": _fmt_price(revenue_cents),
        "paid_count": sum(1 for it in items if it.get("source") == "purchase"),
        "grant_count": sum(1 for it in items if it.get("source") == "admin_grant"),
    }


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_date_param(name: str, raw: Optional[str], *, end_of_day: bool) -> Optional[str]:
    """Validate `?from_date=` / `?to_date=`. Accepts:
      - empty / None → returns None (no filter)
      - 'YYYY-MM-DD' → normalised to ISO 8601 (UTC) start-of-day, or
        end-of-day when `end_of_day=True`
      - full ISO 8601 (anything `datetime.fromisoformat` parses)
    Raises HTTP 400 for any other input so callers get a clear error
    instead of silently empty results.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if _DATE_RE.match(s):
        try:
            dt = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid {name}: {e}")
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return dt.isoformat()
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {name}: expected YYYY-MM-DD or ISO 8601",
        )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


_SOURCE_VALUES = {"purchase", "admin_grant", "all"}


def _validate_source_param(raw: Optional[str]) -> Optional[str]:
    if raw is None or raw == "":
        return None
    if raw not in _SOURCE_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source: expected one of {sorted(_SOURCE_VALUES)}",
        )
    return raw


@api_router.get("/admin/purchases")
async def admin_list_purchases(
    request: Request,
    limit: int = 200,
    device_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source: Optional[str] = None,
):
    """Admin: full purchase log across all players (uuid, pack, amount paid).
    Includes admin freebies tagged source='admin_grant' with amount_cents=0
    so the UI can clearly distinguish them from real money.

    Filters: `device_id` (case-insensitive UUID substring), `from_date` /
    `to_date` (YYYY-MM-DD or ISO 8601, inclusive), `source` (purchase |
    admin_grant | all). Malformed dates / source return HTTP 400.
    """
    await _require_admin(request)
    limit = max(1, min(1000, int(limit)))
    norm_from = _parse_date_param("from_date", from_date, end_of_day=False)
    norm_to = _parse_date_param("to_date", to_date, end_of_day=True)
    norm_source = _validate_source_param(source)
    return await _collect_admin_purchases(
        device_id=device_id, from_date=norm_from, to_date=norm_to,
        source=norm_source, limit=limit,
    )


@api_router.get("/admin/purchases.csv")
async def admin_export_purchases_csv(
    request: Request,
    limit: int = 1000,
    device_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source: Optional[str] = None,
):
    """Admin CSV export of the purchase log. Honors the same filters as
    `/admin/purchases`. Returns `text/csv` with a Content-Disposition header
    so browsers / fetch+blob downloads name the file sensibly. Invalid
    dates / source values return HTTP 400."""
    await _require_admin(request)
    limit = max(1, min(10000, int(limit)))
    norm_from = _parse_date_param("from_date", from_date, end_of_day=False)
    norm_to = _parse_date_param("to_date", to_date, end_of_day=True)
    norm_source = _validate_source_param(source)
    payload = await _collect_admin_purchases(
        device_id=device_id, from_date=norm_from, to_date=norm_to,
        source=norm_source, limit=limit,
    )
    import csv as _csv
    import io as _io
    from fastapi.responses import Response as _Response

    buf = _io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow([
        "paid_at", "device_id", "pack_id", "pack_name",
        "amount_cents", "amount_label", "source", "provider",
        "first_purchase_bonus", "id",
    ])
    for it in payload["items"]:
        writer.writerow([
            it.get("paid_at") or "",
            it.get("device_id") or "",
            it.get("pack_id") or "",
            it.get("pack_name") or "",
            it.get("amount_cents") or 0,
            it.get("amount_label") or "",
            it.get("source") or "",
            it.get("provider") or "",
            "1" if it.get("first_purchase_bonus") else "0",
            it.get("id") or "",
        ])
    writer.writerow([])
    writer.writerow(["TOTAL_REVENUE_CENTS", payload["revenue_cents"]])
    writer.writerow(["TOTAL_REVENUE", payload["revenue_label"]])
    writer.writerow(["PAID_COUNT", payload["paid_count"]])
    writer.writerow(["GRANT_COUNT", payload["grant_count"]])

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"purchases_{stamp}.csv"
    return _Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _bundle_value_cents(pack_id: str) -> int:
    """Sum the catalog price of every component inside a bundle, so the UI can
    show a "you'd normally pay $X" strike-through. Uses the base (non-sale)
    price of the matching standalone packs:
      - Remove Ads: full base price of the standalone item
      - Gems: $0.99 per 100 gems (pack_xs unit rate)
      - Loot Keys: $1.99 per 5 keys (keys_s base) — purchased in 5-key packs
    Investors have no real-money equivalent, so they're treated as a free
    in-bundle bonus and not counted.
    """
    base = STORE_CATALOG.get(pack_id)
    if not base or base.get("product") != "bundle":
        return 0
    cents = 0
    if base.get("remove_ads"):
        ra = STORE_CATALOG.get("remove_ads")
        if ra:
            cents += int(ra["price_cents"])
    gems = int(base.get("gems", 0) or 0)
    if gems > 0:
        # $0.99 per 100 gems, rounded up to the next 100-gem unit.
        cents += ((gems + 99) // 100) * 99
    keys = int(base.get("keys", 0) or 0)
    if keys > 0:
        # $1.99 per 5-key pack, rounded up.
        cents += ((keys + 4) // 5) * 199
    return cents


@api_router.get("/store/catalog")
async def store_catalog():
    sales = await _sales_map()
    items = []
    for pid, base in STORE_CATALOG.items():
        discount = sales.get(pid, 0)
        final, discount = _priced(pid, base["price_cents"], discount)
        item: Dict[str, Any] = {
            "id": pid,
            "name": base["name"],
            "product": base["product"],
            "base_cents": base["price_cents"],
            "base_price": _fmt_price(base["price_cents"]),
            "discount_pct": discount,
            "final_cents": final,
            "final_price": _fmt_price(final),
            "on_sale": discount > 0,
        }
        if base.get("product") == "bundle":
            value_cents = _bundle_value_cents(pid)
            if value_cents > final:
                item["bundle_value_cents"] = value_cents
                item["bundle_value_price"] = _fmt_price(value_cents)
                item["bundle_savings_pct"] = round((1 - final / value_cents) * 100)
        items.append(item)
    return {"items": items}


@api_router.get("/store/first-purchase")
async def first_purchase_status(device_id: str):
    """Returns whether this device is still eligible for the first-purchase 2x bonus."""
    player = await db.players.find_one({"device_id": device_id}, {"_id": 0, "first_purchase_used": 1})
    used = bool(player and player.get("first_purchase_used"))
    return {"available": not used, "multiplier": 2}


class StoreSaleRequest(BaseModel):
    pack_id: str
    discount_pct: int
    duration_minutes: Optional[int] = None  # None = permanent until cleared


@api_router.get("/admin/sales")
async def admin_list_sales(request: Request):
    await _require_admin(request)
    catalog = await store_catalog()
    return catalog


@api_router.post("/admin/sales")
async def admin_set_sale(req: StoreSaleRequest, request: Request):
    await _require_admin(request)
    if req.pack_id not in STORE_CATALOG:
        raise HTTPException(status_code=400, detail="Unknown item")
    if not (1 <= req.discount_pct <= 90):
        raise HTTPException(status_code=400, detail="Discount must be between 1 and 90")
    doc: Dict[str, Any] = {
        "pack_id": req.pack_id,
        "discount_pct": req.discount_pct,
        "updated_at": now_iso(),
    }
    if req.duration_minutes and req.duration_minutes > 0:
        expires = datetime.now(timezone.utc) + timedelta(minutes=int(req.duration_minutes))
        doc["expires_at"] = expires.isoformat()
    else:
        doc["expires_at"] = None
    await db.store_sales.update_one(
        {"pack_id": req.pack_id},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, "expires_at": doc["expires_at"]}


@api_router.delete("/admin/sales/{pack_id}")
async def admin_clear_sale(pack_id: str, request: Request):
    await _require_admin(request)
    await db.store_sales.delete_one({"pack_id": pack_id})
    return {"ok": True}


# ---------- Global Chat (WebSocket) ----------
BAD_WORDS = [
    "fuck", "shit", "bitch", "asshole", "bastard", "dick", "cunt",
    "nigger", "faggot", "slut", "whore", "retard",
]
_bad_re = re.compile("|".join(re.escape(w) for w in BAD_WORDS), re.IGNORECASE)


def clean_text(text: str) -> str:
    return _bad_re.sub(lambda m: "*" * len(m.group(0)), text)


class ChatConnectionManager:
    CHAT_COOLDOWN_SEC = 3.0

    def __init__(self):
        self.active: List[WebSocket] = []
        self.rate: Dict[str, List[float]] = {}
        self.last_msg: Dict[str, float] = {}
        # ws -> device_id (populated by the "hello" handshake / first message)
        self.identity: Dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        self.identity.pop(ws, None)

    def identify(self, ws: WebSocket, device_id: str):
        self.identity[ws] = device_id

    def online_count(self) -> int:
        # Unique device_ids currently connected; falls back to socket count
        # for sockets that haven't sent a hello/message yet.
        unique = {did for did in self.identity.values()}
        anon_sockets = len(self.active) - len(self.identity)
        # Permanent baseline inflation of online tycoons.
        ONLINE_BASELINE = 312
        return len(unique) + max(anon_sockets, 0) + ONLINE_BASELINE

    def cooldown_remaining(self, device_id: str) -> float:
        remaining = self.CHAT_COOLDOWN_SEC - (time.time() - self.last_msg.get(device_id, 0))
        return remaining if remaining > 0 else 0.0

    def mark_sent(self, device_id: str):
        self.last_msg[device_id] = time.time()

    def allowed(self, device_id: str) -> bool:
        now = time.time()
        arr = [t for t in self.rate.get(device_id, []) if now - t < 10]
        if len(arr) >= 5:  # max 5 messages / 10s
            self.rate[device_id] = arr
            return False
        arr.append(now)
        self.rate[device_id] = arr
        return True

    async def broadcast(self, payload: dict):
        dead = []
        for c in self.active:
            try:
                await c.send_json(payload)
            except Exception:
                dead.append(c)
        for d in dead:
            self.disconnect(d)

    async def broadcast_presence(self):
        await self.broadcast({"type": "presence", "online": self.online_count()})


chat_manager = ChatConnectionManager()


@api_router.get("/chat/history")
async def chat_history(limit: int = 50):
    cursor = db.chat_messages.find({}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100))
    msgs = [m async for m in cursor]
    msgs.reverse()
    return msgs


@api_router.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await chat_manager.connect(ws)
    # Send current count to the newly-connected client immediately, and
    # broadcast the updated count to everyone else (this socket bumps the
    # total by one until it identifies — that's still useful presence info).
    try:
        await chat_manager.broadcast_presence()
    except Exception:
        pass
    try:
        while True:
            data = await ws.receive_json()
            device_id = str(data.get("device_id", "anon"))[:64] or "anon"
            msg_type = str(data.get("type", "")) if isinstance(data, dict) else ""

            # Identify this socket with its device_id (idempotent). If this
            # is the first time we've seen this device on this socket, the
            # presence count may go up — broadcast.
            prev_count = chat_manager.online_count()
            chat_manager.identify(ws, device_id)
            new_count = chat_manager.online_count()
            if new_count != prev_count:
                await chat_manager.broadcast_presence()

            # "hello" is a presence-only handshake — no chat message.
            if msg_type == "hello":
                continue

            name = (str(data.get("name", "")) or "Anonymous Tycoon").strip()[:24] or "Anonymous Tycoon"
            text = (str(data.get("text", "")) or "").strip()[:300]
            if not text:
                continue
            wait = chat_manager.cooldown_remaining(device_id)
            if wait > 0:
                await ws.send_json({"type": "error", "message": f"Slow down! Wait {wait:.1f}s before sending another message."})
                continue
            if not chat_manager.allowed(device_id):
                await ws.send_json({"type": "error", "message": "You're sending messages too fast."})
                continue
            if await db.bans.find_one({"device_id": device_id}):
                await ws.send_json({"type": "error", "message": "You are banned from chat."})
                continue
            if await db.ip_bans.find_one({"ip": _ws_ip(ws)}):
                await ws.send_json({"type": "error", "message": "You are banned from chat."})
                continue
            chat_manager.mark_sent(device_id)
            msg = {
                "id": uuidlib.uuid4().hex,
                "device_id": device_id,
                "name": name,
                "text": clean_text(text),
                "created_at": now_iso(),
            }
            await db.chat_messages.insert_one(dict(msg))
            await chat_manager.broadcast({"type": "message", **msg})
    except WebSocketDisconnect:
        chat_manager.disconnect(ws)
        await chat_manager.broadcast_presence()
    except Exception:
        chat_manager.disconnect(ws)
        try:
            await chat_manager.broadcast_presence()
        except Exception:
            pass


# ---------- City Chat (WebSocket, scoped per City) ----------
class CityChatManager:
    CHAT_COOLDOWN_SEC = 3.0

    def __init__(self):
        # city_id -> list of websockets
        self.rooms: Dict[str, List[WebSocket]] = {}
        # ws -> {"city_id", "device_id"}
        self.meta: Dict[WebSocket, Dict[str, str]] = {}
        self.last_msg: Dict[str, float] = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()

    def join(self, ws: WebSocket, city_id: str, device_id: str):
        room = self.rooms.setdefault(city_id, [])
        if ws not in room:
            room.append(ws)
        self.meta[ws] = {"city_id": city_id, "device_id": device_id}

    def disconnect(self, ws: WebSocket):
        meta = self.meta.pop(ws, None)
        if meta:
            room = self.rooms.get(meta["city_id"])
            if room and ws in room:
                room.remove(ws)

    def online_count(self, city_id: str) -> int:
        room = self.rooms.get(city_id, [])
        return len({self.meta[w]["device_id"] for w in room if w in self.meta})

    def cooldown_remaining(self, device_id: str) -> float:
        remaining = self.CHAT_COOLDOWN_SEC - (time.time() - self.last_msg.get(device_id, 0))
        return remaining if remaining > 0 else 0.0

    def mark_sent(self, device_id: str):
        self.last_msg[device_id] = time.time()

    async def broadcast(self, city_id: str, payload: dict):
        dead = []
        for c in list(self.rooms.get(city_id, [])):
            try:
                await c.send_json(payload)
            except Exception:
                dead.append(c)
        for d in dead:
            self.disconnect(d)

    async def broadcast_presence(self, city_id: str):
        await self.broadcast(city_id, {"type": "presence", "online": self.online_count(city_id)})


city_chat_manager = CityChatManager()


@api_router.get("/cities/{cid}/chat/history")
async def city_chat_history(cid: str, limit: int = 50):
    cursor = db.city_chat_messages.find({"city_id": cid}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100))
    msgs = [m async for m in cursor]
    msgs.reverse()
    return msgs


@api_router.websocket("/ws/citychat")
async def ws_city_chat(ws: WebSocket):
    await city_chat_manager.connect(ws)
    joined_city: Optional[str] = None
    try:
        while True:
            data = await ws.receive_json()
            device_id = str(data.get("device_id", "anon"))[:64] or "anon"
            city_id = str(data.get("city_id", ""))[:64]
            msg_type = str(data.get("type", "")) if isinstance(data, dict) else ""

            if not city_id:
                await ws.send_json({"type": "error", "message": "No City specified."})
                continue

            # Validate membership on every inbound message.
            city = await db.cities.find_one({"id": city_id}, {"member_ids": 1})
            if not city or device_id not in city.get("member_ids", []):
                await ws.send_json({"type": "error", "message": "You are not a member of this City."})
                continue

            if joined_city != city_id:
                city_chat_manager.join(ws, city_id, device_id)
                joined_city = city_id
                await city_chat_manager.broadcast_presence(city_id)
            else:
                city_chat_manager.join(ws, city_id, device_id)

            if msg_type == "hello":
                continue

            name = (str(data.get("name", "")) or "Anonymous Tycoon").strip()[:24] or "Anonymous Tycoon"
            text = (str(data.get("text", "")) or "").strip()[:300]
            if not text:
                continue
            wait = city_chat_manager.cooldown_remaining(device_id)
            if wait > 0:
                await ws.send_json({"type": "error", "message": f"Slow down! Wait {wait:.1f}s before sending another message."})
                continue
            if await db.bans.find_one({"device_id": device_id}):
                await ws.send_json({"type": "error", "message": "You are banned from chat."})
                continue
            if await db.ip_bans.find_one({"ip": _ws_ip(ws)}):
                await ws.send_json({"type": "error", "message": "You are banned from chat."})
                continue
            city_chat_manager.mark_sent(device_id)
            msg = {
                "id": uuidlib.uuid4().hex,
                "city_id": city_id,
                "device_id": device_id,
                "name": name,
                "text": clean_text(text),
                "created_at": now_iso(),
            }
            await db.city_chat_messages.insert_one(dict(msg))
            await city_chat_manager.broadcast(city_id, {"type": "message", **msg})
    except WebSocketDisconnect:
        city_chat_manager.disconnect(ws)
        if joined_city:
            await city_chat_manager.broadcast_presence(joined_city)
    except Exception:
        city_chat_manager.disconnect(ws)
        if joined_city:
            try:
                await city_chat_manager.broadcast_presence(joined_city)
            except Exception:
                pass


# ---------- Auth (Google: bring-your-own) + Admin ----------
# Set GOOGLE_AUTH_SESSION_API in backend/api_keys.py to your own OAuth gateway's
# session-data endpoint. While empty, /auth/session returns 503 and the app's
# Google button is hidden (email + password auth still works).
GOOGLE_SESSION_API = os.environ.get("GOOGLE_AUTH_SESSION_API", "")
ADMIN_EMAIL = "taylorhillonline@gmail.com"


def _bearer(request: Request) -> Optional[str]:
    h = request.headers.get("Authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


async def _user_from_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    # Email-auth issues a JWT whose ``sid`` claim points to the same
    # ``user_sessions`` row; unwrap that first so a single ``/auth/me`` works
    # for both auth providers. Falls through to the opaque-token (Google)
    # path if the token isn't a valid JWT.
    from auth_email import decode_jwt_session  # local import to avoid cycle
    sid = decode_jwt_session(token)
    lookup_token = sid or token
    sess = await db.user_sessions.find_one({"session_token": lookup_token}, {"_id": 0})
    if not sess:
        return None
    exp = sess.get("expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            await db.user_sessions.delete_one({"session_token": lookup_token})
            return None
    return await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})


async def _require_admin(request: Request) -> Dict[str, Any]:
    user = await _user_from_token(_bearer(request))
    if not user or not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access only")
    return user


class SessionReq(BaseModel):
    session_id: str
    device_id: Optional[str] = None


@api_router.post("/auth/session")
async def auth_session(req: SessionReq):
    if not GOOGLE_SESSION_API:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        async with httpx.AsyncClient(timeout=15) as cx:
            r = await cx.get(GOOGLE_SESSION_API, headers={"X-Session-ID": req.session_id})
    except Exception:
        raise HTTPException(status_code=502, detail="Auth service unreachable")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    data = r.json()
    email = (data.get("email") or "").strip().lower()
    name = data.get("name") or "Tycoon"
    picture = data.get("picture")
    token = data.get("session_token")
    if not token or not email:
        raise HTTPException(status_code=401, detail="Invalid session data")
    is_admin = email == ADMIN_EMAIL
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        upd = {"name": name, "picture": picture, "is_admin": is_admin}
        if req.device_id:
            upd["device_id"] = req.device_id
        await db.users.update_one({"user_id": user_id}, {"$set": upd})
    else:
        user_id = "user_" + uuidlib.uuid4().hex[:12]
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": name, "picture": picture,
            "is_admin": is_admin, "device_id": req.device_id, "created_at": now_iso(),
        })
    await db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {
            "session_token": token, "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": token, "user": user}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await _user_from_token(_bearer(request))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def auth_logout(request: Request):
    token = _bearer(request)
    if token:
        # Mirror the unwrap in _user_from_token: email-auth tokens are JWTs
        # whose ``sid`` claim is the real session_token. Without this, logout
        # is a no-op for email-auth users (session row keeps existing and
        # /auth/me keeps succeeding).
        from auth_email import decode_jwt_session  # local import to avoid cycle
        sid = decode_jwt_session(token)
        await db.user_sessions.delete_one({"session_token": sid or token})
    return {"ok": True}


# ----- Announcements -----
@api_router.get("/announcements")
async def get_announcement():
    a = await db.announcements.find_one({"active": True}, {"_id": 0}, sort=[("created_at", -1)])
    return {"announcement": a}


class AnnouncementReq(BaseModel):
    message: str = ""
    active: bool = True


@api_router.post("/admin/announcement")
async def set_announcement(req: AnnouncementReq, request: Request):
    await _require_admin(request)
    await db.announcements.update_many({}, {"$set": {"active": False}})
    if req.active and req.message.strip():
        await db.announcements.insert_one({
            "id": uuidlib.uuid4().hex, "message": req.message.strip()[:200],
            "active": True, "created_at": now_iso(),
        })
    return {"ok": True}


# ----- Promo codes -----
class PromoCreate(BaseModel):
    code: str
    gems: int
    max_uses: int = 0  # 0 = unlimited


@api_router.post("/admin/promocodes")
async def create_promo(req: PromoCreate, request: Request):
    await _require_admin(request)
    code = req.code.strip().upper()[:24]
    if not code:
        raise HTTPException(status_code=400, detail="Code required")
    await db.promocodes.update_one(
        {"code": code},
        {"$setOnInsert": {
            "code": code, "gems": int(req.gems), "max_uses": int(req.max_uses),
            "redeemed_by": [], "created_at": now_iso(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api_router.get("/admin/promocodes")
async def list_promo(request: Request):
    await _require_admin(request)
    codes = [c async for c in db.promocodes.find({}, {"_id": 0})]
    for c in codes:
        c["uses"] = len(c.get("redeemed_by", []))
        c.pop("redeemed_by", None)
    return {"codes": codes}


class RedeemReq(BaseModel):
    code: str
    device_id: str


@api_router.post("/promo/redeem")
async def redeem_promo(req: RedeemReq):
    code = req.code.strip().upper()
    promo = await db.promocodes.find_one({"code": code})
    if not promo:
        raise HTTPException(status_code=404, detail="Invalid code")
    if req.device_id in promo.get("redeemed_by", []):
        raise HTTPException(status_code=400, detail="You already redeemed this code")
    mx = int(promo.get("max_uses", 0))
    if mx and len(promo.get("redeemed_by", [])) >= mx:
        raise HTTPException(status_code=400, detail="This code is fully redeemed")
    await db.promocodes.update_one({"code": code}, {"$addToSet": {"redeemed_by": req.device_id}})
    return {"gems": int(promo.get("gems", 0))}


# ----- Bans -----
class BanReq(BaseModel):
    device_id: str


@api_router.post("/admin/ban")
async def ban_player(req: BanReq, request: Request):
    await _require_admin(request)
    await db.bans.update_one(
        {"device_id": req.device_id},
        {"$set": {"device_id": req.device_id, "created_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/admin/unban")
async def unban_player(req: BanReq, request: Request):
    await _require_admin(request)
    await db.bans.delete_one({"device_id": req.device_id})
    return {"ok": True}


@api_router.get("/admin/bans")
async def list_bans(request: Request):
    await _require_admin(request)
    return {"bans": [b async for b in db.bans.find({}, {"_id": 0})]}


# ----- IP bans (admin: ban by player UUID -> bans their last-seen IP) -----
class IpBanReq(BaseModel):
    device_id: str


@api_router.post("/admin/ipban")
async def ip_ban_player(req: IpBanReq, request: Request):
    await _require_admin(request)
    player = await db.players.find_one({"device_id": req.device_id}, {"_id": 0, "last_ip": 1, "name": 1})
    ip = (player or {}).get("last_ip")
    if not ip:
        raise HTTPException(status_code=400, detail="No known IP for that player yet — they must open the app at least once.")
    await db.ip_bans.update_one(
        {"ip": ip},
        {"$set": {"ip": ip, "device_id": req.device_id, "name": (player or {}).get("name", ""), "created_at": now_iso()}},
        upsert=True,
    )
    # Also device-ban so they can't simply rotate IP within the same install.
    await db.bans.update_one(
        {"device_id": req.device_id},
        {"$set": {"device_id": req.device_id, "created_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True, "ip": ip}


class IpUnbanReq(BaseModel):
    ip: str


@api_router.post("/admin/ipunban")
async def ip_unban(req: IpUnbanReq, request: Request):
    await _require_admin(request)
    await db.ip_bans.delete_one({"ip": req.ip})
    return {"ok": True}


@api_router.get("/admin/ipbans")
async def list_ip_bans(request: Request):
    await _require_admin(request)
    return {"ip_bans": [b async for b in db.ip_bans.find({}, {"_id": 0})]}


# ----- Stat grants (admin -> player). Applied client-side on next claim. -----
class GrantReq(BaseModel):
    device_id: str
    gems: int = 0
    investors: int = 0


@api_router.post("/admin/grant")
async def grant_stats(req: GrantReq, request: Request):
    await _require_admin(request)
    await db.pending_grants.update_one(
        {"device_id": req.device_id},
        {"$inc": {"gems": int(req.gems), "investors": int(req.investors)}},
        upsert=True,
    )
    return {"ok": True}


# ----- Grant a real-money PACKAGE to a player (admin comp / refund) -----
# Picks any item from STORE_CATALOG by pack_id and stacks its contents
# (gems, investors, keys, remove_ads) into the player's pending_grants
# bucket. The next /grants/claim call credits them client-side.
class GrantPackageReq(BaseModel):
    device_id: str
    pack_id: str


@api_router.post("/admin/grant-package")
async def grant_package(req: GrantPackageReq, request: Request):
    await _require_admin(request)
    base = STORE_CATALOG.get(req.pack_id)
    if not base:
        raise HTTPException(status_code=400, detail="Unknown package id")
    if not (req.device_id or "").strip():
        raise HTTPException(status_code=400, detail="Player UUID is required")
    gems = int(base.get("gems", 0) or 0)
    investors = int(base.get("investors", 0) or 0)
    keys = int(base.get("keys", 0) or 0)
    remove_ads = bool(base.get("remove_ads"))
    inc: Dict[str, int] = {}
    if gems:
        inc["gems"] = gems
    if investors:
        inc["investors"] = investors
    if keys:
        inc["keys"] = keys
    set_fields: Dict[str, Any] = {}
    if remove_ads:
        set_fields["remove_ads"] = True
    update: Dict[str, Any] = {}
    if inc:
        update["$inc"] = inc
    if set_fields:
        update["$set"] = set_fields
    if not update:
        # Nothing to grant for this pack (shouldn't happen, but be safe).
        return {"ok": True, "granted": {"gems": 0, "investors": 0, "keys": 0, "remove_ads": False}}
    await db.pending_grants.update_one(
        {"device_id": req.device_id},
        update,
        upsert=True,
    )
    # Audit trail.
    await db.admin_package_grants.insert_one({
        "id": uuidlib.uuid4().hex,
        "device_id": req.device_id,
        "pack_id": req.pack_id,
        "pack_name": base.get("name", req.pack_id),
        "gems": gems,
        "investors": investors,
        "keys": keys,
        "remove_ads": remove_ads,
        "created_at": now_iso(),
    })
    return {
        "ok": True,
        "granted": {
            "gems": gems,
            "investors": investors,
            "keys": keys,
            "remove_ads": remove_ads,
            "pack_name": base.get("name", req.pack_id),
        },
    }


# ----- Player reports (admin moderation) -----
@api_router.get("/admin/reports")
async def admin_list_reports(request: Request, status: str = "all"):
    await _require_admin(request)
    query: Dict[str, Any] = {}
    if status == "open":
        query = {"resolved": {"$ne": True}}
    elif status == "resolved":
        query = {"resolved": True}
    cursor = db.reports.find(query, {"_id": 0, "resend_id": 0, "email_error": 0}).sort("created_at", -1).limit(200)
    reports = [r async for r in cursor]
    for r in reports:
        r.setdefault("resolved", False)
        banned = await db.bans.find_one({"device_id": r.get("reported_device_id")}, {"_id": 0})
        r["reported_banned"] = bool(banned)
        # Backfill chat snapshots for older reports created before snapshots were stored.
        if "reporter_logs" not in r:
            live = await _recent_chat_for(r.get("reporter_device_id", ""))
            r["reporter_logs"] = [{"name": m.get("name", ""), "text": m.get("text", ""), "created_at": m.get("created_at", "")} for m in live]
        if "reported_logs" not in r:
            live = await _recent_chat_for(r.get("reported_device_id", ""))
            r["reported_logs"] = [{"name": m.get("name", ""), "text": m.get("text", ""), "created_at": m.get("created_at", "")} for m in live]
    return {"reports": reports}


@api_router.get("/admin/reports/count")
async def admin_reports_count(request: Request):
    await _require_admin(request)
    open_count = await db.reports.count_documents({"resolved": {"$ne": True}})
    total = await db.reports.count_documents({})
    return {"open": open_count, "total": total}


@api_router.post("/admin/reports/{report_id}/resolve")
async def admin_resolve_report(report_id: str, request: Request):
    await _require_admin(request)
    res = await db.reports.update_one(
        {"id": report_id},
        {"$set": {"resolved": True, "resolved_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"ok": True}


@api_router.get("/grants/claim")
async def claim_grants(device_id: str):
    g = await db.pending_grants.find_one_and_delete({"device_id": device_id})
    if not g:
        return {"gems": 0, "investors": 0, "keys": 0, "remove_ads": False, "cash": 0}
    return {
        "gems": int(g.get("gems", 0)),
        "investors": int(g.get("investors", 0)),
        "keys": int(g.get("keys", 0)),
        "remove_ads": bool(g.get("remove_ads", False)),
        "cash": int(g.get("cash", 0)),
    }


# ----- Player-to-player gem transfers -----
GEM_TRANSFER_MAX = 10_000_000


class GemTransferReq(BaseModel):
    from_device_id: str
    to_device_id: str
    amount: int


@api_router.post("/gems/transfer")
async def transfer_gems(req: GemTransferReq):
    amount = int(req.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter a gem amount greater than zero")
    if amount > GEM_TRANSFER_MAX:
        raise HTTPException(status_code=400, detail="That's more gems than you can send at once")
    if not req.from_device_id or req.from_device_id == req.to_device_id:
        raise HTTPException(status_code=400, detail="You can't send gems to yourself")
    recipient = await db.players.find_one({"device_id": req.to_device_id}, {"_id": 0, "name": 1})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    # Gems are client-authoritative; the sender deducts locally and the
    # recipient picks this up on their next /grants/claim poll.
    await db.pending_grants.update_one(
        {"device_id": req.to_device_id},
        {"$inc": {"gems": amount}},
        upsert=True,
    )
    await db.gem_transfers.insert_one({
        "id": uuidlib.uuid4().hex,
        "from_device_id": req.from_device_id,
        "to_device_id": req.to_device_id,
        "amount": amount,
        "created_at": now_iso(),
    })
    return {"ok": True, "amount": amount, "recipient_name": recipient.get("name", "Tycoon")}


# ---------- Player Reports (email to support) ----------
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
SUPPORT_EMAIL = "support@hypnofusions.com"
REPORT_COOLDOWN_SEC = 30.0


class ReportPlayerRequest(BaseModel):
    reporter_device_id: str
    reported_device_id: str
    reason: str
    reporter_name: Optional[str] = None
    reported_name: Optional[str] = None
    reporter_email: Optional[str] = None


async def _recent_chat_for(device_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    cursor = db.chat_messages.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    msgs = [m async for m in cursor]
    msgs.reverse()
    return msgs


def _logs_html(msgs: List[Dict[str, Any]]) -> str:
    if not msgs:
        return "<p style='color:#888;margin:4px 0'><em>No recent chat messages.</em></p>"
    rows = "".join(
        "<tr>"
        f"<td style='padding:4px 10px 4px 0;color:#999;font-size:12px;white-space:nowrap;vertical-align:top'>{escape(str(m.get('created_at', '')))}</td>"
        f"<td style='padding:4px 0;color:#111;font-size:13px'>{escape(str(m.get('text', '')))}</td>"
        "</tr>"
        for m in msgs
    )
    return f"<table style='border-collapse:collapse;width:100%'>{rows}</table>"


@api_router.post("/report-player")
async def report_player(req: ReportPlayerRequest):
    reason = (req.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Please provide a reason for the report.")
    if req.reporter_device_id and req.reporter_device_id == req.reported_device_id:
        raise HTTPException(status_code=400, detail="You can't report yourself.")

    # 30s cooldown between reports per reporter
    recent = await db.reports.find_one(
        {"reporter_device_id": req.reporter_device_id},
        sort=[("created_at", -1)],
    )
    if recent and recent.get("created_at"):
        try:
            last_dt = datetime.fromisoformat(recent["created_at"])
        except ValueError:
            last_dt = None
        if last_dt:
            elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if 0 <= elapsed < REPORT_COOLDOWN_SEC:
                raise HTTPException(
                    status_code=429,
                    detail=f"You're reporting too fast. Please wait {int(REPORT_COOLDOWN_SEC - elapsed) + 1}s before reporting again.",
                )

    reporter = await db.players.find_one({"device_id": req.reporter_device_id}, {"_id": 0, "name": 1})
    reported = await db.players.find_one({"device_id": req.reported_device_id}, {"_id": 0, "name": 1})
    reporter_name = (req.reporter_name or (reporter or {}).get("name") or "Unknown").strip()[:48]
    reported_name = (req.reported_name or (reported or {}).get("name") or "Unknown").strip()[:48]

    reporter_logs = await _recent_chat_for(req.reporter_device_id)
    reported_logs = await _recent_chat_for(req.reported_device_id)

    def _trim(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"name": m.get("name", ""), "text": m.get("text", ""), "created_at": m.get("created_at", "")} for m in msgs]

    report_doc = {
        "id": uuidlib.uuid4().hex,
        "reporter_device_id": req.reporter_device_id,
        "reporter_name": reporter_name,
        "reporter_email": (req.reporter_email or "").strip()[:120],
        "reported_device_id": req.reported_device_id,
        "reported_name": reported_name,
        "reason": reason[:2000],
        "reporter_logs": _trim(reporter_logs),
        "reported_logs": _trim(reported_logs),
        "created_at": now_iso(),
        "email_sent": False,
    }

    email_cell = escape(report_doc["reporter_email"]) or "<span style='color:#999'>— not provided —</span>"
    html = f"""
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111">
        <h2 style="margin:0 0 4px">&#128681; New Player Report</h2>
        <p style="color:#666;margin:0 0 16px;font-size:13px">Submitted {escape(report_doc['created_at'])}</p>

        <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;width:170px">Reported player</td>
              <td style="padding:6px 0"><b>{escape(reported_name)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Reported UUID</td>
              <td style="padding:6px 0"><code>{escape(req.reported_device_id)}</code></td></tr>
          <tr><td style="padding:6px 0;color:#666">Reported by</td>
              <td style="padding:6px 0"><b>{escape(reporter_name)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Reporter UUID</td>
              <td style="padding:6px 0"><code>{escape(req.reporter_device_id)}</code></td></tr>
          <tr><td style="padding:6px 0;color:#666">Reporter email</td>
              <td style="padding:6px 0">{email_cell}</td></tr>
        </table>

        <h3 style="margin:0 0 6px">Reason</h3>
        <div style="background:#f6f6f6;border-radius:8px;padding:12px;white-space:pre-wrap;font-size:14px">{escape(reason)}</div>

        <h3 style="margin:20px 0 6px">Reported player &mdash; last 10 chat messages</h3>
        {_logs_html(reported_logs)}

        <h3 style="margin:20px 0 6px">Reporter &mdash; last 10 chat messages</h3>
        {_logs_html(reporter_logs)}
      </div>
    """

    sent = False
    err = None
    if not RESEND_API_KEY:
        err = "Email service not configured."
    else:
        payload: Dict[str, Any] = {
            "from": f"Idle Business Tycoon Reports <{RESEND_FROM_EMAIL}>",
            "to": [SUPPORT_EMAIL],
            "subject": f"[Player Report] {reported_name} reported by {reporter_name}",
            "html": html,
        }
        if report_doc["reporter_email"]:
            payload["reply_to"] = report_doc["reporter_email"]
        try:
            async with httpx.AsyncClient(timeout=20) as cx:
                resp = await cx.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                    json=payload,
                )
            if resp.status_code < 400:
                sent = True
                report_doc["resend_id"] = resp.json().get("id")
            else:
                err = f"{resp.status_code}: {resp.text}"
        except Exception as e:
            err = str(e)

    report_doc["email_sent"] = sent
    if err:
        report_doc["email_error"] = err[:500]
        logging.getLogger(__name__).warning("report-player email failed: %s", err)
    await db.reports.insert_one(dict(report_doc))

    if not sent:
        raise HTTPException(status_code=502, detail="We couldn't send your report right now. Please try again later.")
    return {"ok": True}


# ---------- Grand Prize achievement (Level 1000 on all businesses) ----------
GRAND_PRIZE_ACHIEVEMENT_ID = "all_level_1000"


async def _send_support_email(subject: str, html: str) -> tuple[bool, Optional[str]]:
    if not RESEND_API_KEY:
        return False, "Email service not configured."
    try:
        async with httpx.AsyncClient(timeout=20) as cx:
            resp = await cx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={
                    "from": f"Idle Business Tycoon <{RESEND_FROM_EMAIL}>",
                    "to": [SUPPORT_EMAIL],
                    "subject": subject,
                    "html": html,
                },
            )
        if resp.status_code < 400:
            return True, None
        return False, f"{resp.status_code}: {resp.text}"
    except Exception as e:
        return False, str(e)


class GrandPrizeReq(BaseModel):
    device_id: str
    name: Optional[str] = None


@api_router.post("/achievements/grand-prize")
async def claim_grand_prize(req: GrandPrizeReq):
    if not req.device_id:
        raise HTTPException(status_code=400, detail="Missing device id")
    existing = await db.grand_prize_claims.find_one({"device_id": req.device_id})
    if existing:
        # Already recorded for this player — don't email again.
        return {"ok": True, "first": bool(existing.get("is_first")), "already": True}

    player = await db.players.find_one({"device_id": req.device_id}, {"_id": 0, "name": 1})
    name = (req.name or (player or {}).get("name") or "Anonymous Tycoon").strip()[:48]
    prior = await db.grand_prize_claims.count_documents({})
    is_first = prior == 0
    claim = {
        "id": uuidlib.uuid4().hex,
        "device_id": req.device_id,
        "name": name,
        "is_first": is_first,
        "created_at": now_iso(),
    }
    await db.grand_prize_claims.insert_one(dict(claim))

    # Announce to the whole player base in global chat.
    announce_text = (
        f"🏆 {name} is the FIRST tycoon to hit Level 1000 on ALL businesses and wins $1,000 USD! 🏆"
        if is_first
        else f"🏆 {name} just reached Level 1000 on ALL businesses!"
    )
    sys_msg = {
        "id": uuidlib.uuid4().hex,
        "device_id": "SYSTEM",
        "name": "🏆 Idle Business Tycoon",
        "text": announce_text,
        "created_at": now_iso(),
    }
    try:
        await db.chat_messages.insert_one(dict(sys_msg))
        await chat_manager.broadcast({"type": "message", **sys_msg})
    except Exception:
        pass

    place = "FIRST PLACE — $1,000 USD WINNER" if is_first else "another claimant (not first)"
    html = f"""
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111">
        <h2 style="margin:0 0 4px">&#127942; Grand Prize Achievement Unlocked</h2>
        <p style="color:#666;margin:0 0 16px;font-size:13px">{escape(claim['created_at'])}</p>
        <p style="font-size:15px">A player reached <b>Level 1000 on ALL businesses</b>.</p>
        <table style="border-collapse:collapse;width:100%;margin:12px 0">
          <tr><td style="padding:6px 0;color:#666;width:140px">Player</td><td style="padding:6px 0"><b>{escape(name)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">UUID</td><td style="padding:6px 0"><code>{escape(req.device_id)}</code></td></tr>
          <tr><td style="padding:6px 0;color:#666">Status</td><td style="padding:6px 0"><b>{escape(place)}</b></td></tr>
        </table>
        {"<p style='background:#FFF3CD;border-radius:8px;padding:12px;font-size:14px'>This is the <b>first</b> player to complete the challenge. They are eligible for the $1,000 USD prize.</p>" if is_first else "<p style='color:#888;font-size:13px'>The first-place prize has already been claimed by an earlier player.</p>"}
      </div>
    """
    sent, err = await _send_support_email(
        subject=f"[Grand Prize] {name} hit Level 1000 on all businesses" + (" — FIRST!" if is_first else ""),
        html=html,
    )
    await db.grand_prize_claims.update_one(
        {"device_id": req.device_id},
        {"$set": {"email_sent": sent, "email_error": (err or "")[:500]}},
    )
    if err:
        logging.getLogger(__name__).warning("grand-prize email failed: %s", err)
    return {"ok": True, "first": is_first, "email_sent": sent}


@api_router.get("/admin/player-achievements")
async def admin_player_achievements(device_id: str, request: Request):
    await _require_admin(request)
    player = await db.players.find_one(
        {"device_id": device_id},
        {"_id": 0, "name": 1, "achievements": 1, "net_worth": 1, "prestige_points": 1, "total_levels": 1, "gems": 1, "last_ip": 1, "updated_at": 1},
    )
    if not player:
        raise HTTPException(status_code=404, detail="No player found with that UUID")
    grand = await db.grand_prize_claims.find_one({"device_id": device_id}, {"_id": 0})
    return {
        "device_id": device_id,
        "name": player.get("name", "Anonymous Tycoon"),
        "achievements": player.get("achievements", []),
        "net_worth": player.get("net_worth", 0),
        "prestige_points": player.get("prestige_points", 0),
        "total_levels": player.get("total_levels", 0),
        "gems": player.get("gems", 0),
        "last_ip": player.get("last_ip", ""),
        "updated_at": player.get("updated_at", ""),
        "grand_prize": grand,
    }


# ---------- API key management (admin) ----------
@api_router.get("/admin/api-keys/status")
async def admin_api_keys_status(request: Request):
    """Returns which integrations are configured (key present) vs not.
    Never returns the keys themselves — only a boolean per integration."""
    await _require_admin(request)
    return {
        "google_pay": {
            "environment": GPAY_ENV,
            "merchant_id_set": bool(GPAY_MERCHANT_ID and GPAY_MERCHANT_ID != "TEST_MERCHANT_ID"),
            "merchant_name": GPAY_MERCHANT_NAME,
        },
        "resend": {
            "api_key": bool(getattr(_api_keys, "RESEND_API_KEY", "")),
            "from_email": getattr(_api_keys, "RESEND_FROM_EMAIL", ""),
            "support_email": getattr(_api_keys, "SUPPORT_EMAIL", ""),
        },
        "google_auth": {
            "base_url": getattr(_api_keys, "GOOGLE_AUTH_BASE", ""),
        },
        "admob": {
            "android_app_id": getattr(_api_keys, "ADMOB_ANDROID_APP_ID", ""),
            "ios_app_id": getattr(_api_keys, "ADMOB_IOS_APP_ID", ""),
            "banner_unit_id": bool(getattr(_api_keys, "ADMOB_BANNER_UNIT_ID", "")),
            "rewarded_unit_id": bool(getattr(_api_keys, "ADMOB_REWARDED_UNIT_ID", "")),
            "interstitial_unit_id": bool(getattr(_api_keys, "ADMOB_INTERSTITIAL_UNIT_ID", "")),
        },
    }


@api_router.post("/admin/api-keys/sync")
async def admin_api_keys_sync(request: Request):
    """Re-run the api_keys.py -> .env / app.json / adConfig.ts sync.
    Useful after editing backend/api_keys.py without restarting the server."""
    await _require_admin(request)
    # Reload module to pick up edits made on disk since startup.
    import importlib
    importlib.reload(_api_keys)
    paths = _api_keys.sync_all()
    load_dotenv(ROOT_DIR / '.env', override=True)
    return {"ok": True, "synced": paths}


app.include_router(api_router)


# Every player sees the same wheel because rounds are computed from a
# deterministic per-round seed on the server. Bets land in tycoontime_bets
# and winning bets get logged to tycoontime_wins for the live wins feed.

import hashlib

TT_BETTING_MS      = 15_000
TT_SPINNING_MS     =  6_500
TT_RESULT_MS       =  1_000   # snappy 1-second cool-down between normal rounds
TT_BONUS_EXTRA_MS  = 12_000   # extra hold-time on rounds that landed on a bonus
# Reset the round counter on Feb 12, 2026 so a fresh deploy doesn't have to
# replay every historic round (the cache below only needs to span "now" - this
# date). Old rounds stay in tycoontime_bets/wins but become unreachable.
TT_EPOCH_MS        = 1_739_318_400_000

# 30 segments total — 14× 1, 6× 2, 2× 5, 1× 10, 3× coinflip, 2× cashhunt,
# 1× pachinko, 1× crazy. Bonus segments are spaced evenly around the wheel so
# the visual feels balanced.
TT_SEGMENTS = [
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "coinflip", "label": "FLIP", "color": "#00897B", "mult": 1,  "bonus": "coinflip"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "5",        "label": "5",    "color": "#7B1FA2", "mult": 5,  "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "cashhunt", "label": "HUNT", "color": "#43A047", "mult": 1,  "bonus": "cashhunt"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "coinflip", "label": "FLIP", "color": "#00897B", "mult": 1,  "bonus": "coinflip"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "10",       "label": "10",   "color": "#E53935", "mult": 10, "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "pachinko", "label": "PACH", "color": "#D81B60", "mult": 1,  "bonus": "pachinko"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "cashhunt", "label": "HUNT", "color": "#43A047", "mult": 1,  "bonus": "cashhunt"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "5",        "label": "5",    "color": "#7B1FA2", "mult": 5,  "bonus": None},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "coinflip", "label": "FLIP", "color": "#00897B", "mult": 1,  "bonus": "coinflip"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
    {"bet": "2",        "label": "2",    "color": "#1E88E5", "mult": 2,  "bonus": None},
    {"bet": "crazy",    "label": "CRAZY","color": "#FF1744", "mult": 1,  "bonus": "crazy"},
    {"bet": "1",        "label": "1",    "color": "#FFB300", "mult": 1,  "bonus": None},
]


TT_TOP_BET_KEYS = ["1", "2", "5", "10", "coinflip", "cashhunt", "pachinko", "crazy"]


def _tt_top_slot(round_id: int):
    """75% miss, 12% 2x, 7% 3x, 4% 5x, 2% 10x. The multiplier applies to a
    single random bet key — if your winning bet is that key, you get the
    multiplier; otherwise top slot misses you regardless of the number."""
    r = _tt_rand(f"top:{round_id}")
    if r < 0.75:
        mult = 1  # miss
    elif r < 0.87:
        mult = 2
    elif r < 0.94:
        mult = 3
    elif r < 0.98:
        mult = 5
    else:
        mult = 10
    bet_idx = int(_tt_rand(f"topb:{round_id}") * len(TT_TOP_BET_KEYS))
    return mult, TT_TOP_BET_KEYS[bet_idx]


def _tt_now_ms() -> int:
    return int(time.time() * 1000)


# --- Variable-duration round system -----------------------------------------
# Each round is normally 22.5 s (betting 15 + spinning 6.5 + result 1). When
# the wheel lands on a bonus segment, the result phase stretches by 12 s so
# every player can watch the bonus mini-game play out before the next round
# starts. To keep round_id lookups O(1) we lazily cache cumulative end-times.

# _TT_ENDS[i] = absolute time (ms since EPOCH) when round i finishes.
_TT_ENDS: list[int] = []


def _tt_round_duration(rid: int) -> int:
    """Total ms for round `rid` — depends on whether its outcome is a bonus."""
    seg = TT_SEGMENTS[int(_tt_rand(f"seg:{rid}") * len(TT_SEGMENTS))]
    base = TT_BETTING_MS + TT_SPINNING_MS + TT_RESULT_MS
    return base + (TT_BONUS_EXTRA_MS if seg["bonus"] else 0)


def _tt_round_start(rid: int) -> int:
    """Absolute timestamp (ms) at which round `rid` begins. Builds the cache
    forward as needed — cheap because we only call this with rid <= current."""
    while len(_TT_ENDS) <= rid:
        next_start = _TT_ENDS[-1] if _TT_ENDS else TT_EPOCH_MS
        next_end = next_start + _tt_round_duration(len(_TT_ENDS))
        _TT_ENDS.append(next_end)
    return _TT_ENDS[rid - 1] if rid > 0 else TT_EPOCH_MS


def _tt_round_id() -> int:
    """Find which round the server is currently in. Extends the cache forward
    until it covers `now`. Each call is O(1) once the cache is warm."""
    now = _tt_now_ms()
    if now < TT_EPOCH_MS:
        return 0
    # Grow the cache until it covers `now`.
    while not _TT_ENDS or _TT_ENDS[-1] <= now:
        next_start = _TT_ENDS[-1] if _TT_ENDS else TT_EPOCH_MS
        _TT_ENDS.append(next_start + _tt_round_duration(len(_TT_ENDS)))
    # _TT_ENDS[rid] is the end of round rid. The current round is the smallest
    # rid such that _TT_ENDS[rid] > now. Since the cache grows monotonically,
    # this is the last cached round (or one before — binary-search for safety).
    lo, hi = 0, len(_TT_ENDS) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if _TT_ENDS[mid] > now:
            hi = mid
        else:
            lo = mid + 1
    return lo


def _tt_phase(round_id: int):
    """Return (phase_name, ms_left_in_phase, ms_left_in_round)."""
    start = _tt_round_start(round_id)
    duration = _tt_round_duration(round_id)
    elapsed = _tt_now_ms() - start
    if elapsed < TT_BETTING_MS:
        return ("betting", TT_BETTING_MS - elapsed, duration - elapsed)
    elapsed -= TT_BETTING_MS
    if elapsed < TT_SPINNING_MS:
        return ("spinning", TT_SPINNING_MS - elapsed, duration - (TT_BETTING_MS + elapsed))
    elapsed -= TT_SPINNING_MS
    result_ms = duration - TT_BETTING_MS - TT_SPINNING_MS
    return ("result", max(0, result_ms - elapsed), max(0, result_ms - elapsed))


def _tt_rand(seed: str) -> float:
    h = hashlib.sha256(seed.encode()).hexdigest()
    return int(h[:13], 16) / 2**52


def _tt_outcome(round_id: int):
    seg_idx = int(_tt_rand(f"seg:{round_id}") * len(TT_SEGMENTS))
    seg = TT_SEGMENTS[seg_idx]
    top_mult, top_bet = _tt_top_slot(round_id)
    bonus_mult = 1
    if seg["bonus"] == "coinflip":
        # CoinFlip: randomly land on one of a wide spread of multipliers
        # (2× – 50×). Deterministic per round so every player sees the same.
        cf_pool = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]
        bonus_mult = cf_pool[int(_tt_rand(f"cf:{round_id}") * len(cf_pool))]
    elif seg["bonus"] == "pachinko":
        r = _tt_rand(f"pa:{round_id}")
        bonus_mult = 5 if r < 0.55 else 10 if r < 0.85 else 25 if r < 0.97 else 50
    elif seg["bonus"] == "cashhunt":
        # CashHunt is unique: per-player payout depends on which cell each
        # player picks. The server's "bonus_mult" here is just the typical
        # winning cell value (kept for legacy/UI hints); real payouts are
        # computed by /api/tycoontime/cashhunt-pick based on cell index.
        r = _tt_rand(f"ch:{round_id}")
        bonus_mult = 7 if r < 0.45 else 15 if r < 0.78 else 35 if r < 0.95 else 100
    elif seg["bonus"] == "crazy":
        r = _tt_rand(f"cr:{round_id}")
        bonus_mult = 25 if r < 0.45 else 75 if r < 0.80 else 200 if r < 0.97 else 500
    return {
        "round_id": round_id,
        "seg_idx": seg_idx,
        "seg": seg,
        "top_mult": int(top_mult),
        "top_bet": top_bet,
        "bonus_mult": int(bonus_mult),
    }


class TTBetRequest(BaseModel):
    device_id: str
    name: str
    round_id: int
    bet: str
    wager: int


@api_router.get("/tycoontime/state")
async def tt_state():
    rid = _tt_round_id()
    phase, phase_ms, round_ms = _tt_phase(rid)
    out = _tt_outcome(rid)
    nxt = _tt_outcome(rid + 1)
    # Only surface wins for rounds that have ALREADY finished spinning so
    # the live-wins ticker can't spoil the wheel result.
    now_ms = _tt_now_ms()
    cur = db.tycoontime_wins.find(
        {"reveal_at_ms": {"$lte": now_ms}},
        {"_id": 0},
    ).sort("ts", -1).limit(30)
    wins = await cur.to_list(length=30)
    # Last-N spin history (always visible — these are finished rounds).
    hist_cursor = db.tycoontime_history.find({}, {"_id": 0}).sort("round_id", -1).limit(20)
    history = await hist_cursor.to_list(length=20)
    return {
        "round_id": rid,
        "phase": phase,
        "phase_ms": int(phase_ms),
        "round_ms": int(round_ms),
        "betting_ms_total": TT_BETTING_MS,
        "spinning_ms_total": TT_SPINNING_MS,
        "result_ms_total": TT_RESULT_MS,
        "outcome": {
            "seg_idx": out["seg_idx"],
            "seg": out["seg"],
            "top_mult": out["top_mult"],
            "top_bet": out["top_bet"],
            "bonus_mult": out["bonus_mult"],
        },
        "next": {"round_id": rid + 1, "seg_idx": nxt["seg_idx"]},
        "wins": wins,
        "history": history,
        "server_ms": _tt_now_ms(),
    }


@api_router.post("/tycoontime/bet")
async def tt_bet(body: TTBetRequest):
    if body.wager <= 0:
        raise HTTPException(400, "wager must be positive")
    if body.bet not in {s["bet"] for s in TT_SEGMENTS}:
        raise HTTPException(400, "invalid bet")
    cur_round = _tt_round_id()
    phase, _, _ = _tt_phase(cur_round)
    if body.round_id != cur_round:
        raise HTTPException(409, "round_mismatch")
    if phase != "betting":
        raise HTTPException(409, "betting_closed")
    name = (body.name or "Tycoon").strip()[:24]
    await db.tycoontime_bets.insert_one({
        "round_id": cur_round, "device_id": body.device_id, "name": name,
        "bet": body.bet, "wager": int(body.wager), "ts": _tt_now_ms(),
    })
    out = _tt_outcome(cur_round)
    seg = out["seg"]
    if seg["bet"] == body.bet:
        base_mult = out["bonus_mult"] if seg["bonus"] else seg["mult"]
        applied_top = out["top_mult"] if body.bet == out["top_bet"] else 1
        payout = int(body.wager * base_mult * applied_top)
        # Anchor the reveal time to the END of this round's spinning phase
        # so the live-wins ticker doesn't spoil the wheel.
        round_start_ms = _tt_round_start(cur_round)
        reveal_at_ms = round_start_ms + TT_BETTING_MS + TT_SPINNING_MS
        await db.tycoontime_wins.insert_one({
            "round_id": cur_round, "device_id": body.device_id, "name": name,
            "bet": body.bet, "wager": int(body.wager), "payout": payout,
            "seg_label": seg["label"], "seg_color": seg["color"],
            "top_mult": applied_top,
            "top_bet": out["top_bet"],
            "bonus_mult": out["bonus_mult"] if seg["bonus"] else None,
            "ts": _tt_now_ms(),
            "reveal_at_ms": reveal_at_ms,
        })
        # Queue the payout into pending_grants but mark it not-yet-claimable
        # until the wheel has finished spinning. The /grants/claim endpoint
        # will gate on this so the player can't see the payout before the
        # wheel actually lands.
        if payout > 0:
            await db.pending_grants.update_one(
                {"device_id": body.device_id},
                {"$inc": {"gems": payout}, "$set": {"gems_release_at_ms": max(
                    reveal_at_ms,
                    (await db.pending_grants.find_one({"device_id": body.device_id}, {"gems_release_at_ms": 1}) or {}).get("gems_release_at_ms", 0) or 0,
                )}},
                upsert=True,
            )
        # Record this round in the spin history (once, idempotent).
        await db.tycoontime_history.update_one(
            {"round_id": cur_round},
            {"$setOnInsert": {
                "round_id": cur_round,
                "seg_idx": out["seg_idx"],
                "seg_label": seg["label"],
                "seg_color": seg["color"],
                "seg_bet": seg["bet"],
                "bonus": seg["bonus"],
                "bonus_mult": out["bonus_mult"],
                "top_mult": out["top_mult"],
                "top_bet": out["top_bet"],
                "reveal_at_ms": reveal_at_ms,
            }},
            upsert=True,
        )
        return {"won": True, "payout": payout, "round_id": cur_round}
    # Even losing bets are still useful for the history table.
    round_start_ms = _tt_round_start(cur_round)
    reveal_at_ms = round_start_ms + TT_BETTING_MS + TT_SPINNING_MS
    await db.tycoontime_history.update_one(
        {"round_id": cur_round},
        {"$setOnInsert": {
            "round_id": cur_round,
            "seg_idx": out["seg_idx"],
            "seg_label": seg["label"],
            "seg_color": seg["color"],
            "seg_bet": seg["bet"],
            "bonus": seg["bonus"],
            "bonus_mult": out["bonus_mult"],
            "top_mult": out["top_mult"],
            "top_bet": out["top_bet"],
            "reveal_at_ms": reveal_at_ms,
        }},
        upsert=True,
    )
    return {"won": False, "payout": 0, "round_id": cur_round}


# Re-include router so the Tycoon Time routes registered above are mounted.
app.include_router(api_router)

# ---------- Mount email-auth + affiliate routers ----------
# Both modules need the live ``db`` handle; we attach it here (after the
# Motor client is created at module top) and register their /api routes.
# Indexes are created on the FastAPI startup event below so a slow Mongo
# connection on boot doesn't block module import.
import auth_email as _auth_email  # noqa: E402
import affiliate as _affiliate  # noqa: E402
import playbilling as _playbilling  # noqa: E402

_auth_email.attach(db)
_affiliate.attach(db)
import sys as _sys
_playbilling_router = _playbilling._setup(_sys.modules[__name__])
app.include_router(_auth_email.router)
app.include_router(_affiliate.router)
app.include_router(_playbilling_router)


@app.on_event("startup")
async def _bootstrap_auxiliary_indexes():
    try:
        await _auth_email.ensure_indexes()
        await _affiliate.ensure_indexes()
    except Exception as e:  # pragma: no cover
        logging.getLogger(__name__).warning("aux ensure_indexes failed: %s", e)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
