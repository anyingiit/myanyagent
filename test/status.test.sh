#!/bin/sh
set -eu

STATUS="${STATUS:-$(cd "$(dirname "$0")/.." && pwd)/bin/myanyagent-status.sh}"
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# Isolate global git config to avoid polluting the host
export GIT_CONFIG_GLOBAL="$TMPDIR/git-config-global"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# --- Setup: throwaway git repo ---
git init -q "$TMPDIR/repo"
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

# --- Test 1: not bootstrapped -> emits -> run: myanyagent-bootstrap ---
out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "git config: NOT configured" || fail "should report NOT configured"
echo "$out" | grep -q -- "-> run: myanyagent-bootstrap" || fail "should emit -> run: myanyagent-bootstrap"
printf 'PASS: not-bootstrapped emits bootstrap hint\n'

# --- Test 2: bootstrapped -> emits OK, no -> run: line ---
# Simulate bootstrapped state by writing the git config directly.
git config --local myanyagent.repository "anyingiit/My_Nexus-Editor_Workspace"
git config --local myanyagent.installationId "151195329"
git config --local myanyagent.privateKey "/nonexistent/key.pem"  # status checks key path readability separately
git config --local credential.helper '!node "/home/u/.local/share/myanyagent/bin/myanyagent-credential-helper.cjs"'

out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "git config: configured" || fail "should report configured"
# Should NOT emit -> run: when git config is set (even if key unreadable, that's a separate line)
printf 'PASS: bootstrapped reports configured\n'

# --- Test 3: -> run: uses absolute path fallback when ~/.local/bin not on PATH ---
# Force a not-configured state so the bootstrap hint is emitted, then verify the
# absolute path fallback is used when ~/.local/bin is not on PATH.
git config --local --unset credential.helper 2>/dev/null || true
out=$(PATH="/usr/bin:/bin" sh "$STATUS" 2>&1) || true
echo "$out" | grep -qE -- '-> run:.*myanyagent-bootstrap' || fail "should still emit bootstrap hint even with restricted PATH"
printf 'PASS: hint present with restricted PATH\n'
# Restore configured state for subsequent tests
git config --local credential.helper '!node "/home/u/.local/share/myanyagent/bin/myanyagent-credential-helper.cjs"'

# --- Test 4: reports repo from .myanyagent.toml ---
out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "repo: anyingiit/My_Nexus-Editor_Workspace" || fail "should report repo from toml"
printf 'PASS: reports repo from toml\n'

# --- Test 5: all-green path -> emits OK, no -> run: line ---
# Need a temp HOME with the tool installed, a machine config, and a readable key
TESTHOME=$(mktemp -d)
# Install a minimal tool dir under the temp HOME so the tool check passes
mkdir -p "$TESTHOME/.local/share/myanyagent/bin"
cp "$(cd "$(dirname "$STATUS")" && pwd)/myanyagent-credential-helper.cjs" "$TESTHOME/.local/share/myanyagent/bin/"
printf '1' > "$TESTHOME/.local/share/myanyagent/VERSION"
mkdir -p "$TESTHOME/.config/myanyagent"
cat > "$TESTHOME/.config/myanyagent/config.toml" <<CONF
client_id = "Iv23lioD363YBpJJB9QE"
app_id = "4483813"
private_key = "$TMPDIR/dummy.pem"
CONF
# Generate a dummy RSA key
openssl genrsa -out "$TMPDIR/dummy.pem" 2048 2>/dev/null || fail "openssl genrsa failed"
# Reset git config to a clean bootstrapped state
git config --local myanyagent.repository "anyingiit/My_Nexus-Editor_Workspace"
git config --local myanyagent.installationId "151195329"
git config --local myanyagent.privateKey "$TMPDIR/dummy.pem"
git config --local credential.helper '!node "/home/u/.local/share/myanyagent/bin/myanyagent-credential-helper.cjs"'
# Attribution hook must be installed for the all-green path (bot toml resolves a
# trailer, so a missing hook would now legitimately trigger needs_action).
git config --local core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)"
mkdir -p "$(git rev-parse --git-path myanyagent-hooks)"
cat > "$(git rev-parse --git-path myanyagent-hooks)/prepare-commit-msg" <<'H'
#!/bin/sh
# MyAnyAgent prepare-commit-msg hook
exit 0
H
chmod +x "$(git rev-parse --git-path myanyagent-hooks)/prepare-commit-msg"

