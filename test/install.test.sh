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

# Generate a dummy key so the key-exists check passes; the credential smoke
# test will fail (dummy key + real GitHub) but config + hook are written first.
KEY="$TMPDIR/dummy.pem"
openssl genrsa -out "$KEY" 2048 2>/dev/null || fail "openssl genrsa failed"

BOOTS="$TESTHOME/.local/share/myanyagent/bin/myanyagent-bootstrap.sh"
[ -f "$BOOTS" ] || fail "bootstrap not installed"
HOME="$TESTHOME" MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" >/dev/null 2>&1 || true

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