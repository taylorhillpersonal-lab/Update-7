# Tycoon Empire — PRD

## Original problem statement
User has a React Native/Expo idle/tycoon mobile game ("Tycoon Empire") with a
FastAPI + MongoDB backend, self-hosted via an `install.sh` on a VPS and tracked
on GitHub (taylorhillpersonal-lab/Update-7). Work delivered across sessions:
1. Fixed `install.sh` here-doc bug that generated an invalid `api_keys.py`.
2. Removed dead Stripe payment dependency.
3. Removed AdMob IDs + the "$1,000 competition" promo banner.
4. Re-architected config: all DATA in MongoDB, all SECRETS/CONFIG in
   `api_keys.py` (git-ignored) → fanned out to `.env`; core source files hold
   no data so GitHub overrides are safe.
5. Imported the game into the Emergent `/app` workspace so it runs on preview.
6. Removed ALL Emergent branding/auth from code (Google sign-in now hidden &
   bring-your-own via `GOOGLE_AUTH_BASE`).

## Architecture
- Frontend: Expo Router (SDK 54), React Native, react-native-google-mobile-ads,
  expo-iap, victory-native. Email+password auth (JWT). Local cache via storage.
- Backend: FastAPI (`/api/*`), MongoDB (20+ collections: players, users, cities,
  payment_transactions, chat_messages, ...). Game state authoritative in Mongo
  via POST /api/sync.
- Config single-source: `backend/api_keys.py` (git-ignored) → backend/.env +
  frontend/.env (EXPO_PUBLIC_*). Frontend reads env via app.config.js & code.

## Implemented (2026-06-29)
- Preview bug fixed (game imported into /app, missing audio assets added).
- Emergent Google auth removed; `EXPO_PUBLIC_GOOGLE_AUTH_BASE` gates the button;
  `/api/auth/session` returns 503 until `GOOGLE_AUTH_SESSION_API` is set.
- Email register/login + game flow verified by testing agent (6/9 pytest; 3
  non-issues = reserved `.test` TLD).

## Backlog / next
- P0: Replace Emergent boilerplate app icon / splash / `app-image.png` 'e' logo
  with Tycoon Empire artwork (only remaining visible Emergent branding).
- P1: Wire user's own Google OAuth gateway (set GOOGLE_AUTH_BASE +
  GOOGLE_AUTH_SESSION_API in api_keys.py).
- P2: Migrate any remaining `expo-av` usage to `expo-audio`/`expo-video`.
- P2: server.py (~1700 lines) refactor into routers.

## Test credentials
See /app/memory/test_credentials.md (email auth; use a real-looking TLD).
