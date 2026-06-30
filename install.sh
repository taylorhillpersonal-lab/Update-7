#!/usr/bin/env bash
# ==============================================================================
#  Tycoon Empire — one-shot installer for Ubuntu 24.04 LTS
# ==============================================================================
#  Run on a FRESH Ubuntu 24.04 VPS as a user with sudo (or as root):
#
#      curl -fsSL https://raw.githubusercontent.com/taylorhillpersonal-lab/Update-7/main/install.sh -o install.sh
#      chmod +x install.sh
#      sudo ./install.sh
#
#  Or, after cloning the repo:
#
#      sudo ./install.sh
#
#  You will be prompted for:
#    - domain name           (e.g. api.yourgame.com — must already point at this VPS)
#    - admin email           (used for Let's Encrypt notifications)
#    - resend API key        (or press Enter to skip outbound email)
#    - admob unit IDs        (or press Enter to keep the defaults)
#    - mongo auth?           (y/N — if yes, you'll be asked for a password)
#
#  You can also set these as env vars to run unattended:
#    DOMAIN=api.yourgame.com ADMIN_EMAIL=you@example.com \
#      RESEND_API_KEY=re_xxx MONGO_PASSWORD=changeme \
#      AUTO_YES=1 ./install.sh
#
#  Safe to re-run: each step is idempotent.
# ==============================================================================

set -euo pipefail
IFS=$'\n\t'

# ---------- pretty output ----------------------------------------------------
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
log()  { printf '%s[*]%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s[!]%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s[x]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
step() {
  printf '\n%s== %s ==%s\n' "$BOLD" "$*" "$RESET"
}

# ---------- preflight --------------------------------------------------------
if [[ "${EUID}" -ne 0 ]]; then
  die "Please run as root (or via sudo): sudo $0"
fi

if ! grep -qi 'ubuntu' /etc/os-release || ! grep -q 'VERSION_ID="24' /etc/os-release; then
  warn "This script is tuned for Ubuntu 24.04. Detected:"
  grep -E '^(NAME|VERSION_ID)=' /etc/os-release | sed 's/^/    /'
  if [[ "${AUTO_YES:-0}" != "1" ]]; then
    read -rp "Continue anyway? [y/N] " ans
    [[ "${ans,,}" == "y" ]] || die "Aborted."
  fi
fi

ARCH="$(dpkg --print-architecture)"
log "Architecture: ${ARCH}"

# ---------- gather inputs ----------------------------------------------------
step "Configuration"

prompt() {
  # prompt VAR "label" "default"
  local var="$1" label="$2" default="${3:-}" current
  current="${!var:-}"
  if [[ -n "$current" ]]; then
    log "$label = $current (from env)"
    return
  fi
  if [[ "${AUTO_YES:-0}" == "1" ]]; then
    printf -v "$var" '%s' "$default"
    log "$label = $default (auto)"
    return
  fi
  if [[ -n "$default" ]]; then
    read -rp "$label [$default]: " val
    val="${val:-$default}"
  else
    read -rp "$label: " val
  fi
  printf -v "$var" '%s' "$val"
}

prompt DOMAIN              "Public domain for the backend (e.g. api.yourgame.com)" ""
prompt ADMIN_EMAIL         "Admin email (for Let's Encrypt)"                       ""
prompt APP_DIR             "Install path"                                          "/opt/tycoon-empire"
prompt RUN_USER            "System user that will run the backend"                 "tycoon"
prompt GIT_REPO            "Git repo URL"                                          "https://github.com/taylorhillpersonal-lab/Update-7.git"
prompt GIT_BRANCH          "Git branch"                                            "main"
prompt DB_NAME             "MongoDB database name"                                 "tycoon_empire"
prompt RESEND_API_KEY      "Resend API key (blank = disable outbound email)"       ""
prompt RESEND_FROM_EMAIL   "Resend 'from' address"                                 "onboarding@resend.dev"
prompt SUPPORT_EMAIL_ADDR  "Support inbox (where player reports go)"               "support@hypnofusions.com"
prompt ADMOB_APP_ID        "AdMob App ID (blank = Google test ads)"                ""
prompt ADMOB_BANNER        "AdMob banner unit ID (blank = Google test ads)"        ""
prompt ADMOB_REWARDED      "AdMob rewarded unit ID (blank = Google test ads)"      ""
prompt ADMOB_INTERSTITIAL  "AdMob interstitial unit ID (blank = Google test ads)"  ""
prompt ANDROID_PKG         "Android package name"                                  "com.tycoonempire.app"

[[ -n "$DOMAIN" ]]      || die "DOMAIN is required."
[[ -n "$ADMIN_EMAIL" ]] || die "ADMIN_EMAIL is required."

# Mongo auth?
MONGO_AUTH="${MONGO_AUTH:-}"
if [[ -z "$MONGO_AUTH" && "${AUTO_YES:-0}" != "1" ]]; then
  read -rp "Enable MongoDB authentication? [y/N] " ans
  [[ "${ans,,}" == "y" ]] && MONGO_AUTH=1 || MONGO_AUTH=0
fi
MONGO_AUTH="${MONGO_AUTH:-0}"
MONGO_USER="${MONGO_USER:-tycoon}"
if [[ "$MONGO_AUTH" == "1" ]]; then
  if [[ -z "${MONGO_PASSWORD:-}" ]]; then
    if [[ "${AUTO_YES:-0}" == "1" ]]; then
      MONGO_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')"
      log "Generated MongoDB password (will be saved to /root/.tycoon-mongo-credentials)"
    else
      read -rsp "MongoDB password for user '$MONGO_USER': " MONGO_PASSWORD; echo
    fi
  fi
  # URI-encode reserved chars so passwords with @, :, /, ?, # etc. don't
  # corrupt the connection string we put into MONGO_URL.
  MONGO_PASSWORD_ENC="$(python3 -c 'import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$MONGO_PASSWORD")"
  MONGO_USER_ENC="$(python3 -c 'import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$MONGO_USER")"
  MONGO_URL="mongodb://${MONGO_USER_ENC}:${MONGO_PASSWORD_ENC}@127.0.0.1:27017/${DB_NAME}?authSource=admin"