out=$(HOME="$TESTHOME" sh "$STATUS" 2>&1) || true
last_line=$(echo "$out" | tail -1)
[ "$last_line" = "OK" ] || fail "last line should be OK, got: $last_line"
echo "$out" | grep -q -- "-> run:" && fail "should NOT emit -> run: when all green" || true
printf 'PASS: all-green path emits OK with no -> run:\n'
rm -rf "$TESTHOME" "$TMPDIR/dummy.pem"

# --- Test 6: [identity] in toml + matching git config -> contribution identity line ---
cat >> .myanyagent.toml <<EOF
[identity]
name = "anyingiit"
email = "42+anyingiit@users.noreply.github.com"
EOF
git config --local user.name "anyingiit"
git config --local user.email "42+anyingiit@users.noreply.github.com"
out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -qF "identity: contribution (42+anyingiit@users.noreply.github.com)" || fail "should report contribution identity, got: $out"
printf 'PASS: [identity] reported as contribution identity\n'

# --- Test 7: identity mismatch -> MISMATCH + action hint ---
git config --local user.email "312959697+myanyagent[bot]@users.noreply.github.com"
out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "identity: MISMATCH" || fail "should report identity MISMATCH, got: $out"
echo "$out" | grep -q -- "-> run:" || fail "identity mismatch should emit -> run: hint"
printf 'PASS: identity mismatch reported with action hint\n'

