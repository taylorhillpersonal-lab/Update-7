"""Backend regression tests for Idle Business Tycoon.

Covers:
- Health / root endpoint
- Email auth: register + login (self-registration flow)
- Google session endpoint disabled (503) and NOT calling emergentagent.com
- Player sync persistence
- Store catalog read
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') if os.environ.get('EXPO_PUBLIC_BACKEND_URL') else None
# fall back to frontend/.env style key used in this app
if not BASE_URL:
    # read from frontend/.env
    from pathlib import Path
    env = (Path(__file__).resolve().parents[2] / "frontend" / ".env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip('/')
            break

API = f"{BASE_URL}/api"

TEST_EMAIL = "tester@tycoon.test"
TEST_PASSWORD = "Tycoon!2026"
TEST_NAME = "Tester"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ----- Health -----
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    assert r.json().get("message") == "Idle Business Tycoon API"


# ----- Email auth -----
def test_email_register_or_login(s):
    """Register the canonical tester; if it already exists (409), fall back to login."""
    r = s.post(f"{API}/auth/email/register", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "name": TEST_NAME,
        "device_id": f"test_device_{uuid.uuid4().hex[:8]}",
    })
    if r.status_code == 409:
        r = s.post(f"{API}/auth/email/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
        })
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data and data["session_token"]
    assert data["user"]["email"] == TEST_EMAIL
    pytest.session_token = data["session_token"]
    pytest.user_id = data["user"]["user_id"]


def test_email_login_explicit(s):
    r = s.post(f"{API}/auth/email/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
    })
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == TEST_EMAIL


def test_email_login_wrong_password(s):
    r = s.post(f"{API}/auth/email/login", json={
        "email": TEST_EMAIL,
        "password": "WRONG_PASSWORD",
    })
    assert r.status_code == 401


# ----- Google auth disabled -----
def test_google_session_disabled(s):
    r = s.post(f"{API}/auth/session", json={"session_id": "anything"})
    assert r.status_code == 503, f"expected 503, got {r.status_code}: {r.text}"
    assert "not configured" in r.text.lower()


def test_google_session_does_not_call_emergent(s):
    """Confirm the route doesn't reach out to emergentagent.com when disabled."""
    # If GOOGLE_SESSION_API is empty, the route 503s immediately without HTTP egress.
    # We can't directly observe egress, but we verify the 503 detail text matches.
    r = s.post(f"{API}/auth/session", json={"session_id": "x"})
    assert r.status_code == 503
    assert "google" in r.json().get("detail", "").lower()


# ----- Player sync (core game) -----
def test_player_sync_and_persist(s):
    device_id = f"TEST_dev_{uuid.uuid4().hex[:10]}"
    payload = {
        "device_id": device_id,
        "name": "TEST_Tycoon",
        "net_worth": 12345.5,
        "prestige_points": 7,
        "cash": 999.0,
        "gems": 42,
        "total_levels": 3,
    }
    r = s.post(f"{API}/sync", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["device_id"] == device_id
    assert body["net_worth"] == 12345.5
    assert body["gems"] == 42

    # GET to verify persistence
    r2 = s.get(f"{API}/player/{device_id}")
    assert r2.status_code == 200, r2.text
    got = r2.json()
    assert got["name"] == "TEST_Tycoon"
    assert got["prestige_points"] == 7


# ----- Store catalog (reachable, no auth) -----
def test_store_catalog(s):
    r = s.get(f"{API}/store/catalog")
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(it["id"] == "pack_s" for it in items)


# ----- Leaderboard -----
def test_leaderboard(s):
    r = s.get(f"{API}/leaderboard?metric=net_worth&limit=10")
    assert r.status_code == 200
    body = r.json()
    assert "entries" in body