else
  MONGO_URL="mongodb://localhost:27017"
fi

EMAIL_JWT_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
PUBLIC_BACKEND_URL="https://${DOMAIN}"

echo
log "Summary:"
cat <<EOSUM
    domain               $DOMAIN
    admin email          $ADMIN_EMAIL
    install dir          $APP_DIR
    run user             $RUN_USER
    git                  $GIT_REPO  ($GIT_BRANCH)
    mongo                $( [[ "$MONGO_AUTH" == "1" ]] && echo "authed (user=$MONGO_USER, db=$DB_NAME)" || echo "local, no auth" )
    public backend URL   $PUBLIC_BACKEND_URL
    resend               $( [[ -n "$RESEND_API_KEY" ]] && echo "configured" || echo "(disabled)" )
    android package      $ANDROID_PKG
EOSUM
echo

if [[ "${AUTO_YES:-0}" != "1" ]]; then
  read -rp "Proceed with install? [Y/n] " ans
  [[ "${ans,,}" == "n" ]] && die "Aborted."
fi

# ---------- system packages --------------------------------------------------
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -y upgrade
apt-get -y install \
  build-essential git curl wget gnupg ca-certificates ufw jq \
  python3 python3-venv python3-pip python3-dev \
  nginx openssl libssl-dev libffi-dev

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v20" ]]; then
  log "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get -y install nodejs
fi
if ! command -v yarn >/dev/null 2>&1; then
  npm install -g yarn@1.22.22
fi

ok "System packages installed: $(python3 --version), $(node -v), $(yarn -v)"

# ---------- MongoDB ----------------------------------------------------------
step "Installing MongoDB 7.x"
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
    | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get -y install mongodb-org
fi
systemctl enable --now mongod
ok "MongoDB running: $(mongod --version | head -1)"

if [[ "$MONGO_AUTH" == "1" ]]; then
  step "Enabling MongoDB authentication"
  # Auth may already be enabled from a previous run. Detect by trying an
  # unauthenticated admin command; if it fails, we connect WITH creds.
  MONGO_AUTH_ON=0
  if ! mongosh --quiet --eval 'db.adminCommand({listDatabases:1})' >/dev/null 2>&1; then
    MONGO_AUTH_ON=1
    log "Authorization is already enabled; reconnecting with credentials"
  fi
  # Pass user/password to mongosh via env so single-quotes / @ / : in the
  # password can never break out of the JS string literal.
  MONGOSH_CMD=(mongosh --quiet)
  if [[ "$MONGO_AUTH_ON" == "1" ]]; then
    MONGOSH_CMD+=(-u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin)
  fi
  log "Creating/rotating user '$MONGO_USER' (idempotent)"
  MONGO_USER_ENV="$MONGO_USER" MONGO_PASSWORD_ENV="$MONGO_PASSWORD" MONGO_DB_ENV="$DB_NAME" \
    "${MONGOSH_CMD[@]}" --eval '
      const u = process.env.MONGO_USER_ENV;
      const p = process.env.MONGO_PASSWORD_ENV;
      const d = process.env.MONGO_DB_ENV;
      db = db.getSiblingDB("admin");
      if (!db.getUser(u)) {
        db.createUser({user: u, pwd: p,
          roles: [
            { role: "readWrite", db: d },
            { role: "userAdminAnyDatabase", db: "admin" }
          ]});
        print("user created");
      } else {
        db.changeUserPassword(u, p);
        print("user existed, password rotated");
      }
    '
  if ! grep -q '^\s*authorization:\s*enabled' /etc/mongod.conf; then
    log "Turning on authorization in /etc/mongod.conf"
    if grep -q '^security:' /etc/mongod.conf; then
      sed -i 's/^security:.*/security:\n  authorization: enabled/' /etc/mongod.conf
    else
      printf '\nsecurity:\n  authorization: enabled\n' >> /etc/mongod.conf
    fi
    systemctl restart mongod
    sleep 2
  fi
  cat > /root/.tycoon-mongo-credentials <<EOF
