#!/bin/sh
set -eu

BOOTS="${BOOTS:-$(cd "$(dirname "$0")/.." && pwd)/bin/myanyagent-bootstrap.sh}"
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# Isolate global git config to avoid polluting the host
export GIT_CONFIG_GLOBAL="$TMPDIR/git-config-global"

# --- Setup: throwaway git repo with .myanyagent.toml ---
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

# --- Test 1: rejects when origin URL does not match toml repository ---
git remote set-url origin "https://github.com/other/repo.git"
if sh "$BOOTS" 2>/dev/null; then
  fail "bootstrap should reject mismatched origin"
fi
printf 'PASS: mismatched origin rejected\n'

# --- Test 2: rejects without .myanyagent.toml ---
git remote set-url origin "https://github.com/anyingiit/My_Nexus-Editor_Workspace.git"
rm -f .myanyagent.toml
if sh "$BOOTS" 2>/dev/null; then
  fail "bootstrap should reject missing .myanyagent.toml"
fi
printf 'PASS: missing toml rejected\n'

# --- Test 3: rejects when private key missing ---
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
if MYANYAGENT_PRIVATE_KEY="/nonexistent/key.pem" sh "$BOOTS" 2>/dev/null; then
  fail "bootstrap should reject missing private key"
fi
printf 'PASS: missing private key rejected\n'

# --- Test 4: writes correct .git/config when key exists (dry-run: skip smoke test) ---
# Generate a dummy RSA key so the key-exists check passes.
KEY="$TMPDIR/dummy.pem"
openssl genrsa -out "$KEY" 2048 2>/dev/null || fail "openssl genrsa failed"

# We expect bootstrap to fail at the smoke test (token mint will fail with a dummy
# key against the real GitHub API), but we verify .git/config was written first.
# Run bootstrap and capture output; it should write config before smoke test.
MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>"$TMPDIR/err" || true

# Verify git config was written
[ "$(git config --local user.name)" = "MyAnyAgent[bot]" ] || fail "user.name not set"
[ "$(git config --local user.email)" = "312959697+myanyagent[bot]@users.noreply.github.com" ] || fail "user.email not set"
[ "$(git config --local user.useConfigOnly)" = "true" ] || fail "useConfigOnly not set"
[ "$(git config --local commit.gpgsign)" = "false" ] || fail "gpgsign not set"
[ "$(git config --local credential.useHttpPath)" = "true" ] || fail "useHttpPath not set"
[ "$(git config --local myanyagent.repository)" = "anyingiit/My_Nexus-Editor_Workspace" ] || fail "myanyagent.repository not set"
[ "$(git config --local myanyagent.installationId)" = "151195329" ] || fail "myanyagent.installationId not set"
[ "$(git config --local myanyagent.privateKey)" = "$KEY" ] || fail "myanyagent.privateKey not set"
HELPER=$(git config --local credential.helper)
echo "$HELPER" | grep -q "myanyagent-credential-helper" || fail "credential.helper not set to helper path"
printf 'PASS: git config written correctly\n'

# --- Test 5: idempotent (second run produces same config) ---
MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>/dev/null || true
[ "$(git config --local myanyagent.repository)" = "anyingiit/My_Nexus-Editor_Workspace" ] || fail "idempotent run broke repository"
[ "$(git config --local user.name)" = "MyAnyAgent[bot]" ] || fail "idempotent run broke user.name"
printf 'PASS: idempotent\n'

# --- Test 6: [identity] section overrides bot identity + protects the toml ---
# A contribution worktree declares the human's identity; commits must be
# attributed to the human, and .myanyagent.toml must never enter the PR diff.
git init -q "$TMPDIR/repo2" || fail "git init repo2 failed"
cd "$TMPDIR/repo2"
# Deliberately put [identity] BEFORE [bot]: section parsing must not confuse them.
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[identity]
name = "anyingiit"
email = "42+anyingiit@users.noreply.github.com"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
git remote add origin "https://github.com/anyingiit/My_Nexus-Editor_Workspace.git" || fail "remote add repo2 failed"
MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>/dev/null || true
[ "$(git config --local user.name)" = "anyingiit" ] || fail "identity: user.name should be human, got: $(git config --local user.name)"
[ "$(git config --local user.email)" = "42+anyingiit@users.noreply.github.com" ] || fail "identity: user.email should be human, got: $(git config --local user.email)"
[ "$(git config --local myanyagent.repository)" = "anyingiit/My_Nexus-Editor_Workspace" ] || fail "identity: myanyagent.repository not set"
grep -qxF '.myanyagent.toml' .git/info/exclude || fail "identity: .myanyagent.toml not added to .git/info/exclude"
printf 'PASS: [identity] overrides bot identity and excludes toml\n'

# --- Test 7: bot-only toml does NOT touch .git/info/exclude ---
cd "$TMPDIR/repo"
if [ -f .git/info/exclude ] && grep -qxF '.myanyagent.toml' .git/info/exclude; then
  fail "bot-only mode must not add .myanyagent.toml to .git/info/exclude"
fi
printf 'PASS: bot-only mode leaves .git/info/exclude alone\n'

# --- Test 8: contribution mode works in a LINKED worktree (.git is a file) ---
# git worktree: .git is a gitdir file, so $root/.git/info/exclude does not exist;
# the exclude file lives in the main repo's git dir. Realistic flow: the toml is
# excluded from commits, so the worktree is created WITHOUT it and the agent
# writes it fresh (uncommitted) before bootstrap.
cd "$TMPDIR/repo2"
git commit -q --allow-empty -m "base" || fail "base commit in repo2 failed"
git worktree add -q "$TMPDIR/wt" -b contribution-test 2>/dev/null || fail "git worktree add failed"
cd "$TMPDIR/wt"
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
[identity]
name = "anyingiit"
email = "42+anyingiit@users.noreply.github.com"
EOF
MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>/dev/null || true
[ "$(git config --local user.email)" = "42+anyingiit@users.noreply.github.com" ] || fail "worktree: identity not written"
main_exclude=$(cd "$TMPDIR/repo2" && git rev-parse --git-path info/exclude)
case "$main_exclude" in /*) ;; *) main_exclude="$TMPDIR/repo2/$main_exclude";; esac
grep -qxF '.myanyagent.toml' "$main_exclude" || fail "worktree: exclude not written to $main_exclude"
printf 'PASS: contribution mode works in a linked worktree\n'

printf '\nALL bootstrap tests passed\n'
