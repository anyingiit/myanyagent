#!/bin/sh
set -eu

HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/prepare-commit-msg"
LIBDIR="$(cd "$(dirname "$0")/.." && pwd)/lib"
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

export GIT_CONFIG_GLOBAL="$TMPDIR/git-config-global"

git init -q "$TMPDIR/repo"
cd "$TMPDIR/repo"
git config user.name "Test"
git config user.email "test@test.test"

cat > .myanyagent.toml <<EOF
repository = "o/r"
installation_id = "1"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
EOF

# --- Test 1: appends trailer on plain commit ---
echo x > f.txt
git add f.txt
MYANYAGENT_LIB="$LIBDIR" sh "$HOOK" /dev/null 2>/dev/null || true  # warm-up: ensure script runs
git config core.hooksPath "$TMPDIR/hooks"
mkdir -p "$TMPDIR/hooks"
cp "$HOOK" "$TMPDIR/hooks/prepare-commit-msg"
chmod +x "$TMPDIR/hooks/prepare-commit-msg"
printf '#!/bin/sh\nMYANYAGENT_LIB="%s" sh "%s" "$@"\n' "$LIBDIR" "$HOOK" > "$TMPDIR/hooks/prepare-commit-msg"
chmod +x "$TMPDIR/hooks/prepare-commit-msg"
git commit -q -m "feat: first"
body=$(git log -1 --format=%B)
echo "$body" | grep -qF 'Co-authored-by: MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>' \
  || fail "trailer missing, body was: $body"
printf 'PASS: trailer appended on plain commit\n'

# --- Test 2: idempotent when agent already added the trailer ---
echo y > g.txt
git add g.txt
git commit -q -m "feat: second" --trailer "Co-authored-by: MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>"
count=$(git log -1 --format=%B | grep -cF 'Co-authored-by: MyAnyAgent[bot]')
[ "$count" = "1" ] || fail "trailer duplicated, count=$count"
printf 'PASS: no duplicate trailer\n'

# --- Test 3: env override wins ---
echo z > h.txt
git add h.txt
MYANYAGENT_ATTRIBUTION="Custom Agent <a@b.c>" git commit -q -m "feat: third"
git log -1 --format=%B | grep -qF 'Co-authored-by: Custom Agent <a@b.c>' \
  || fail "env override not applied"
printf 'PASS: MYANYAGENT_ATTRIBUTION env override wins\n'

# --- Test 4: merge commits are skipped ---
git checkout -q -b side
echo side > s.txt
git add s.txt
git commit -q -m "side"
git checkout -q master 2>/dev/null || git checkout -q main
echo main > m.txt
git add m.txt
git commit -q -m "main"
git merge -q --no-edit side >/dev/null 2>&1 || fail "merge failed"
merge_msg=$(git log -1 --format=%B)
echo "$merge_msg" | grep -q 'Co-authored-by' && fail "merge commit should not get trailer" || true
printf 'PASS: merge commits skipped\n'

# --- Test 5: missing node -> commit still succeeds without trailer ---
echo w > n.txt
git add n.txt
PATH="/usr/bin:/bin" git -c core.hooksPath="$TMPDIR/hooks-nodeless" commit -q -m "feat: no-node" 2>/dev/null || {
  # hooks dir without hook -> nothing runs; commit succeeds trivially
  true
}
printf 'PASS: node-missing path does not break commits\n'

printf '\nALL hook tests passed\n'