# Forced AI Commit Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every commit created in a MyAnyAgent-managed repo carry an AI-disclosure trailer (`Co-authored-by:`), enforced by layered defenses: agent skill rules, an auto-appending `prepare-commit-msg` git hook, status reporting, and a pre-PR delivery check in `myanyagent-upstream`.

**Architecture:** Four independent enforcement layers, each useful alone, stronger together. Layer 1 (skill) is convention — the agent is instructed to always add the trailer. Layer 2 (git hook) auto-appends the trailer at commit time, catching omissions regardless of what the agent wrote. Layer 3 (status) reports unpushed commits missing the trailer. Layer 4 (upstream `pr create`) is the delivery gate: before opening a PR to a third-party repo, every commit in the branch must carry the trailer — this is the layer the agent cannot bypass through myanyagent tooling.

**Tech Stack:** POSIX shell (hooks, bootstrap, status), Node.js 18+ CJS (`myanyagent-upstream.cjs`, tests via `node --test`), `git interpret-trailers` for trailer parsing, `core.hooksPath` for hook installation.

## Global Constraints

- Shell scripts: POSIX `sh`, `set -eu`, no bashisms. (Exception: `hooks/prepare-commit-msg` deliberately has NO `set -eu` — the hook must never fail a commit; every fallible command exits 0 explicitly.)
- Node: zero new dependencies; use built-in `node:test`, `node:child_process`, `node:fs`.
- Trailer parsing MUST use `git interpret-trailers --parse`, not regex/grep on raw messages (trailers can be re-wrapped by `git commit --cleanup`, rebase, etc.).
- All tests run offline; no network access in any test.
- Tests MUST NOT pollute host git config: always `export GIT_CONFIG_GLOBAL="$TMPDIR/git-config-global"`.
- The trailer key is `Co-authored-by` (git-normalized capitalization), matching the existing `identity.co_author` config key in `.myanyagent.toml`.
- Follow existing project style: `-> run:` remediation hints on stderr, `PASS:`/`FAIL:` test output, `fail()` helpers.
- Every commit made during implementation of this plan MUST itself carry the trailer `Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>` (the plan eats its own dog food).

---

### Task 1: Shared trailer-resolution library + unit tests

**Files:**
- Create: `lib/attribution.cjs`
- Test: `test/attribution.test.cjs`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces:
  - `resolveAttribution({ tomlPath, gitConfigGet, env }) -> { trailer: string|null, source: "identity.co_author"|"bot"|"env"|"none", identity: { name: string|null, email: string|null } }`
    - `gitConfigGet(key) -> string` (injected; returns "" when unset)
    - Precedence: `env.MYANYAGENT_ATTRIBUTION` > `[identity].co_author` from toml > `[bot]` block from toml (`name` + `email` formatted as `Name <email>`) > `null`
  - `hasAttributionTrailer(message, trailer) -> boolean` — case-insensitive `Co-authored-by` key match, value compared exactly
  - `appendTrailer(message, trailer) -> string` — appends via trailer semantics (blank line + trailer) idempotently; returns message unchanged if already present
  - `TRAILER_KEY` — the constant string `"Co-authored-by"`

The toml parsing here is the same minimal section-aware parsing already used in `bin/myanyagent-bootstrap.sh` (`toml_get_in`), re-implemented in Node. Keep it deliberately small: only `[bot]` name/email and `[identity]` co_author are read.

- [ ] **Step 1: Write the failing test**

Create `test/attribution.test.cjs`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveAttribution,
  hasAttributionTrailer,
  appendTrailer,
  TRAILER_KEY,
} = require("../lib/attribution.cjs");

