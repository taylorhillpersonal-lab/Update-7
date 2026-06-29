"""
Email + password authentication.

Issues opaque session tokens through the existing ``user_sessions`` collection
so the rest of the app (``_user_from_token`` / ``/auth/me`` / ``/auth/logout``)
treats email-auth users exactly like Google-auth users — one auth pathway, one
user shape downstream.

A short-lived JWT is also signed and returned so the frontend can persist a
single token; we still look up the session row in Mongo on every protected
request via ``/auth/me`` (cheap, indexed), trading statelessness for the
ability to revoke sessions instantly on logout.
"""
from __future__ import annotations

import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from affiliate import apply_referral_on_signup

router = APIRouter(prefix="/api/auth/email", tags=["auth-email"])

JWT_SECRET = os.environ.get("EMAIL_JWT_SECRET")
if not JWT_SECRET:
    # The .env loader runs before this module is imported, so an empty value
    # here means the secret was actually omitted. Fail loud.
    raise RuntimeError("EMAIL_JWT_SECRET is required (set it in backend/.env).")
# Refuse to boot with any of the well-known placeholder values shipped in
# api_keys.py templates / generators. Otherwise anyone who's read the public
# template can forge session JWTs for every email-auth account.
_PLACEHOLDER_SECRETS = {
    "CHANGE_ME_TO_A_LONG_RANDOM_STRING_OR_THE_SERVER_WILL_REFUSE_TO_BOOT",
    "changeme",
    "change-me",
    "your-secret-here",
    "secret",
}
if JWT_SECRET in _PLACEHOLDER_SECRETS or JWT_SECRET.startswith("CHANGE_ME"):
    raise RuntimeError(
        "EMAIL_JWT_SECRET is set to a known placeholder. "
        "Generate a real secret: python3 -c \"import secrets; print(secrets.token_urlsafe(64))\" "
        "and put it in backend/api_keys.py."
    )

JWT_ALG = "HS256"
SESSION_DAYS = 30
ALPHABET = string.ascii_uppercase + string.digits


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=2, max_length=24)
    referral_code: Optional[str] = Field(default=None, min_length=4, max_length=16)
    device_id: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    device_id: Optional[str] = None


# ---------- Helpers ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _new_user_id() -> str:
    return "user_" + secrets.token_hex(6)


def _new_session_token() -> str:
    # 256-bit URL-safe token. Stored in user_sessions; the JWT we hand to the
    # client carries this same token in its ``sid`` claim so we can revoke.
    return secrets.token_urlsafe(32)


def _sign_jwt(session_token: str, user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sid": session_token,
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=SESSION_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


# ---------- Wiring ----------
# server.py injects the live mongo handle into ``_state["db"]`` on startup —
# we avoid importing server.py to dodge a circular dep.
_state: dict[str, Any] = {}


def attach(db: Any) -> None:
    _state["db"] = db


def _db() -> Any:
    db = _state.get("db")
    if db is None:
        raise RuntimeError("auth_email.attach(db) was never called")
    return db


async def ensure_indexes() -> None:
    db = _db()
    # ``email`` is sparse-unique because Google-auth users also live in the
    # same ``users`` collection and they all have an email; treat that as the
    # canonical uniqueness constraint for both auth providers.
    await db.users.create_index("email", unique=True, sparse=True, name="users_email_uniq")


# ---------- Routes ----------
@router.post("/register")
async def register(payload: RegisterIn):
    db = _db()
    email = payload.email.lower().strip()
    name = payload.name.strip()

    # If the email already exists, we accept ONLY if there's no password set
    # (i.e., it was previously linked through Google) and we're attaching the
    # password as a second auth method. Otherwise reject as duplicate.
    existing = await db.users.find_one({"email": email})
    if existing and existing.get("password_hash"):
        raise HTTPException(status_code=409, detail="An account with that email already exists. Try signing in.")

    user_id = existing["user_id"] if existing else _new_user_id()
    password_hash = hash_password(payload.password)
    now = datetime.now(timezone.utc)
    session_token = _new_session_token()

    user_doc = {
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": existing.get("picture") if existing else None,
        "is_admin": bool(existing.get("is_admin")) if existing else False,
        "device_id": payload.device_id,
        "password_hash": password_hash,
        "auth_provider": "email" if not existing else "email+google",
        "created_at": existing.get("created_at") if existing else now.isoformat(),
    }

    try:
        if existing:
            await db.users.update_one({"user_id": user_id}, {"$set": user_doc})
        else:
            await db.users.insert_one(user_doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="That email is already taken.")

    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "auth_provider": "email",
            "expires_at": now + timedelta(days=SESSION_DAYS),
            "created_at": now,
        }},
        upsert=True,
    )

    # Apply referral (idempotent — only the first redemption counts) BEFORE
    # we return so the client sees the grant on its very next /grants/claim.
    if payload.referral_code and payload.device_id:
        try:
            await apply_referral_on_signup(
                code=payload.referral_code,
                referee_device_id=payload.device_id,
                referee_name=name,
            )
        except HTTPException:
            # Bad code shouldn't block signup — silent on referral failure.
            pass

    user_view = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"session_token": _sign_jwt(session_token, user_id), "user": user_view}


@router.post("/login")
async def login(payload: LoginIn):
    db = _db()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    session_token = _new_session_token()
    now = datetime.now(timezone.utc)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user["user_id"],
            "auth_provider": "email",
            "expires_at": now + timedelta(days=SESSION_DAYS),
            "created_at": now,
        }},
        upsert=True,
    )
    if payload.device_id:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"device_id": payload.device_id}})

    user_view = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"session_token": _sign_jwt(session_token, user["user_id"]), "user": user_view}


def decode_jwt_session(jwt_token: str) -> Optional[str]:
    """Extract the ``sid`` (raw session_token) from a JWT we issued. Returns
    None if the JWT is invalid/expired — callers should then fall back to
    treating the token as an opaque session token (Google-auth path)."""
    try:
        payload = jwt.decode(jwt_token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sid")
    except jwt.PyJWTError:
        return None
