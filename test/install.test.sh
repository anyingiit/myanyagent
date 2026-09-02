#!/bin/sh
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# Isolate global git config to avoid polluting the host
export GIT_CONFIG_GLOBAL="$TMPDIR/git-config-global"

# --- Setup: a clean HOME (nothing pre-installed) ---
TESTHOME="$TMPDIR/home"
mkdir -p "$TESTHOME"

# --- Test 1: install.sh ships lib/attribution.cjs into the installed layout ---
HOME="$TESTHOME" sh "$REPO_ROOT/install.sh" >/dev/null 2>&1 || fail "install.sh failed"
[ -f "$TESTHOME/.local/share/myanyagent/lib/attribution.cjs" ] \
  || fail "lib/attribution.cjs not installed"
printf 'PASS: install.sh ships lib/attribution.cjs\n'

# --- Test 1b: fresh install writes a PLACEHOLDER config — the author's
# client_id/app_id/private_key must NOT leak into a new machine's config ---
CFG="$TESTHOME/.config/myanyagent/config.toml"
[ -f "$CFG" ] || fail "config.toml not written"
grep -q 'REPLACE_ME' "$CFG" || fail "config.toml lacks placeholder values"
! grep -q 'Iv23lioD363YBpJJB9QE' "$CFG" || fail "author's client_id leaked into fresh install"
! grep -q '2026-08-04' "$CFG" || fail "author's dated key path leaked into fresh install"
grep -Eq 'install.sh prints|NEXT STEPS|placeholder' "$CFG" || true  # config may carry a pointer comment
printf 'PASS: fresh install writes placeholder config (no author values leak)\n'

# --- Test 1c: fresh install output tells the human what to fill in ---
FRESH_HOME="$TMPDIR/home-fresh"
mkdir -p "$FRESH_HOME"
OUT1=$(HOME="$FRESH_HOME" sh "$REPO_ROOT/install.sh" 2>&1)
echo "$OUT1" | grep -q 'client_id' || fail "fresh install output does not mention client_id"
echo "$OUT1" | grep -q 'private_key' || fail "fresh install output does not mention private_key"
printf 'PASS: install output lists required config fields\n'

# --- Test 1d: re-running install on a config that still has placeholders
# warns the human (the agent cannot notice this) ---
OUT2=$(HOME="$FRESH_HOME" sh "$REPO_ROOT/install.sh" 2>&1)
echo "$OUT2" | grep -q 'placeholder' || fail "re-install does not warn about placeholder config"
printf 'PASS: re-install warns while config still has placeholders\n'

# --- Test 2: end-to-end — clean HOME, bootstrap, commit carries the trailer
# WITHOUT injecting MYANYAGENT_LIB (the hook must find the installed lib) ---
git init -q "$TMPDIR/repo" || fail "git init failed"
cd "$TMPDIR/repo"
git config --global user.email "test@test.test" 2>/dev/null || true
git config --global user.name "Test" 2>/dev/null || true

cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
git remote add origin "https://github.com/anyingiit/My_Nexus-Editor_Workspace.git" || fail "remote add failed"

# Generate a dummy key so the key-exists check passes. The credential smoke
# test is skipped (MYANYAGENT_SKIP_SMOKE_TEST=1) so bootstrap is fully offline
# and must SUCCEED (exit 0) with config + hook written.
KEY="$TMPDIR/dummy.pem"
openssl genrsa -out "$KEY" 2048 2>/dev/null || fail "openssl genrsa failed"

BOOTS="$TESTHOME/.local/share/myanyagent/bin/myanyagent-bootstrap.sh"
[ -f "$BOOTS" ] || fail "bootstrap not installed"
HOME="$TESTHOME" MYANYAGENT_PRIVATE_KEY="$KEY" MYANYAGENT_SKIP_SMOKE_TEST=1 sh "$BOOTS" >/dev/null 2>&1 \
  || fail "bootstrap failed (must exit 0 offline with the smoke test skipped)"

# Commit with the hook active; MYANYAGENT_LIB must NOT be set (assert it).
[ -z "${MYANYAGENT_LIB:-}" ] || fail "MYANYAGENT_LIB unexpectedly set in test env"
echo x > f.txt
git add f.txt
HOME="$TESTHOME" git commit -q -m "feat: e2e" || fail "commit failed"
body=$(git log -1 --format=%B)
echo "$body" | grep -qF 'Co-authored-by: MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>' \
  || fail "trailer missing after clean-HOME install; body was: $body"
printf 'PASS: clean-HOME end-to-end commit carries the trailer\n'

printf '\nALL install tests passed\n'