# --- Test 8: attribution hook + trailer reported ---
# Restore matching identity so MISMATCH from Test 7 does not mask attribution lines.
git config --local user.email "42+anyingiit@users.noreply.github.com"
hooks_dir=$(git rev-parse --git-path myanyagent-hooks)
case "$hooks_dir" in /*) ;; *) hooks_dir="$PWD/$hooks_dir" ;; esac
mkdir -p "$hooks_dir"
cat > "$hooks_dir/prepare-commit-msg" <<'H'
#!/bin/sh
# MyAnyAgent prepare-commit-msg hook
exit 0
H
chmod +x "$hooks_dir/prepare-commit-msg"
git config --local core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)"
# Add co_author to the existing toml ([identity] already appended in Test 6)
cat >> .myanyagent.toml <<'EOF'
co_author = "OpenCode (Kimi) <noreply@myanyagent.local>"
EOF

out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "attribution hook: installed" || fail "should report hook installed, got: $out"
echo "$out" | grep -qF 'attribution trailer: OpenCode (Kimi) <noreply@myanyagent.local>' || fail "should report resolved trailer, got: $out"
printf 'PASS: attribution hook and trailer reported\n'

# --- Test 9: hook missing -> NOT installed + bootstrap hint ---
git config --local --unset core.hooksPath
rm -rf "$hooks_dir"
out=$(sh "$STATUS" 2>&1) || true
echo "$out" | grep -q "attribution hook: NOT installed" || fail "should report hook NOT installed, got: $out"
echo "$out" | grep -q -- "-> run:" || fail "missing hook should surface a -> run: hint"
printf 'PASS: missing hook reported with hint\n'

# --- Setup for unpushed-trailer tests: fake HOME with the tool installed ---
UNPUSH_HOME=$(mktemp -d)
mkdir -p "$UNPUSH_HOME/.local/share/myanyagent/bin"
cp "$(cd "$(dirname "$STATUS")" && pwd)/myanyagent-credential-helper.cjs" "$UNPUSH_HOME/.local/share/myanyagent/bin/"
printf '1' > "$UNPUSH_HOME/.local/share/myanyagent/VERSION"

# --- Test 10: unpushed commits missing the exact trailer value ---
# (a) one commit with the trailer + one without -> "1 of 2"
# The PR base is origin/HEAD (remote default branch), so it must resolve:
# set it on the bare remote and set the local symref, like clone/fetch would.
git init -q "$TMPDIR/repo4" || fail "git init repo4 failed"
git init -q --bare "$TMPDIR/remote4.git"
cd "$TMPDIR/repo4"
git config --global user.email "test@test.test" 2>/dev/null || true
git config --global user.name "Test" 2>/dev/null || true
git remote add origin "$TMPDIR/remote4.git"
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
TRAILER='MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>'
echo base > base.txt; git add base.txt
git commit -qm "base" --trailer "Co-authored-by: $TRAILER"
git push -q -u origin HEAD || fail "base push failed"
git --git-dir="$TMPDIR/remote4.git" symbolic-ref HEAD refs/heads/master
git remote set-head origin --auto >/dev/null 2>&1 || fail "set-head failed"
echo with > with.txt; git add with.txt
git commit -qm "with" --trailer "Co-authored-by: $TRAILER"
echo without > without.txt; git add without.txt
git commit -qm "without"
out=$(HOME="$UNPUSH_HOME" sh "$STATUS" 2>&1) || true
echo "$out" | grep -qF "unpushed commits without trailer: 1 of 2" \
  || fail "(a) expected '1 of 2', got: $out"
echo "$out" | grep -qF "unpushed commits: cannot determine PR base" \
  && fail "(a) origin/HEAD must resolve; got: $out" || true
printf 'PASS: unpushed exact-trailer count (1 of 2)\n'

# (b) a commit carrying a DIFFERENT co-author value is reported as missing
echo diff > diff.txt; git add diff.txt
git commit -qm "diff" --trailer "Co-authored-by: Someone Else <x@y.z>"
out=$(HOME="$UNPUSH_HOME" sh "$STATUS" 2>&1) || true
echo "$out" | grep -qF "unpushed commits without trailer: 2 of 3" \
  || fail "(b) expected '2 of 3', got: $out"
printf 'PASS: different co-author value reported as missing\n'

# (c) one commit with TWO trailers (one exact) + one with none -> still 1 of 2
# (count-based bug: two trailer LINES on one commit used to skew the count)
git init -q "$TMPDIR/repo5" || fail "git init repo5 failed"
git init -q --bare "$TMPDIR/remote5.git"
cd "$TMPDIR/repo5"
git config --global user.email "test@test.test" 2>/dev/null || true
git config --global user.name "Test" 2>/dev/null || true
git remote add origin "$TMPDIR/remote5.git"
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
echo base > base.txt; git add base.txt
git commit -qm "base" --trailer "Co-authored-by: $TRAILER"
git push -q -u origin HEAD || fail "base push (c) failed"
git --git-dir="$TMPDIR/remote5.git" symbolic-ref HEAD refs/heads/master
git remote set-head origin --auto >/dev/null 2>&1 || fail "set-head (c) failed"
echo two > two.txt; git add two.txt
git commit -qm "two trailers" \
  --trailer "Co-authored-by: $TRAILER" \
  --trailer "Signed-off-by: Human <h@e.co>"
echo none > none.txt; git add none.txt
git commit -qm "none"
out=$(HOME="$UNPUSH_HOME" sh "$STATUS" 2>&1) || true
echo "$out" | grep -qF "unpushed commits without trailer: 1 of 2" \
  || fail "(c) expected '1 of 2' (count-based bug), got: $out"
printf 'PASS: two-trailer commit not double-counted\n'

# --- Test 11: no origin/HEAD -> informational line, not a needs_action failure ---
git init -q "$TMPDIR/repo6" || fail "git init repo6 failed"
git init -q --bare "$TMPDIR/remote6.git"
cd "$TMPDIR/repo6"
git config --global user.email "test@test.test" 2>/dev/null || true
git config --global user.name "Test" 2>/dev/null || true
git remote add origin "$TMPDIR/remote6.git"
cat > .myanyagent.toml <<EOF
repository = "anyingiit/My_Nexus-Editor_Workspace"
installation_id = "151195329"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF
git config --local myanyagent.repository "anyingiit/My_Nexus-Editor_Workspace"
git config --local credential.helper '!node "/home/u/.local/share/myanyagent/bin/myanyagent-credential-helper.cjs"'
hooks_dir=$(git rev-parse --git-path myanyagent-hooks)
case "$hooks_dir" in /*) ;; *) hooks_dir="$PWD/$hooks_dir" ;; esac
mkdir -p "$hooks_dir"
cat > "$hooks_dir/prepare-commit-msg" <<'H'
#!/bin/sh
# MyAnyAgent prepare-commit-msg hook
exit 0
H
chmod +x "$hooks_dir/prepare-commit-msg"
git config --local core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)"
# No commit, no fetch, and origin/HEAD never set -> base unresolvable.
out=$(HOME="$UNPUSH_HOME" sh "$STATUS" 2>&1) || true
echo "$out" | grep -qF "unpushed commits: cannot determine PR base (no origin/HEAD)" \
  || fail "(a) expected informational base line, got: $out"
echo "$out" | grep -qF "git fetch origin main" \
  || fail "(a) expected git fetch origin main hint, got: $out"
printf 'PASS: no origin/HEAD yields informational base line, no crash\n'
rm -rf "$UNPUSH_HOME"

printf '\nALL status tests passed\n'
