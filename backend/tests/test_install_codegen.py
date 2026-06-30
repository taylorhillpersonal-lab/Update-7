"""
Validates /app/install.sh against the originally-reported bug:
the api_keys.py-generation block must produce a syntactically VALID,
compilable Python file even when env values contain backslashes and
double-quotes (which previously caused SyntaxError on line ~82 of the
generated file).

Tests:
  1. install.sh exists and `bash -n` passes
  2. The two here-docs render api_keys.py that py_compiles
  3. Importing the rendered module and calling sync_all() writes
     backend/.env and frontend/.env ONLY (no app.json / adConfig.ts)
  4. frontend/.env contains the EXPO_PUBLIC_ADMOB_* + EXPO_PUBLIC_ANDROID_PACKAGE keys
  5. Smoke: GET {EXPO_BACKEND_URL}/api/ returns 200
"""
import os
import re
import shlex
import subprocess
import sys
import importlib.util
from pathlib import Path

import pytest
import requests

INSTALL_SH = Path("/app/install.sh")


def _load_expo_backend_url() -> str:
    # Prefer process env; otherwise parse /app/frontend/.env
    for key in ("EXPO_BACKEND_URL", "EXPO_PUBLIC_BACKEND_URL"):
        v = os.environ.get(key, "").strip()
        if v:
            return v.rstrip("/")
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            for key in ("EXPO_BACKEND_URL=", "EXPO_PUBLIC_BACKEND_URL="):
                if line.startswith(key):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return val.rstrip("/")
    return ""


BASE_URL = _load_expo_backend_url()


# ---------------------------------------------------------------- helpers ----
def _extract_codegen_block(script_text: str) -> str:
    """
    Pull the two here-docs that write api_keys.py out of install.sh,
    plus the py_quote() helper, so we can execute them standalone in a
    temp dir with a controlled $APP_DIR.
    """
    # 1) py_quote helper
    m_helper = re.search(r"py_quote\(\)\s*\{[^}]+\}", script_text)
    assert m_helper, "py_quote() helper not found in install.sh"
    helper = m_helper.group(0)

    # 2) The unquoted here-doc:  cat > "$API_KEYS_FILE" <<EOF ... EOF
    m1 = re.search(
        r'(cat > "\$API_KEYS_FILE" <<EOF\n.*?\nEOF)\n',
        script_text,
        re.DOTALL,
    )
    assert m1, "unquoted config here-doc not found"

    # 3) The quoted here-doc:  cat >> "$API_KEYS_FILE" <<'PYEOF' ... PYEOF
    m2 = re.search(
        r"(cat >> \"\$API_KEYS_FILE\" <<'PYEOF'\n.*?\nPYEOF)\n",
        script_text,
        re.DOTALL,
    )
    assert m2, "quoted sync-engine here-doc not found"

    return helper + "\n" + m1.group(1) + "\n" + m2.group(1) + "\n"


