"""Backend tests for Google-auth-button restoration round.

Verifies:
- GET /api/ returns 200
- POST /api/auth/session with a dummy session_id no longer returns 503
  ("not configured"); it should attempt upstream verification and fail
  gracefully (400/401/500 family from the upstream check).
- Email signup + login still works end-to-end with a real-looking TLD.
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Health ----------
def test_root_health(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    assert "Idle Business Tycoon" in r.json().get("message", "")


# ---------- Google session endpoint should no longer be "not configured" ----------
def test_auth_session_not_unconfigured(client):
    r = client.post(f"{API}/auth/session", json={"session_id": "DUMMY_INVALID_SESSION_ID"})
    # The fix means we should no longer get the 503 "not configured" path.
    assert r.status_code != 503, f"Endpoint still gated as 503 (not configured): {r.text}"
    # An invalid session id must NOT yield a real session.
    assert r.status_code != 200, f"Unexpected 200 with a dummy session id: {r.text}"
    # Acceptable: 400/401/403/500 family (upstream rejected it).
    assert r.status_code in (400, 401, 403, 422, 500, 502), (
        f"Unexpected status {r.status_code}: {r.text}"
    )


# ---------- Email auth still works ----------
@pytest.fixture(scope="module")
def email_creds():
    # Use a unique suffix so re-runs don't collide
    ts = int(time.time())
    return {
        "email": f"tester+{ts}@tycoonempire.app",
        "password": "Tycoon!2026",
        "name": "TEST Tycoon",
    }


def test_email_register(client, email_creds):
    r = client.post(f"{API}/auth/email/register", json={
        "email": email_creds["email"],
        "password": email_creds["password"],
        "name": email_creds["name"],
    })
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data and data["session_token"]
    assert data["user"]["email"].lower() == email_creds["email"].lower()


def test_email_login(client, email_creds):
    r = client.post(f"{API}/auth/email/login", json={
        "email": email_creds["email"],
        "password": email_creds["password"],
    })
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data and data["session_token"]


def test_email_login_wrong_password(client, email_creds):
    r = client.post(f"{API}/auth/email/login", json={
        "email": email_creds["email"],
        "password": "WRONG-PASSWORD-1",
    })
    assert r.status_code in (400, 401, 403), f"Wrong-password should fail: {r.status_code} {r.text}"