function withToml(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attr-"));
  const tomlPath = path.join(dir, ".myanyagent.toml");
  if (content !== null) fs.writeFileSync(tomlPath, content);
  try {
    return fn(tomlPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BOT_TOML = `repository = "o/r"
installation_id = "1"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
`;

test("TRAILER_KEY is Co-authored-by", () => {
  assert.equal(TRAILER_KEY, "Co-authored-by");
});

test("resolves bot identity from toml", () => {
  withToml(BOT_TOML, (tomlPath) => {
    const r = resolveAttribution({ tomlPath, gitConfigGet: () => "", env: {} });
    assert.equal(r.trailer, "MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>");
    assert.equal(r.source, "bot");
  });
});

test("identity.co_author wins over bot", () => {
  withToml(BOT_TOML + `[identity]\nname = "human"\nemail = "h@e.co"\nco_author = "OpenCode (Kimi) <noreply@myanyagent.local>"\n`, (tomlPath) => {
    const r = resolveAttribution({ tomlPath, gitConfigGet: () => "", env: {} });
    assert.equal(r.trailer, "OpenCode (Kimi) <noreply@myanyagent.local>");
    assert.equal(r.source, "identity.co_author");
  });
});

test("env var wins over everything", () => {
  withToml(BOT_TOML, (tomlPath) => {
    const r = resolveAttribution({
      tomlPath,
      gitConfigGet: () => "",
      env: { MYANYAGENT_ATTRIBUTION: "Custom Agent <a@b.c>" },
    });
    assert.equal(r.trailer, "Custom Agent <a@b.c>");
    assert.equal(r.source, "env");
  });
});

test("returns null trailer when nothing configured", () => {
  const r = resolveAttribution({ tomlPath: "/nonexistent/.myanyagent.toml", gitConfigGet: () => "", env: {} });
  assert.equal(r.trailer, null);
  assert.equal(r.source, "none");
});

test("hasAttributionTrailer matches case-insensitive key, exact value", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-authored-by: ${trailer}\n`, trailer), true);
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-Authored-By: ${trailer}\n`, trailer), true);
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-authored-by: Someone Else <x@y.z>\n`, trailer), false);
  assert.equal(hasAttributionTrailer(`feat: x\n\nno trailer here\n`, trailer), false);
});

test("appendTrailer appends with blank-line separation", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const out = appendTrailer("feat: x\n", trailer);
  assert.equal(out, `feat: x\n\nCo-authored-by: ${trailer}\n`);
});

test("appendTrailer is idempotent", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const once = appendTrailer("feat: x\n", trailer);
  assert.equal(appendTrailer(once, trailer), once);
});

test("appendTrailer appends after existing trailers without blank-line duplication", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const msg = "feat: x\n\nSigned-off-by: Human <h@e.co>\n";
  const out = appendTrailer(msg, trailer);
  assert.equal(out, `feat: x\n\nSigned-off-by: Human <h@e.co>\nCo-authored-by: ${trailer}\n`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test /home/ubuntu/Workspace/myanyagent/test/attribution.test.cjs`
Expected: FAIL with "Cannot find module '../lib/attribution.cjs'"

- [ ] **Step 3: Write minimal implementation**

Create `lib/attribution.cjs`:

```js
"use strict";

// Shared AI-attribution resolution for MyAnyAgent. Single source of truth for
// "which Co-authored-by trailer should commits in this repo carry".
//
// Precedence: MYANYAGENT_ATTRIBUTION env > [identity].co_author > [bot] block.
// The trailer value format is the git-standard "Name <email>".

const fs = require("node:fs");

const TRAILER_KEY = "Co-authored-by";

// Minimal section-aware toml reader (same scope as bootstrap.sh's toml_get_in).
// Only reads top-level keys and [bot]/[identity] string values.
function readToml(tomlPath) {
  let text;
  try {
    text = fs.readFileSync(tomlPath, "utf8");
  } catch {
    return {};
  }
  const result = { top: {}, sections: {} };
  let section = "top";
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\s*\[([^\]]+)\]/);
    if (s) {
      section = s[1].trim();
      if (!result.sections[section]) result.sections[section] = {};
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
    if (kv) {
      const target = section === "top" ? result.top : result.sections[section];
      target[kv[1]] = kv[2];
    }
  }
  return result;
}

function resolveAttribution({ tomlPath, gitConfigGet, env }) {
  const e = env || {};
  if (e.MYANYAGENT_ATTRIBUTION && e.MYANYAGENT_ATTRIBUTION.trim()) {
    return {
      trailer: e.MYANYAGENT_ATTRIBUTION.trim(),
      source: "env",
      identity: { name: null, email: null },
    };
  }
  const toml = readToml(tomlPath);
  const identity = toml.sections.identity || {};
  const bot = toml.sections.bot || {};
  if (identity.co_author) {
    return {
      trailer: identity.co_author,
      source: "identity.co_author",
      identity: { name: identity.name || null, email: identity.email || null },
    };
  }
  if (bot.name && bot.email) {
    return {
      trailer: `${bot.name} <${bot.email}>`,
      source: "bot",
      identity: { name: null, email: null },
    };
  }
  return { trailer: null, source: "none", identity: { name: null, email: null } };
}

// Trailer detection: match the trailer block per git-trailer rules — the last
// paragraph of the message consisting of "Key: value" lines. Key comparison is
// case-insensitive; value comparison is exact.
function hasAttributionTrailer(message, trailer) {
  const lines = String(message).replace(/\r\n/g, "\n").split("\n");
  const keyRe = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/;
  for (const line of lines) {
    const m = line.match(keyRe);
    if (m && m[1].toLowerCase() === TRAILER_KEY.toLowerCase() && m[2] === trailer) {
      return true;
    }
  }
  return false;
}

function appendTrailer(message, trailer) {
  const msg = String(message);
  if (hasAttributionTrailer(msg, trailer)) return msg.endsWith("\n") ? msg : msg + "\n";
  const trimmed = msg.replace(/\n*$/, "");
  const lines = trimmed.split("\n");
  // If the last paragraph already looks like a trailer block, append directly.
  const lastLine = lines[lines.length - 1] || "";
  const looksLikeTrailer = /^[A-Za-z-]+:\s*\S/.test(lastLine);
  const separator = looksLikeTrailer ? "" : "\n";
  return `${trimmed}\n${separator}${TRAILER_KEY}: ${trailer}\n`;
}

module.exports = { resolveAttribution, hasAttributionTrailer, appendTrailer, TRAILER_KEY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test /home/ubuntu/Workspace/myanyagent/test/attribution.test.cjs`
Expected: PASS (9 tests, 0 failures)

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
git add lib/attribution.cjs test/attribution.test.cjs
git commit -m "feat(myanyagent): shared attribution resolution library" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

### Task 2: `prepare-commit-msg` hook + hook tests

**Files:**
- Create: `hooks/prepare-commit-msg`
- Test: `test/hooks.test.sh`

**Interfaces:**
- Consumes: `lib/attribution.cjs` (`resolveAttribution`) via `node -e` inline call
- Produces: executable hook script at `hooks/prepare-commit-msg`; contract: given `$1` = commit message file path, appends `Co-authored-by: <resolved>` unless already present. Skips when `COMMIT_SOURCE` is `merge`/`squash`/`commit` (amend reuses message; `--amend` without `-m` passes source `commit`). Never fails the commit (exit 0 always — a hook that blocks commits would be hostile to `git commit --amend` flows; the *enforcement* belongs to the delivery gate in Task 5).

Design note: the hook resolves the trailer by locating `.myanyagent.toml` from the repo root (`git rev-parse --show-toplevel`). It needs `node` on PATH; if node is missing, it exits 0 silently (no trailer) rather than breaking commits.

- [ ] **Step 1: Write the failing test**

Create `test/hooks.test.sh`:

```sh
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/hooks.test.sh`
Expected: FAIL — `hooks/prepare-commit-msg` does not exist (cp fails or trailer missing)

- [ ] **Step 3: Write minimal implementation**

Create `hooks/prepare-commit-msg`:

```sh
#!/bin/sh
# MyAnyAgent prepare-commit-msg hook: auto-append the resolved Co-authored-by
# trailer so every commit in a MyAnyAgent repo discloses AI involvement.
#
# Resolution: MYANYAGENT_ATTRIBUTION env > [identity].co_author > [bot] block
# (via lib/attribution.cjs). Never fails the commit; missing node or missing
# toml simply means no trailer is added (the delivery gate in
# myanyagent-upstream pr create is the enforcement layer).

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

case "$COMMIT_SOURCE" in
  merge|squash|commit) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
toml="$repo_root/.myanyagent.toml"
[ -f "$toml" ] || exit 0

# lib/ sits next to hooks/ in the source repo, and next to bin/ after install.
# MYANYAGENT_LIB is a test/escape hatch.
if [ -n "${MYANYAGENT_LIB:-}" ]; then
  lib="$MYANYAGENT_LIB/attribution.cjs"
else
  hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  for cand in "$hook_dir/../lib/attribution.cjs" "$hook_dir/../../lib/attribution.cjs"; do
    if [ -f "$cand" ]; then lib="$cand"; break; fi
  done
fi
[ -n "${lib:-}" ] && [ -f "$lib" ] || exit 0

trailer=$(node -e '
  const { resolveAttribution } = require(process.argv[1]);
  const r = resolveAttribution({ tomlPath: process.argv[2], gitConfigGet: () => "", env: process.env });
  if (r.trailer) process.stdout.write(r.trailer);
' "$lib" "$toml" 2>/dev/null) || exit 0
[ -n "$trailer" ] || exit 0

# Idempotency + formatting handled by git interpret-trailers itself.
if git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep -qiF "co-authored-by: $trailer"; then
  exit 0
fi
git interpret-trailers --in-place --trailer "Co-authored-by: $trailer" "$COMMIT_MSG_FILE" 2>/dev/null || exit 0
exit 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/hooks.test.sh`
Expected: PASS (all 5 tests, `ALL hook tests passed`)

If Test 2 fails due to trailer ordering (`git interpret-trailers --trailer` vs `--trailer` CLI flag placement), adjust the idempotency check in the hook to use `git interpret-trailers --parse` comparison of the full `Key: value` line (already implemented) and re-run.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
chmod +x hooks/prepare-commit-msg
git add hooks/prepare-commit-msg test/hooks.test.sh
git commit -m "feat(myanyagent): prepare-commit-msg hook auto-appends attribution trailer" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

### Task 3: Bootstrap installs the hook; tests extended

**Files:**
- Modify: `bin/myanyagent-bootstrap.sh` (append hook-installation block after the contribution-mode exclude block, before the smoke test)
- Modify: `test/bootstrap.test.sh` (append Test 9)

**Interfaces:**
- Consumes: `hooks/prepare-commit-msg` (Task 2), resolved via installed tool dir `$HOME/.local/share/myanyagent/hooks/prepare-commit-msg`
- Produces: after bootstrap, `git config --local core.hooksPath` points to a directory containing an executable `prepare-commit-msg`; idempotent (re-running bootstrap keeps the hook); repos already having a `core.hooksPath` get the hook copied into their existing hooks dir instead of overriding the config.

Behavior spec for the bootstrap addition:
1. Determine source hook: `$tool_dir/hooks/prepare-commit-msg` (installed) — if absent, skip silently (older installs).
2. If repo has `core.hooksPath` set (local or global), copy the hook into that directory (create dir if needed), `chmod +x`.
3. Else create `.git/myanyagent-hooks/` (via `git rev-parse --git-path myanyagent-hooks` for worktree safety), copy the hook there, set `git config --local core.hooksPath <resolved dir>`.
4. Print one line: `Attribution hook: installed (prepare-commit-msg auto-appends Co-authored-by).`
5. Never overwrite an existing `prepare-commit-msg` that differs in content unless it contains the marker line `# MyAnyAgent prepare-commit-msg hook` (safe idempotency: only manage our own hook).

- [ ] **Step 1: Write the failing test**

Append to `test/bootstrap.test.sh` (before the final `printf '\nALL bootstrap tests passed\n'`):

```sh
# --- Test 9: bootstrap installs the attribution hook ---
cd "$TMPDIR/repo"
# Simulate an installed tool dir with the hook present
TOOLHOME=$(mktemp -d)
mkdir -p "$TOOLHOME/.local/share/myanyagent/bin" "$TOOLHOME/.local/share/myanyagent/hooks"
cp "$(cd "$(dirname "$BOOTS")" && pwd)/myanyagent-credential-helper.cjs" "$TOOLHOME/.local/share/myanyagent/bin/"
printf '1' > "$TOOLHOME/.local/share/myanyagent/VERSION"
cat > "$TOOLHOME/.local/share/myanyagent/hooks/prepare-commit-msg" <<'H'
#!/bin/sh
# MyAnyAgent prepare-commit-msg hook
exit 0
H
chmod +x "$TOOLHOME/.local/share/myanyagent/hooks/prepare-commit-msg"

HOME="$TOOLHOME" MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>/dev/null || true

hooks_path=$(git config --local core.hooksPath 2>/dev/null) || fail "core.hooksPath not set by bootstrap"
[ -n "$hooks_path" ] || fail "core.hooksPath empty"
# Resolve relative hooksPath against repo root (git resolves it against worktree root)
case "$hooks_path" in /*) resolved="$hooks_path" ;; *) resolved="$TMPDIR/repo/$hooks_path" ;; esac
[ -x "$resolved/prepare-commit-msg" ] || fail "prepare-commit-msg not installed/executable at $resolved"
grep -qF '# MyAnyAgent prepare-commit-msg hook' "$resolved/prepare-commit-msg" || fail "installed hook missing marker"
printf 'PASS: bootstrap installs attribution hook\n'

# --- Test 9b: idempotent re-run does not duplicate or clobber ---
HOME="$TOOLHOME" MYANYAGENT_PRIVATE_KEY="$KEY" sh "$BOOTS" 2>/dev/null || true
[ "$(git config --local core.hooksPath)" = "$hooks_path" ] || fail "hooksPath changed on re-run"
printf 'PASS: hook install idempotent\n'
rm -rf "$TOOLHOME"
```

Note: bootstrap resolves `$HOME/.local/share/myanyagent` from the real `$HOME`; the test overrides `HOME` so the installed-tool check (`[ -f "$helper" ]`) and the new hook lookup both see the simulated tool dir.

- [ ] **Step 2: Run test to verify it fails**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/bootstrap.test.sh`
Expected: FAIL with "core.hooksPath not set by bootstrap"

- [ ] **Step 3: Write minimal implementation**

In `bin/myanyagent-bootstrap.sh`, insert after the contribution-mode exclude block (the `if $contribution_mode; then ... fi` block ending around line 101) and before the `# Smoke test` comment:

```sh
# Attribution hook: every commit in this repo auto-carries the Co-authored-by
# trailer (agent disclosure). We only ever manage our own hook (marker line),
# and we never clobber a repo's existing core.hooksPath — if one is set, the
# hook is copied into that directory instead.
hook_src="$tool_dir/hooks/prepare-commit-msg"
if [ -f "$hook_src" ]; then
  existing_hooks_path=$(git config --local --get core.hooksPath 2>/dev/null || true)
  if [ -z "$existing_hooks_path" ]; then
    existing_hooks_path=$(git config --global --get core.hooksPath 2>/dev/null || true)
  fi
  if [ -n "$existing_hooks_path" ]; then
    case "$existing_hooks_path" in
      /*) hooks_dir="$existing_hooks_path" ;;
      *) hooks_dir="$repo_root/$existing_hooks_path" ;;
    esac
  else
    hooks_dir=$(git rev-parse --git-path myanyagent-hooks) || fail "cannot resolve git hooks path"
    case "$hooks_dir" in
      /*) ;;
      *) hooks_dir="$repo_root/$hooks_dir" ;;
    esac
    git config --local core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)"
  fi
  mkdir -p "$hooks_dir"
  hook_dst="$hooks_dir/prepare-commit-msg"
  if [ -f "$hook_dst" ] && ! grep -qF '# MyAnyAgent prepare-commit-msg hook' "$hook_dst" 2>/dev/null; then
    printf 'Attribution hook: NOT installed (foreign prepare-commit-msg exists at %s)\n' "$hook_dst"
  else
    cp "$hook_src" "$hook_dst"
    chmod +x "$hook_dst"
    printf 'Attribution hook: installed (prepare-commit-msg auto-appends Co-authored-by).\n'
  fi
fi
```

Also update `install.sh` to ship the hook: after the line copying `myanyagent-status.sh` (line 38), insert:

```sh
mkdir -p "$target_dir/hooks"
if [ -f "$script_dir/hooks/prepare-commit-msg" ]; then
  cp "$script_dir/hooks/prepare-commit-msg" "$target_dir/hooks/"
  chmod +x "$target_dir/hooks/prepare-commit-msg"
fi
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/bootstrap.test.sh`
Expected: PASS including Tests 9 and 9b, final line `ALL bootstrap tests passed`

Run: `sh /home/ubuntu/Workspace/myanyagent/test/hooks.test.sh`
Expected: still PASS (no regression)

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
git add bin/myanyagent-bootstrap.sh install.sh test/bootstrap.test.sh
git commit -m "feat(myanyagent): bootstrap installs attribution hook (hooksPath-safe)" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

### Task 4: Status reports attribution state

**Files:**
- Modify: `bin/myanyagent-status.sh` (insert attribution block before the final `needs_action` summary)
- Modify: `test/status.test.sh` (append Tests 8 and 9)

**Interfaces:**
- Consumes: trailer resolution logic (same precedence as Task 1, re-implemented in shell — status.sh is POSIX sh and cannot require node; duplicate the tiny toml parse, it is 6 lines of sed)
- Produces: new status output lines:
  - `attribution hook: installed` or `attribution hook: NOT installed` (+ `-> run: myanyagent-bootstrap` via the shared `needs_action` mechanism)
  - `attribution trailer: <resolved trailer>` or `attribution trailer: (none configured)`
  - When in a repo with commits ahead of upstream: `unpushed commits without trailer: N` (+ hint) or nothing when clean. Detection: `git log @{upstream}..HEAD --format=%B` when an upstream exists; skip silently otherwise.

Status remains read-only and MUST NOT fail when git operations error (defensive `2>/dev/null || true` everywhere, matching existing style).

- [ ] **Step 1: Write the failing test**

Append to `test/status.test.sh` (before the final `printf '\nALL status tests passed\n'`):

```sh
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/status.test.sh`
Expected: FAIL with "should report hook installed"

- [ ] **Step 3: Write minimal implementation**

In `bin/myanyagent-status.sh`, insert immediately before the line `if $configured; then` (around line 98):

```sh
# Attribution state (read-only): hook presence, resolved trailer, unpushed gaps.
attr_coauthor=$(sed -n '/^\[identity\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*co_author[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
bot_name=$(sed -n '/^\[bot\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
bot_email=$(sed -n '/^\[bot\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*email[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
attr_trailer=""
if [ -n "${MYANYAGENT_ATTRIBUTION:-}" ]; then
  attr_trailer="$MYANYAGENT_ATTRIBUTION"
elif [ -n "$attr_coauthor" ]; then
  attr_trailer="$attr_coauthor"
elif [ -n "$bot_name" ] && [ -n "$bot_email" ]; then
  attr_trailer="$bot_name <$bot_email>"
fi
if [ -n "$attr_trailer" ]; then
  printf 'attribution trailer: %s\n' "$attr_trailer"
else
  printf 'attribution trailer: (none configured)\n'
fi

hook_found=false
hooks_path=$(git config --local --get core.hooksPath 2>/dev/null || true)
[ -n "$hooks_path" ] || hooks_path=$(git config --global --get core.hooksPath 2>/dev/null || true)
if [ -n "$hooks_path" ] && [ -n "$repo_root" ]; then
  case "$hooks_path" in /*) hooks_dir="$hooks_path" ;; *) hooks_dir="$repo_root/$hooks_path" ;; esac
else
  hooks_dir=""
fi
if [ -n "$hooks_dir" ] && [ -x "$hooks_dir/prepare-commit-msg" ] \
   && grep -qF '# MyAnyAgent prepare-commit-msg hook' "$hooks_dir/prepare-commit-msg" 2>/dev/null; then
  hook_found=true
fi
if $hook_found; then
  printf 'attribution hook: installed\n'
else
  printf 'attribution hook: NOT installed\n'
  needs_action=true
fi

# Unpushed commits missing the trailer (only meaningful when trailer + upstream exist)
if [ -n "$attr_trailer" ] && [ -n "$repo_root" ]; then
  upstream=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    missing=$(git log --format=%B "@{upstream}..HEAD" 2>/dev/null |
      grep -ciF "co-authored-by:" || true)
    total=$(git rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo 0)
    if [ "${total:-0}" -gt 0 ] && [ "$missing" -lt "$total" ]; then
      printf 'unpushed commits without trailer: %s of %s\n' "$((total - missing))" "$total"
      needs_action=true
    fi
  fi
fi
```

The `-> run: myanyagent-bootstrap` hint is already emitted by the existing `needs_action` tail, so a missing hook automatically points at the fix.

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh /home/ubuntu/Workspace/myanyagent/test/status.test.sh`
Expected: PASS including Tests 8-9, final line `ALL status tests passed`

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
git add bin/myanyagent-status.sh test/status.test.sh
git commit -m "feat(myanyagent): status reports attribution hook, trailer, unpushed gaps" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

### Task 5: Upstream `pr create` delivery gate

**Files:**
- Modify: `bin/myanyagent-upstream.cjs` (add `checkAttribution` + wire into `pr create`, plus `--skip-attribution-check` escape hatch and help text)
- Modify: `test/upstream.test.cjs` (append new test block)

**Interfaces:**
- Consumes: `lib/attribution.cjs` (`resolveAttribution`, `hasAttributionTrailer`, `appendTrailer`) — upstream.cjs already lives in `bin/`; it locates the lib via `require("../lib/attribution.cjs")` with fallback to `~/.local/share/myanyagent/lib/attribution.cjs` (installed layout)
- Produces:
  - `checkAttribution({ cwd, base, head, trailer }) -> { ok: boolean, missing: Array<{ sha: string, subject: string }>, total: number }` (exported for tests)
  - CLI behavior change in `pr create`: before dry-run or API call, run the gate; on failure print the missing commits to stderr + remediation hint and exit 1. `--skip-attribution-check` bypasses (documented in help). When the repo has no trailer configured at all (`resolveAttribution` returns null), the gate is skipped (bot-less repos unchanged).

Gate mechanics: `git log --format=%H%x00%B%x00END ${base}...${head}` — but `base`/`head` here are GitHub branch names for the upstream repo, not necessarily local refs. The check instead uses the **local** HEAD branch against the **local** default branch ref: resolve merge-base via `git merge-base HEAD origin/<default>` falling back to `git rev-parse HEAD~10` is wrong; simplest correct local check: `git log @{upstream}..HEAD` when the current branch has an upstream, else `git log --format` of commits not on any remote branch (`git log --branches --not --remotes`). Use the `--not --remotes` form — it works without upstream config and covers exactly "commits that would leave this machine".

- [ ] **Step 1: Write the failing test**

Append to `test/upstream.test.cjs` (before the final closing of the test file — locate the last `test(...)` block and append after it):

```js
test("checkAttribution flags local-only commits missing the trailer", async (t) => {
  const { execFileSync } = require("node:child_process");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const git = (args, opts = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", ...opts });

  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.test"]);
  fs.writeFileSync(path.join(dir, ".myanyagent.toml"),
    'repository = "o/r"\ninstallation_id = "1"\n[bot]\nname = "MyAnyAgent[bot]"\nemail = "b@b.c"\n');

  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";

  // Commit 1: has trailer. Commit 2: missing.
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  git(["add", "."]);
  git(["commit", "-q", "-m", "one", "--trailer", `Co-authored-by: ${trailer}`]);
  fs.writeFileSync(path.join(dir, "b.txt"), "b");
  git(["add", "."]);
  git(["commit", "-q", "-m", "two"]);

  const r = checkAttribution({ cwd: dir, trailer });
  assert.equal(r.total, 2);
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].subject, "two");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("checkAttribution passes when all local-only commits carry the trailer", async () => {
  const { execFileSync } = require("node:child_process");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.test"]);
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  git(["add", "."]);
  git(["commit", "-q", "-m", "one", "--trailer", `Co-authored-by: ${trailer}`]);
  const r = checkAttribution({ cwd: dir, trailer });
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Note: `test/upstream.test.cjs` already imports `fs` and `path` at the top (verify before writing; if not, add the requires at the top of the file). These tests are fully offline — `checkAttribution` never touches the network.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test /home/ubuntu/Workspace/myanyagent/test/upstream.test.cjs`
Expected: FAIL with "checkAttribution is not a function"

- [ ] **Step 3: Write minimal implementation**

In `bin/myanyagent-upstream.cjs`:

a) Add near the top (after the `ALLOWLIST` block, around line 37):

```js
const { execFileSync } = require("node:child_process");

// Attribution delivery gate (lib lives next to bin/ in the source repo and in
// the installed layout). Soft-fail to null when unavailable so upstream API
// reads never break on a missing lib.
let attribution = null;
for (const cand of [
  path.join(__dirname, "..", "lib", "attribution.cjs"),
  path.join(os.homedir(), ".local", "share", "myanyagent", "lib", "attribution.cjs"),
]) {
  try {
    attribution = require(cand);
    break;
  } catch { /* try next */ }
}

// Local gate: every commit that would leave this machine (not on any remote)
// must carry the resolved Co-authored-by trailer. Returns structured results;
// callers decide policy. Never throws on git errors — returns ok:true with
// total:0 when no local-only commits exist or git fails.
function checkAttribution({ cwd, trailer }) {
  const empty = { ok: true, missing: [], total: 0 };
  if (!trailer) return empty;
  let raw;
  try {
    raw = execFileSync(
      "git",
      ["log", "--format=%H%x00%s%x00%B%x00END", "--branches", "--not", "--remotes"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }
    );
  } catch {
    return empty;
  }
  const commits = raw
    .split("\u0000END\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, subject, ...rest] = chunk.split("\u0000");
      return { sha, subject, body: rest.join("\u0000") };
    });
  const missing = commits
    .filter((c) => !attribution.hasAttributionTrailer(c.body, trailer))
    .map((c) => ({ sha: c.sha.slice(0, 12), subject: c.subject }));
  return { ok: missing.length === 0, missing, total: commits.length };
}
```

b) In the `case "pr":` block (around line 321), immediately after `if (!need(flags, ...)) return 1;` and before `const u = await getUser();`:

```js
      // Attribution gate: the PR publishes this branch's commits; every one
      // must disclose AI involvement. Runs before dry-run so violations are
      // caught even without --yes.
      if (!flags["skip-attribution-check"] && attribution) {
        const resolved = attribution.resolveAttribution({
          tomlPath: path.join(process.cwd(), ".myanyagent.toml"),
          gitConfigGet: () => "",
          env: process.env,
        });
        if (resolved.trailer) {
          const gate = checkAttribution({ cwd: process.cwd(), trailer: resolved.trailer });
          if (!gate.ok) {
            fail(`attribution gate: ${gate.missing.length} of ${gate.total} local commit(s) lack Co-authored-by: ${resolved.trailer}`);
            for (const c of gate.missing) fail(`  ${c.sha} ${c.subject}`);
            hint("git rebase / amend to add the trailer, or re-run with --skip-attribution-check");
            hint("the prepare-commit-msg hook auto-adds it: myanyagent-bootstrap installs the hook");
            return 1;
          }
        }
      }
```

c) Update the help text in `main()` — change the `pr create` line to:

```
  pr create     --repo o/r --base B --head-branch B --title T --body-file F
                (runs the attribution gate; --skip-attribution-check bypasses)
```

d) Update the exports line (line 416) to:

```js
module.exports = { request, ALLOWLIST, checkAttribution };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test /home/ubuntu/Workspace/myanyagent/test/upstream.test.cjs`
Expected: PASS (all existing + 2 new tests)

Run full suite:
```bash
cd /home/ubuntu/Workspace/myanyagent
node --test test/helper.test.cjs && node --test test/upstream.test.cjs && node --test test/attribution.test.cjs
sh test/bootstrap.test.sh && sh test/status.test.sh && sh test/hooks.test.sh
```
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
git add bin/myanyagent-upstream.cjs test/upstream.test.cjs
git commit -m "feat(myanyagent): pr create attribution delivery gate" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

### Task 6: Skill rules + docs + version bump

**Files:**
- Modify: `skills/myanyagent/SKILL.md` (add "Commit Attribution Policy" section)
- Modify: `README.md` (extend the "Contributing to third-party public repos" section + Commands table)
- Modify: `docs/contributing-to-third-party-repos.md` (append "Adopted model addendum: enforced attribution")
- Modify: `VERSION` (bump patch)

**Interfaces:**
- Consumes: all previous tasks (this task only documents what now exists)
- Produces: agent-facing rules in the skill; user-facing docs in README; version bump per project convention (check current VERSION content — increment the last component)

- [ ] **Step 1: Write the skill policy section**

In `skills/myanyagent/SKILL.md`, insert after the "## How It Works" section (after line 45):

```markdown
## Commit Attribution Policy (mandatory)

Every commit you create in a MyAnyAgent repo MUST disclose AI involvement with
a trailer:

```
Co-authored-by: <resolved trailer>
```

Resolution order (same as the tooling): `MYANYAGENT_ATTRIBUTION` env >
`[identity].co_author` in `.myanyagent.toml` > `[bot]` name/email.

Rules:

- Never omit the trailer. Never remove it from an existing commit message.
- The `prepare-commit-msg` hook (installed by `myanyagent-bootstrap`) appends
  it automatically — do not bypass hooks with `--no-verify`.
- `myanyagent-upstream pr create` refuses to open a PR when local commits lack
  the trailer. Fix history (rebase/amend) rather than bypassing.
- The trailer discloses tool involvement; the human remains the sole author.
  Do NOT add `Signed-off-by` on the human's behalf.
```

- [ ] **Step 2: Update README**

In `README.md`, in the "## Commands" table (around line 55-60), no change needed to rows. In the "## Contributing to third-party public repos" section, append after the `myanyagent-upstream identity` paragraph (around line 87):

```markdown
- **AI disclosure is enforced, not advisory.** Every commit carries a
  `Co-authored-by:` trailer naming the agent. Bootstrap installs a
  `prepare-commit-msg` hook that appends the resolved trailer automatically
  (env `MYANYAGENT_ATTRIBUTION` > `[identity].co_author` > `[bot]` block), and
  `myanyagent-upstream pr create` refuses to open a PR when local commits lack
  it (`--skip-attribution-check` bypasses). `myanyagent-status` reports hook
  state, the resolved trailer, and unpushed commits missing it.
```

- [ ] **Step 3: Update the research doc**

Append to `docs/contributing-to-third-party-repos.md` (at the end):

```markdown
## Addendum (enforced attribution)

The layered model above kept attribution advisory (a bootstrap "Tip"). That
was identified as the weak point: prompts can be ignored, and no local
mechanism can fully prevent a same-user agent from bypassing them. The adopted
defense is layered enforcement:

1. Skill rules (convention) — the agent is instructed the trailer is mandatory.
2. `prepare-commit-msg` hook (automation) — the trailer is appended at commit
   time regardless of what the agent wrote; `--no-verify` bypasses it, which
   is why this layer is not the boundary.
3. `myanyagent-status` (visibility) — drift between expected and actual state
   is reported with `-> run:` remediation.
4. `myanyagent-upstream pr create` (delivery gate) — the only layer the agent
   cannot route around through this toolchain: commits that would leave the
   machine without the trailer block PR creation.

Residual risk, accepted by design: an agent with shell access can still commit
and push without ever invoking `pr create` (e.g. direct push to an own-repo
main branch is not gated). The hook + skill make that a deliberate multi-step
violation rather than an omission.
```

- [ ] **Step 4: Bump VERSION and run full test suite**

```bash
cd /home/ubuntu/Workspace/myanyagent
printf '3\n' > VERSION   # current content is "2"; project uses integer versioning
```

Then run the full suite as the verification gate:

```bash
cd /home/ubuntu/Workspace/myanyagent
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/hooks.test.sh
```

Expected: every suite passes. This is the pre-commit verification; do not commit if any suite fails.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/Workspace/myanyagent
git add skills/myanyagent/SKILL.md README.md docs/contributing-to-third-party-repos.md VERSION
git commit -m "feat(myanyagent): mandatory attribution policy (skill rules + docs)" \
  --trailer "Co-authored-by: OpenCode (Kimi) <noreply@myanyagent.local>"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** four enforcement layers requested in the design discussion (skill, hook, status, delivery gate) map to Tasks 6, 2-3, 4, 5 respectively. Shared resolution logic (single source of truth) is Task 1. All covered.
- **Placeholder scan:** no TBD/TODO; every code step contains complete code.
- **Type consistency:** `resolveAttribution`/`hasAttributionTrailer`/`appendTrailer`/`TRAILER_KEY` (Task 1) are the exact names consumed in Tasks 2 and 5. `checkAttribution({ cwd, trailer })` signature is identical in Task 5 test and implementation. The `[identity].co_author` toml key matches the existing `id_coauthor` parsing in `bootstrap.sh`.
- **Known limitation (documented in Task 6 addendum):** direct `git push` to an own-repo branch is not gated; gating push would require server-side or credential-helper involvement that cannot inspect refs. Accepted residual risk.
- **Shell/Node duplication:** the trailer-resolution precedence exists in both `lib/attribution.cjs` (node consumers: hook, upstream) and inline sed in `status.sh` (POSIX-only consumer). This is intentional duplication for dependency discipline; both implementations are covered by tests asserting identical precedence.