MONGO_USER=${MONGO_USER}
MONGO_PASSWORD=${MONGO_PASSWORD}
MONGO_URL=${MONGO_URL}
EOF
  chmod 600 /root/.tycoon-mongo-credentials
  ok "MongoDB auth enabled. Credentials saved to /root/.tycoon-mongo-credentials"
fi

# ---------- system user ------------------------------------------------------
step "Creating system user '${RUN_USER}' and install dir ${APP_DIR}"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_DIR" --shell /bin/bash "$RUN_USER"
fi
mkdir -p "$APP_DIR"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

# ---------- clone / update repo ---------------------------------------------
step "Fetching source"
if [[ -d "$APP_DIR/.git" ]]; then
  log "Repo already present, pulling latest"
  sudo -u "$RUN_USER" -H git -C "$APP_DIR" fetch origin "$GIT_BRANCH"
  sudo -u "$RUN_USER" -H git -C "$APP_DIR" checkout "$GIT_BRANCH"
  sudo -u "$RUN_USER" -H git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"
else
  # If the install dir contains a stray non-empty checkout without .git,
  # refuse to overwrite. Otherwise clone in.
  if [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
    die "$APP_DIR is not empty and is not a git checkout. Move it aside and re-run."
  fi
  sudo -u "$RUN_USER" -H git clone --branch "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
fi

# ---------- write api_keys.py (single source of truth) -----------------------
step "Writing backend/api_keys.py"
API_KEYS_FILE="$APP_DIR/backend/api_keys.py"

# Escape strings for safe embedding in Python source.
py_quote() { python3 -c 'import sys, json; print(json.dumps(sys.argv[1]))' "$1"; }

# NOTE: two here-docs are used on purpose.
#   1) The CONFIG block uses an UNQUOTED here-doc (<<EOF) so $(py_quote ...) /
#      $(date ...) expand. None of those lines contain backslashes.
#   2) The SYNC ENGINE uses a QUOTED here-doc (<<'PYEOF') so bash does NO
#      backslash/variable processing. Writing the engine through an unquoted
#      here-doc collapses "\\" -> "\" and produces a SyntaxError.
cat > "$API_KEYS_FILE" <<EOF
"""
Tycoon Empire — single source of truth for every secret / DB / public URL.

Generated by install.sh on $(date -u +'%Y-%m-%dT%H:%M:%SZ'). Edit freely; on the
next backend start (or on POST /api/admin/api-keys/sync) the values below are
written into the two git-ignored dotenv files (backend/.env, frontend/.env).
No tracked/core source file is ever rewritten, so GitHub can override the core
files on every update without losing config.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

# ---- Database ---------------------------------------------------------------
MONGO_URL: str = $(py_quote "$MONGO_URL")
DB_NAME: str   = $(py_quote "$DB_NAME")

# ---- Public backend URL (used by the Expo app) ------------------------------
EXPO_PUBLIC_BACKEND_URL: str = $(py_quote "$PUBLIC_BACKEND_URL")

# ---- Email + password auth (JWT signing) ------------------------------------
EMAIL_JWT_SECRET: str = $(py_quote "$EMAIL_JWT_SECRET")

# ---- Google Pay (web checkout fallback) -------------------------------------
GOOGLE_PAY_ENV: str           = "TEST"
GOOGLE_PAY_MERCHANT_ID: str   = "TEST_MERCHANT_ID"
GOOGLE_PAY_MERCHANT_NAME: str = "Tycoon Empire (TEST)"

# ---- Google Play Billing (Android in-app purchases) -------------------------
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH: str = ""
ANDROID_PACKAGE_NAME: str = $(py_quote "$ANDROID_PKG")

# ---- Resend (transactional email) -------------------------------------------
RESEND_API_KEY: str    = $(py_quote "$RESEND_API_KEY")
RESEND_FROM_EMAIL: str = $(py_quote "$RESEND_FROM_EMAIL")
SUPPORT_EMAIL: str     = $(py_quote "$SUPPORT_EMAIL_ADDR")

# ---- Google OAuth (sign in with Google) -------------------------------------
GOOGLE_AUTH_BASE: str = ""

# ---- AdMob (public IDs; blank = Google test ads) ----------------------------
ADMOB_ANDROID_APP_ID: str       = $(py_quote "$ADMOB_APP_ID")
ADMOB_IOS_APP_ID: str           = $(py_quote "$ADMOB_APP_ID")
ADMOB_BANNER_UNIT_ID: str       = $(py_quote "$ADMOB_BANNER")
ADMOB_REWARDED_UNIT_ID: str     = $(py_quote "$ADMOB_REWARDED")
ADMOB_INTERSTITIAL_UNIT_ID: str = $(py_quote "$ADMOB_INTERSTITIAL")
EOF

# --- static sync engine (verbatim; quoted here-doc so backslashes survive) ---
cat >> "$API_KEYS_FILE" <<'PYEOF'

# ============================================================================
#                            SYNC ENGINE
# Only ever writes the two git-ignored .env files; never edits tracked source.
# ============================================================================

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent
_FRONTEND_DIR = _REPO_ROOT / "frontend"

_BACKEND_ENV  = _BACKEND_DIR / ".env"
_FRONTEND_ENV = _FRONTEND_DIR / ".env"


def _upsert_env(path: Path, kv: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    order: List[str] = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                order.append(line); continue
            k, _, v = line.partition("=")
            k = k.strip()
            existing[k] = v
            order.append(k)
    for k, v in kv.items():
        sv = "" if v is None else str(v)
        needs_quotes = any(c in sv for c in (" ", "#", '"', "'"))
        if needs_quotes:
            # Escape backslashes and inner double-quotes before wrapping.
            escaped = sv.replace("\\", "\\\\").replace('"', '\\"')
            existing[k] = f'"{escaped}"'
        else:
            existing[k] = sv
        if k not in order:
            order.append(k)
    seen = set(); lines: List[str] = []
    for token in order:
        if token in existing and token not in seen:
            lines.append(f"{token}={existing[token]}"); seen.add(token)
        elif token not in existing:
            lines.append(token)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def sync_all() -> List[str]:
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
        "EXPO_PUBLIC_BACKEND_URL": EXPO_PUBLIC_BACKEND_URL,
    })
    _upsert_env(_FRONTEND_ENV, {
        "EXPO_PUBLIC_BACKEND_URL": EXPO_PUBLIC_BACKEND_URL,
        "EXPO_PUBLIC_ANDROID_PACKAGE": ANDROID_PACKAGE_NAME,
        "EXPO_PUBLIC_ADMOB_ANDROID_APP_ID": ADMOB_ANDROID_APP_ID,
        "EXPO_PUBLIC_ADMOB_IOS_APP_ID": ADMOB_IOS_APP_ID,
        "EXPO_PUBLIC_ADMOB_BANNER_ID": ADMOB_BANNER_UNIT_ID,
        "EXPO_PUBLIC_ADMOB_REWARDED_ID": ADMOB_REWARDED_UNIT_ID,
        "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID": ADMOB_INTERSTITIAL_UNIT_ID,
    })
    return [str(_BACKEND_ENV), str(_FRONTEND_ENV)]


if __name__ == "__main__":
    for p in sync_all():
        print(f"wrote {p}")
PYEOF
chown "$RUN_USER:$RUN_USER" "$API_KEYS_FILE"
chmod 640 "$API_KEYS_FILE"
ok "Wrote $API_KEYS_FILE"

# ---------- Python venv + deps ----------------------------------------------
step "Setting up Python virtualenv"
sudo -u "$RUN_USER" -H bash -c "
  set -e
  cd '$APP_DIR'
  python3 -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip wheel setuptools
"

# Stripped requirements: drop emergent-only wheels that may not install on arm64.
REQS="$APP_DIR/backend/requirements.txt"
REQS_VPS="$APP_DIR/backend/requirements.vps.txt"
sudo -u "$RUN_USER" -H bash -c "
  grep -vE '^(emergentintegrations|litellm)' '$REQS' > '$REQS_VPS'
"

set +e
sudo -u "$RUN_USER" -H bash -c "
  . '$APP_DIR/.venv/bin/activate'
  pip install -r '$REQS_VPS'
"
PIP_STATUS=$?
set -e
if [[ $PIP_STATUS -ne 0 ]]; then
  die "pip install failed. See output above."
fi
ok "Python deps installed"

# ---------- run sync_all() once to materialise .env etc. ---------------------
step "Materialising downstream config files"
sudo -u "$RUN_USER" -H bash -c "
  cd '$APP_DIR'
  . .venv/bin/activate
  cd backend && python -c 'import api_keys; [print(\"wrote\", p) for p in api_keys.sync_all()]'
"

# ---------- systemd service --------------------------------------------------
step "Installing systemd service tycoon-backend"
cat > /etc/systemd/system/tycoon-backend.service <<EOF
[Unit]
Description=Tycoon Empire FastAPI backend
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_DIR}/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=${APP_DIR}/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --workers 2
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tycoon-backend
sleep 3
if ! systemctl is-active --quiet tycoon-backend; then
  warn "tycoon-backend failed to start. Last 30 log lines:"
  journalctl -u tycoon-backend -n 30 --no-pager || true
  die "Backend not running."
fi
HEALTH=$(curl -fsS --max-time 5 http://127.0.0.1:8001/api/ || true)
if [[ "$HEALTH" != *"Tycoon Empire API"* ]]; then
  warn "Health probe response: $HEALTH"
  die "Backend is up but /api/ did not return the expected payload."
fi
ok "Backend healthy: $HEALTH"

# ---------- nginx ------------------------------------------------------------
step "Configuring nginx for $DOMAIN"
NGINX_FILE="/etc/nginx/sites-available/tycoon-empire"
cat > "$NGINX_FILE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /api/ {
        proxy_pass         http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 86400;
    }

    location / {
        default_type text/plain;
        return 200 'Tycoon Empire backend is up. Get the app on Play Store.';
    }
}
EOF
ln -sf "$NGINX_FILE" /etc/nginx/sites-enabled/tycoon-empire
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ok "nginx reverse-proxy live on :80 for $DOMAIN"

# ---------- firewall ---------------------------------------------------------
step "Configuring UFW firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
yes | ufw enable >/dev/null || true
ok "UFW enabled (OpenSSH + Nginx Full)"

# ---------- HTTPS (Let's Encrypt) -------------------------------------------
step "Provisioning HTTPS cert via Let's Encrypt"
apt-get -y install certbot python3-certbot-nginx >/dev/null
if certbot certificates 2>/dev/null | grep -qE "^[[:space:]]*Domains:[[:space:]]+${DOMAIN}([[:space:]]|$)"; then
  log "Cert already exists for $DOMAIN — skipping issuance"
else
  if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect; then
    warn "certbot failed. Make sure $DOMAIN resolves to this VPS over port 80."
    warn "You can re-run later with:   sudo certbot --nginx -d $DOMAIN"
  fi
fi
systemctl reload nginx

# Final HTTPS probe.
HTTPS_HEALTH=$(curl -fsS --max-time 10 "https://${DOMAIN}/api/" || true)
if [[ "$HTTPS_HEALTH" == *"Idle Business Tycoon API"* ]]; then
  ok "HTTPS reachable: https://${DOMAIN}/api/ -> $HTTPS_HEALTH"
else
  warn "HTTPS probe didn't return the expected body. Last response: $HTTPS_HEALTH"
fi

# ---------- summary ----------------------------------------------------------
step "All done"
cat <<EOF

  Idle Business Tycoon backend is live!

    Backend health     curl https://${DOMAIN}/api/
    Logs               journalctl -u tycoon-backend -f
    Restart            systemctl restart tycoon-backend
    Single config      ${APP_DIR}/backend/api_keys.py
    Re-sync after edit POST https://${DOMAIN}/api/admin/api-keys/sync
                       (admin auth required)
$( [[ "$MONGO_AUTH" == "1" ]] && echo "    Mongo creds        /root/.tycoon-mongo-credentials" )

  NEXT STEPS:

    1. Promote yourself to admin once you've signed up in the app:
         mongosh ${DB_NAME} --eval 'db.players.updateOne({device_id:"<your-uuid>"}, {\$set:{is_admin:true}})'

    2. To enable Google Play Billing (real Android IAP):
         - drop your Google Play service-account JSON on the box
         - edit ${APP_DIR}/backend/api_keys.py:
             GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH = "/etc/tycoon/play-service-account.json"
         - systemctl restart tycoon-backend

    3. Build the signed Android AAB on your laptop with:
         cd frontend && npx expo prebuild --platform android --clean
         cd android && ./gradlew bundleRelease

  Have fun.

EOF