# ------------------------------------------------------------- test cases ----
class TestInstallScriptSyntax:
    """install.sh shell-level sanity"""

    def test_install_sh_exists(self):
        assert INSTALL_SH.exists(), "/app/install.sh missing"
        assert INSTALL_SH.stat().st_size > 0

    def test_bash_n_clean(self):
        r = subprocess.run(
            ["bash", "-n", str(INSTALL_SH)],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, f"bash -n failed: {r.stderr}"


class TestApiKeysCodegen:
    """The historical bug lived here. Render api_keys.py with hostile inputs."""

    # password contains BOTH a backslash and a double quote -- exactly the
    # combination that used to mangle the unquoted here-doc into invalid Python.
    HOSTILE_SECRET = r'p@ss\word"with#both'

    @pytest.fixture(scope="class")
    def rendered(self, tmp_path_factory):
        workdir: Path = tmp_path_factory.mktemp("tycoon_install")
        app_dir = workdir / "app"
        (app_dir / "backend").mkdir(parents=True)
        (app_dir / "frontend").mkdir(parents=True)

        script_text = INSTALL_SH.read_text()
        codegen = _extract_codegen_block(script_text)

        env_setup = f"""
set -euo pipefail
export APP_DIR="{app_dir}"
export API_KEYS_FILE="$APP_DIR/backend/api_keys.py"
export MONGO_URL='mongodb://localhost:27017'
export DB_NAME='tycoon_test'
export PUBLIC_BACKEND_URL='https://example.test'
export EMAIL_JWT_SECRET={shlex.quote(self.HOSTILE_SECRET)}
export ANDROID_PKG='com.example.tycoon'
export RESEND_API_KEY='re_TEST_key\\with\\backslashes'
export RESEND_FROM_EMAIL='noreply@example.test'
export SUPPORT_EMAIL_ADDR='support@example.test'
export ADMOB_APP_ID='ca-app-pub-0000~1111'
export ADMOB_BANNER='ca-app-pub-0000/2222'
export ADMOB_REWARDED='ca-app-pub-0000/3333'
export ADMOB_INTERSTITIAL='ca-app-pub-0000/4444'
"""
            # Use python's own list2cmdline for safe shell-quoting of the hostile secret
        runner = workdir / "render.sh"
        runner.write_text(env_setup + "\n" + codegen)
        r = subprocess.run(
            ["bash", str(runner)],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"codegen block failed to run: stderr={r.stderr}\nstdout={r.stdout}"
        )
        api_keys = app_dir / "backend" / "api_keys.py"
        assert api_keys.exists(), "api_keys.py was not generated"
        return {"app_dir": app_dir, "api_keys": api_keys}

    def test_generated_file_compiles(self, rendered):
        """The bug: SyntaxError at line ~82. py_compile must succeed."""
        r = subprocess.run(
            [sys.executable, "-m", "py_compile", str(rendered["api_keys"])],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"Generated api_keys.py is NOT valid Python:\n{r.stderr}"
        )

    def test_generated_file_has_escape_sequence_intact(self, rendered):
        """
        Guard rail: ensure the sync-engine line that previously got mangled
        is still the canonical '\\\\' / '\\"' form in the rendered file.
        """
        text = rendered["api_keys"].read_text()
        assert 'sv.replace("\\\\", "\\\\\\\\")' in text, (
            "Backslash-escape line missing/mangled in generated api_keys.py"
        )
        assert '.replace(\'"\', \'\\\\"\')' in text, (
            "Double-quote-escape line missing/mangled in generated api_keys.py"
        )

    def test_sync_all_writes_only_env_files(self, rendered):
        """sync_all() must write backend/.env + frontend/.env and nothing else."""
        app_dir: Path = rendered["app_dir"]

        # Place a sentinel app.json + adConfig.ts; they MUST NOT be modified.
        app_json = app_dir / "frontend" / "app.json"
        ad_cfg = app_dir / "frontend" / "adConfig.ts"
        app_json.write_text('{"sentinel": true}\n')
        ad_cfg.write_text("export const SENTINEL = true;\n")
        app_json_before = app_json.read_text()
        ad_cfg_before = ad_cfg.read_text()

        # Dynamically import the generated module
        spec = importlib.util.spec_from_file_location(
            "generated_api_keys", rendered["api_keys"]
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        written = mod.sync_all()
        assert isinstance(written, list) and len(written) == 2

        be_env = app_dir / "backend" / ".env"
        fe_env = app_dir / "frontend" / ".env"
        assert be_env.exists(), "backend/.env not created"
        assert fe_env.exists(), "frontend/.env not created"

        # Sentinels untouched
        assert app_json.read_text() == app_json_before, "app.json was rewritten!"
        assert ad_cfg.read_text() == ad_cfg_before, "adConfig.ts was rewritten!"

        # Frontend .env carries the required public keys
        fe_text = fe_env.read_text()
        for required_key in (
            "EXPO_PUBLIC_BACKEND_URL",
            "EXPO_PUBLIC_ANDROID_PACKAGE",
            "EXPO_PUBLIC_ADMOB_ANDROID_APP_ID",
            "EXPO_PUBLIC_ADMOB_IOS_APP_ID",
            "EXPO_PUBLIC_ADMOB_BANNER_ID",
            "EXPO_PUBLIC_ADMOB_REWARDED_ID",
            "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID",
        ):
            assert required_key in fe_text, f"{required_key} missing in frontend/.env"

        # Backend .env retains the hostile JWT secret (round-tripped safely)
        be_text = be_env.read_text()
        assert "EMAIL_JWT_SECRET=" in be_text
        # The hostile chars must be preserved (after env-quoting rules)
        # Parse like a shell would: dotenv quoting -> unescape \\ and \"
        m = re.search(r'^EMAIL_JWT_SECRET=(.*)$', be_text, re.MULTILINE)
        assert m, "EMAIL_JWT_SECRET line not found"
        raw = m.group(1)
        if raw.startswith('"') and raw.endswith('"'):
            unescaped = raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        else:
            unescaped = raw
        assert unescaped == self.HOSTILE_SECRET, (
            f"Round-trip mismatch. Wanted {self.HOSTILE_SECRET!r}, got {unescaped!r}"
        )


class TestBackendSmoke:
    """Ensure the live backend is unaffected."""

    def test_api_root_200(self):
        assert BASE_URL, "EXPO_BACKEND_URL not set in env"
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200, f"GET /api/ -> {r.status_code}: {r.text[:200]}"
