"""
================================================================================
 Tycoon Empire — SINGLE SOURCE OF TRUTH FOR ALL API KEYS / DB / SECRETS
================================================================================

This file is the ONLY place you edit when rotating credentials, plugging in real
keys for release, or moving to a new server.

After editing this file, restart the backend (or hit POST /api/admin/api-keys/sync)
and the values below are written into the two git-ignored dotenv files:

  - backend/.env    (server runtime env vars)
  - frontend/.env   (Expo public env vars: EXPO_PUBLIC_*)

Nothing else is touched. Crucially, NO tracked/core source file is rewritten,
so you can let GitHub freely override the core files on every update without
losing config:

  * Game / user DATA lives only in MongoDB.
  * CONFIG / SECRETS live only here (api_keys.py) and flow out to the .env files.
  * The core code (server.py, frontend/app.config.js, adConfig.ts, ...) reads
    those values from the environment — it never stores them.

NOTE: This file IS git-ignored (see .gitignore -> `backend/api_keys.py`). Do NOT
commit it. On each new VPS deploy install.sh regenerates it for you; on an
existing box you edit it in place and your real keys survive `git reset --hard`.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

# ------------------------------------------------------------------------------
# 1. DATABASE
# ------------------------------------------------------------------------------
# MongoDB connection string. Examples:
#   Local:        mongodb://localhost:27017
#   Replica set:  mongodb://user:pass@host1:27017,host2:27017/?replicaSet=rs0
#   Atlas:        mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net
MONGO_URL: str = "mongodb://localhost:27017"

# Logical database name inside the MongoDB instance. Pick anything; it will be
# auto-created on first write.
DB_NAME: str = "test_database"

# ------------------------------------------------------------------------------
# 2. PUBLIC BACKEND URL (used by the Expo app to call the API)
# ------------------------------------------------------------------------------
# The URL the mobile app hits. Must be reachable from real devices (NOT
# localhost). In production this is your VPS domain over HTTPS, e.g.
#   https://api.yourdomain.com
# The app appends `/api/...`; your reverse proxy must forward `/api/*` to :8001.
EXPO_PUBLIC_BACKEND_URL: str = "https://game-app-install.preview.emergentagent.com"

# ------------------------------------------------------------------------------
# 3. EMAIL+PASSWORD AUTH (JWT signing secret)
# ------------------------------------------------------------------------------
# Used to sign 30-day session JWTs for email-registered users. MUST be a long,
# random, secret string. Generate with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
# The server REFUSES TO BOOT while this is left at the placeholder below.
EMAIL_JWT_SECRET: str = "68zWavI47P4ALuIfv-b64xBwM5ubSVTqz3exzfueXzgU_3WTWT5xjAnQ8svb2SISxtXEUUN8z5JMA17aIlgg_g"

# ------------------------------------------------------------------------------
# 4. GOOGLE PAY (web checkout fallback — used on iOS / web / Expo Go)
# ------------------------------------------------------------------------------
# Sign up at https://pay.google.com/business/console
# Leave as TEST + TEST_MERCHANT_ID for development; the hosted checkout page
# accepts Google's test cards and never charges anyone. For production set
# GOOGLE_PAY_ENV="PRODUCTION" and use the Merchant ID from the Wallet Console.
GOOGLE_PAY_ENV: str = "TEST"                       # "TEST" | "PRODUCTION"
GOOGLE_PAY_MERCHANT_ID: str = "TEST_MERCHANT_ID"
GOOGLE_PAY_MERCHANT_NAME: str = "Tycoon Empire (TEST)"

# ------------------------------------------------------------------------------
# 5. GOOGLE PLAY BILLING (Android native in-app purchases)
# ------------------------------------------------------------------------------
# Required so the backend can verify purchases against Google Play before
# granting gems / keys / packs.
#   1. Play Console -> Setup -> API access -> link a Google Cloud project.
#   2. Create a Service Account, generate a JSON key.
#   3. Grant it "View financial data" + "Manage orders and subscriptions".
#   4. Drop the JSON on the server and set the absolute path below.
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH: str = ""    # absolute path or "" to disable

# Your app's Android package id. Drives backend Play-Billing verification AND
# (via frontend/.env -> app.config.js) the native Android package at build time.
ANDROID_PACKAGE_NAME: str = "com.tycoonempire.app"

# ------------------------------------------------------------------------------
# 6. RESEND (transactional email — admin reports + player support replies)
# ------------------------------------------------------------------------------
# Sign up at https://resend.com -> API Keys. Leave RESEND_API_KEY empty to
# disable outbound email (server still boots; email endpoints no-op).
RESEND_API_KEY: str = ""
RESEND_FROM_EMAIL: str = "onboarding@resend.dev"   # use a verified domain in production
SUPPORT_EMAIL: str = "support@hypnofusions.com"    # where player reports & feedback go

# ------------------------------------------------------------------------------
# 7. GOOGLE OAUTH (sign in with Google)
# ------------------------------------------------------------------------------
# The Expo app delegates Google sign-in to a hosted page at this URL. Leave
# empty to hide the "Continue with Google" button (email auth still works).
GOOGLE_AUTH_BASE: str = ""

# Backend session-data endpoint of your OAuth gateway. The app exchanges the
# session_id returned by GOOGLE_AUTH_BASE here and expects back
# {email, name, picture, session_token}. Empty = Google sign-in disabled.
GOOGLE_AUTH_SESSION_API: str = ""

# ------------------------------------------------------------------------------
# 8. ADMOB (banner / rewarded / interstitial ads)  —  PUBLIC, not secret
# ------------------------------------------------------------------------------
# Create an app + three ad units at https://admob.google.com and paste the IDs.
# These are public identifiers (they ship inside the built app); they are fanned
# out to frontend/.env as EXPO_PUBLIC_ADMOB_* and read by app.config.js (App IDs)
# and src/ads/adConfig.ts (unit IDs).
#
# IMPORTANT: While developing (`__DEV__ === true`) the app uses Google's official
# TEST ad units automatically — your real IDs are only used in signed release
# builds. Leaving these blank is safe (test ads are served).
ADMOB_ANDROID_APP_ID: str = ""
ADMOB_IOS_APP_ID: str = ""
ADMOB_BANNER_UNIT_ID: str = ""
ADMOB_REWARDED_UNIT_ID: str = ""
ADMOB_INTERSTITIAL_UNIT_ID: str = ""

# ==============================================================================
#                              SYNC ENGINE
#         (You normally don't need to touch anything below this line.)
#
# It only ever writes the two git-ignored .env files. It never edits a tracked
# source file, so GitHub can override the core files on every update safely.
# ==============================================================================

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent
_FRONTEND_DIR = _REPO_ROOT / "frontend"

_BACKEND_ENV = _BACKEND_DIR / ".env"
_FRONTEND_ENV = _FRONTEND_DIR / ".env"


def _upsert_env(path: Path, kv: dict) -> None:
    """Merge `kv` into a dotenv file at `path`. Keys already present are
    rewritten; unknown keys (e.g. EXPO_PACKAGER_HOSTNAME on the dev preview)
    are preserved. Creates the file if it doesn't exist."""
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    order: List[str] = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                order.append(line)
                continue
            if "=" not in line:
                order.append(line)
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            existing[k] = v
            order.append(k)
    # Update / append.
    for k, v in kv.items():
        sv = "" if v is None else str(v)
        # Quote values that contain spaces or special chars; bare otherwise.
        needs_quotes = any(c in sv for c in (" ", "#", '"', "'"))
        if needs_quotes:
            # Escape backslashes and inner double-quotes before wrapping.
            escaped = sv.replace("\\", "\\\\").replace('"', '\\"')
            rendered = f'"{escaped}"'
        else:
            rendered = sv
        existing[k] = rendered
        if k not in order:
            order.append(k)
    lines: List[str] = []
    seen = set()
    for token in order:
        if token in existing and token not in seen:
            lines.append(f"{token}={existing[token]}")
            seen.add(token)
        elif token not in existing:
            # comment / blank / unknown line: keep as-is
            lines.append(token)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def sync_all() -> List[str]:
    """Fan the values above out to the two git-ignored .env files.

    Returns the list of paths written, for the admin sync endpoint."""
    _upsert_env(_BACKEND_ENV, {
        "MONGO_URL": MONGO_URL,
        "DB_NAME": DB_NAME,
        "EMAIL_JWT_SECRET": EMAIL_JWT_SECRET,
        "GOOGLE_PAY_ENV": GOOGLE_PAY_ENV,
        "GOOGLE_PAY_MERCHANT_ID": GOOGLE_PAY_MERCHANT_ID,
        "GOOGLE_PAY_MERCHANT_NAME": GOOGLE_PAY_MERCHANT_NAME,
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH": GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH,
        "ANDROID_PACKAGE_NAME": ANDROID_PACKAGE_NAME,
        "RESEND_API_KEY": RESEND_API_KEY,
        "RESEND_FROM_EMAIL": RESEND_FROM_EMAIL,
        "SUPPORT_EMAIL": SUPPORT_EMAIL,
        "GOOGLE_AUTH_BASE": GOOGLE_AUTH_BASE,
        "GOOGLE_AUTH_SESSION_API": GOOGLE_AUTH_SESSION_API,
        # Backend needs this too (absolute redirect URLs for Google Pay page).
        "EXPO_PUBLIC_BACKEND_URL": EXPO_PUBLIC_BACKEND_URL,
    })
    _upsert_env(_FRONTEND_ENV, {
        "EXPO_PUBLIC_BACKEND_URL": EXPO_PUBLIC_BACKEND_URL,
        "EXPO_PUBLIC_GOOGLE_AUTH_BASE": GOOGLE_AUTH_BASE,
        # Native build config consumed by frontend/app.config.js:
        "EXPO_PUBLIC_ANDROID_PACKAGE": ANDROID_PACKAGE_NAME,
        "EXPO_PUBLIC_ADMOB_ANDROID_APP_ID": ADMOB_ANDROID_APP_ID,
        "EXPO_PUBLIC_ADMOB_IOS_APP_ID": ADMOB_IOS_APP_ID,
        # Runtime ad unit IDs consumed by src/ads/adConfig.ts:
        "EXPO_PUBLIC_ADMOB_BANNER_ID": ADMOB_BANNER_UNIT_ID,
        "EXPO_PUBLIC_ADMOB_REWARDED_ID": ADMOB_REWARDED_UNIT_ID,
        "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID": ADMOB_INTERSTITIAL_UNIT_ID,
    })
    return [str(_BACKEND_ENV), str(_FRONTEND_ENV)]


if __name__ == "__main__":  # `python -m backend.api_keys` to force a sync
    for p in sync_all():
        print(f"wrote {p}")
