const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BIN = path.join(__dirname, "..", "bin", "myanyagent-upstream.cjs");

// --- Local mock GitHub API server (no real network) ---
let server;
let baseURL;
const hits = [];
let route = () => ({ status: 200, json: {} });

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body,
      });
      const r = route(
        { method: req.method, url: req.url },
        body ? JSON.parse(body) : null
      );
      res.writeHead(r.status, {
        "content-type": "application/json",
        ...(r.headers || {}),
      });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function run(args, { env = {}, input, cwd } = {}) {
  const e = {
    ...process.env,
    MYANYAGENT_UPSTREAM_BASE_URL: baseURL,
    MYANYAGENT_UPSTREAM_TOKEN: "test-token",
    ...env,
  };
  if (e.NO_TOKEN) {
    delete e.MYANYAGENT_UPSTREAM_TOKEN;
    delete e.NO_TOKEN;
  }
  // Async spawn: the mock server lives in THIS process, so a sync spawn would
  // deadlock (parent blocked waiting for child -> server never responds).
  return new Promise((resolve, reject) => {
    const c = spawn("node", [BIN, ...args], { env: e, timeout: 20000, ...(cwd ? { cwd } : {}) });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    if (input) c.stdin.write(input);
    c.stdin.end();
    c.on("error", reject);
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "myanyagent-test-"));
}

function writeTokenFile(home, mode, token = "file-token") {
  const dir = path.join(home, ".secrets");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "myanyagent-upstream.pat");
  fs.writeFileSync(f, token + "\n");
  fs.chmodSync(f, mode);
  return f;
}

// --- Token resolution ---

test("fails clearly when no token is available", async () => {
  const home = tmpHome();
  const before = hits.length;
  const r = await run(["status"], { env: { NO_TOKEN: "1", HOME: home } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /token/i);
  assert.match(r.stderr, /-> run:/);
  assert.equal(hits.length, before, "must not hit network without a token");
});

test("refuses a token file with group/other-readable permissions", async () => {
  const home = tmpHome();
  writeTokenFile(home, 0o644);
  const before = hits.length;
  const r = await run(["status"], { env: { NO_TOKEN: "1", HOME: home } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /600|permission/i);
  assert.equal(hits.length, before);
});

test("accepts a 0600 token file", async () => {
  const home = tmpHome();
  writeTokenFile(home, 0o600);
  route = () => ({ status: 200, json: { login: "me", id: 42 } });
  const r = await run(["status"], { env: { NO_TOKEN: "1", HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.auth, "Bearer file-token");
});

// --- Command surface ---

test("unknown command exits nonzero and prints usage", async () => {
  const r = await run(["bogus"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test("request() rejects an endpoint outside the allowlist before any HTTP", async () => {
  const mod = require(BIN);
  const before = hits.length;
  await assert.rejects(mod.request("notInAllowlist", {}), /allowlist/i);
  assert.equal(hits.length, before);
});

// --- Write gating (dry-run / --yes) ---

test("write command without --yes is a dry-run and sends nothing", async () => {
  const before = hits.length;
  const r = await run(["fork", "--repo", "o/r"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DRY-RUN/);
  assert.match(r.stdout, /POST \/repos\/o\/r\/forks/);
  assert.equal(hits.length, before);
});

test("fork --yes POSTs to the forks endpoint", async () => {
  route = () => ({
    status: 202,
    json: { full_name: "me/r", html_url: "https://example/fork" },
  });
  const r = await run(["fork", "--repo", "o/r", "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.method, "POST");
  assert.equal(hit.url, "/repos/o/r/forks");
  assert.equal(hit.auth, "Bearer test-token");
  assert.match(r.stdout, /me\/r/);
});

// --- Endpoint mapping ---

test("comment --yes posts the body file to the issue comments endpoint", async () => {
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "hello review\n");
  route = () => ({ status: 201, json: { id: 1, html_url: "u" } });
  const r = await run(["comment", "--repo", "o/r", "--number", "7", "--body-file", f, "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.url, "/repos/o/r/issues/7/comments");
  assert.deepEqual(JSON.parse(hit.body), { body: "hello review\n" });
});

test("reply --yes hits the review-comment replies endpoint", async () => {
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "fixed\n");
  route = () => ({ status: 201, json: { id: 2, html_url: "u" } });
  const r = await run([
    "reply", "--repo", "o/r", "--pr", "9", "--comment-id", "55",
    "--body-file", f, "--yes",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.url, "/repos/o/r/pulls/9/comments/55/replies");
});

test("pr create composes head as <login>:<branch> learned from GET /user", async () => {
  const { root, dir, git } = gateRepo();
  // The gate is fail-closed: --head-branch must resolve as a LOCAL ref, so the
  // named branch must exist locally (fix-x == main -> legitimately empty range).
  git(["checkout", "-q", "-b", "fix-x"]);
  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 201, json: { number: 5, html_url: "https://example/pr/5" } };
  const f = path.join(dir, "body.md");
  fs.writeFileSync(f, "pr body\n");
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "main",
    "--head-branch", "fix-x", "--title", "My fix", "--body-file", f, "--yes",
  ], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const prHit = hits.find((h) => h.url === "/repos/o/r/pulls");
  assert.ok(prHit, "pulls endpoint was called");
  const sent = JSON.parse(prHit.body);
  assert.equal(sent.head, "me:fix-x");
  assert.equal(sent.base, "main");
  assert.equal(sent.title, "My fix");
  assert.equal(sent.body, "pr body\n");
  assert.match(r.stdout, /number 5|#5/);
  fs.rmSync(root, { recursive: true, force: true });
});

// --- GraphQL review-thread workflow ---

test("threads maps comment databaseIds to thread node ids without --yes", async () => {
  route = () => ({
    status: 200,
    json: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: "PRRT_1",
                  isResolved: false,
                  comments: { nodes: [{ databaseId: 1001 }, { databaseId: 1002 }] },
                },
              ],
            },
          },
        },
      },
    },
  });
  const r = await run(["threads", "--repo", "o/r", "--pr", "9"]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.url, "/graphql");
  assert.match(hit.body, /reviewThreads/);
  assert.match(r.stdout, /PRRT_1/);
  assert.match(r.stdout, /1001/);
});

test("resolve requires --yes and then sends the resolveReviewThread mutation", async () => {
  const before = hits.length;
  const dry = await run(["resolve", "--thread-id", "PRRT_1"]);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /DRY-RUN/);
  assert.equal(hits.length, before);

  route = () => ({
    status: 200,
    json: { data: { resolveReviewThread: { thread: { isResolved: true } } } },
  });
  const r = await run(["resolve", "--thread-id", "PRRT_1", "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.url, "/graphql");
  assert.match(hit.body, /resolveReviewThread/);
  assert.match(hit.body, /PRRT_1/);
  assert.match(r.stdout, /resolved/i);
});

// --- Issue create / close (gap from the allowlist-bypass incident) ---

test("issue close without --yes is a dry-run and sends nothing", async () => {
  const before = hits.length;
  const r = await run(["issue", "close", "--repo", "o/r", "--number", "7"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DRY-RUN/);
  assert.match(r.stdout, /PATCH \/repos\/o\/r\/issues\/7/);
  assert.equal(hits.length, before);
});

test("issue close --yes PATCHes state closed to the issue endpoint", async () => {
  route = () => ({
    status: 200,
    json: { number: 7, state: "closed", html_url: "https://example/issue/7" },
  });
  const r = await run(["issue", "close", "--repo", "o/r", "--number", "7", "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.method, "PATCH");
  assert.equal(hit.url, "/repos/o/r/issues/7");
  assert.deepEqual(JSON.parse(hit.body), { state: "closed" });
  assert.match(r.stdout, /closed/);
  assert.match(r.stdout, /https:\/\/example\/issue\/7/);
});

test("issue close --state-reason not-planned is normalized to not_planned and sent", async () => {
  route = () => ({
    status: 200,
    json: { number: 7, state: "closed", state_reason: "not_planned", html_url: "u" },
  });
  const r = await run([
    "issue", "close", "--repo", "o/r", "--number", "7",
    "--state-reason", "not-planned", "--yes",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.deepEqual(JSON.parse(hit.body), { state: "closed", state_reason: "not_planned" });
});

test("issue close rejects an invalid --state-reason before any HTTP", async () => {
  const before = hits.length;
  const r = await run([
    "issue", "close", "--repo", "o/r", "--number", "7",
    "--state-reason", "bogus",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /state-reason/i);
  assert.match(r.stderr, /completed|not[-_]planned/i);
  assert.equal(hits.length, before);
});

test("issue close rejects unknown subcommands", async () => {
  const r = await run(["issue", "bogus"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown subcommand/i);
});

test("issue create without --yes is a dry-run and sends nothing", async () => {
  const before = hits.length;
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "issue body\n");
  const r = await run([
    "issue", "create", "--repo", "o/r", "--title", "T", "--body-file", f,
  ]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DRY-RUN/);
  assert.match(r.stdout, /POST \/repos\/o\/r\/issues/);
  assert.equal(hits.length, before);
});

test("issue create --yes POSTs title and body to the issues endpoint", async () => {
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "something is broken\n");
  route = () => ({
    status: 201,
    json: { number: 44, html_url: "https://example/issue/44" },
  });
  const r = await run([
    "issue", "create", "--repo", "o/r", "--title", "Bug report",
    "--body-file", f, "--yes",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const hit = hits[hits.length - 1];
  assert.equal(hit.method, "POST");
  assert.equal(hit.url, "/repos/o/r/issues");
  assert.deepEqual(JSON.parse(hit.body), { title: "Bug report", body: "something is broken\n" });
  assert.match(r.stdout, /#44/);
});

// --- Error handling ---

test("rate-limited 403 produces guidance and a nonzero exit", async () => {
  route = () => ({
    status: 403,
    headers: { "x-ratelimit-remaining": "0", "retry-after": "60" },
    json: { message: "API rate limit exceeded" },
  });
  const r = await run(["fork", "--repo", "o/r", "--yes"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rate limit|retry/i);
});

// --- Identity & status ---

test("identity prints git config lines with the id-based noreply address", async () => {
  route = () => ({ status: 200, json: { login: "me", id: 42 } });
  const r = await run(["identity"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /git config user\.name "me"/);
  assert.match(r.stdout, /git config user\.email "42\+me@users\.noreply\.github\.com"/);
});

test("status prints login, scopes and remaining rate limit", async () => {
  route = () => ({
    status: 200,
    headers: { "x-oauth-scopes": "public_repo", "x-ratelimit-remaining": "4999" },
    json: { login: "me", id: 42 },
  });
  const r = await run(["status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /me/);
  assert.match(r.stdout, /public_repo/);
  assert.match(r.stdout, /4999/);
});

// --- Hardening (from code review) ---

test("the token never appears in stdout or stderr (dry-run and error paths)", async () => {
  route = () => ({
    status: 403,
    headers: { "x-ratelimit-remaining": "0" },
    json: { message: "API rate limit exceeded" },
  });
  const dry = await run(["fork", "--repo", "o/r"]);
  assert.doesNotMatch(dry.stdout + dry.stderr, /test-token/);
  const err = await run(["fork", "--repo", "o/r", "--yes"]);
  assert.doesNotMatch(err.stdout + err.stderr, /test-token/);
});

test("flag values starting with -- are consumed as values, not flags", async () => {
  const { root, dir, git } = gateRepo();
  git(["checkout", "-q", "-b", "fix"]);
  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 200, json: {} };
  const f = path.join(dir, "body.md");
  fs.writeFileSync(f, "b\n");
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "main",
    "--head-branch", "fix", "--title", "--wip title", "--body-file", f,
  ], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"title": "--wip title"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("reviews rejects a non-array 200 body with a clear error", async () => {
  route = () => ({ status: 200, json: { unexpected: true } });
  const r = await run(["reviews", "--repo", "o/r", "--pr", "1"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unexpected response/i);
  assert.doesNotMatch(r.stderr, /TypeError|at .*\.js:/);
});

// --- Attribution gate (base..head semantics, C2) ---

// Helper: throwaway repo with a local bare remote as the PR base's origin.
// Establishes a local `main` with a trailer'd base commit pushed to
// origin/main, then moves to a `feature` branch ready for PR commits.
// Returns { root, dir, bare, git } and an addCommit() for the repo.
function gateRepo() {
  const { execFileSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const dir = path.join(root, "repo");
  const bare = path.join(root, "bare.git");
  fs.mkdirSync(dir);
  const git = (args, opts = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", ...opts });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.test"]);
  execFileSync("git", ["init", "-q", "--bare", bare], { encoding: "utf8" });
  git(["remote", "add", "origin", bare]);
  fs.writeFileSync(
    path.join(dir, ".myanyagent.toml"),
    'repository = "o/r"\ninstallation_id = "1"\n[bot]\nname = "MyAnyAgent[bot]"\nemail = "b@b.c"\n'
  );
  // Base commit on main, pushed -> origin/main exists locally (resolution order 1).
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  git(["add", "base.txt"]);
  git(["commit", "-q", "-m", "base", "--trailer", "Co-authored-by: MyAnyAgent[bot] <b@b.c>"]);
  git(["push", "-q", "-u", "origin", "main"]);
  git(["checkout", "-q", "-b", "feature"]);
  return {
    root,
    dir,
    bare,
    branch: () => git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    git,
    addCommit(message, { trailer, file = "f.txt" } = {}) {
      fs.writeFileSync(path.join(dir, file), file + "\n" + Math.random());
      git(["add", file]);
      const args = ["commit", "-q", "-m", message];
      if (trailer) args.push("--trailer", `Co-authored-by: ${trailer}`);
      git(args);
    },
  };
}

// THE regression test for C2: the primary documented workflow pushes the head
// branch to the fork with `git push -u origin feature` BEFORE running
// `pr create`. The gate's commit set must be `main..feature` — the PR diff —
// and MUST NOT silently pass just because the branch now has an upstream
// (which would make an `@{upstream}..` range empty).
test("missing-trailer commit on the PR branch is blocked before AND after git push -u", () => {
  const { root, dir, git, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  addCommit("no trailer");

  const before = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "feature" });
  assert.equal(before.ok, false, "must be blocked before push");
  assert.equal(before.total, 1);
  assert.equal(before.missing[0].subject, "no trailer");
  assert.equal(before.base, "origin/main");
  assert.equal(before.branch, "feature");

  // The documented workflow: `git push -u origin feature` BEFORE pr create.
  git(["push", "-q", "-u", "origin", "feature"]);
  const after = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "feature" });
  assert.equal(after.ok, false, "git push -u must NOT hide the commit (C2)");
  assert.equal(after.total, 1);
  assert.equal(after.missing[0].subject, "no trailer");
  assert.equal(after.base, "origin/main");
  assert.equal(after.branch, "feature");

  fs.rmSync(root, { recursive: true, force: true });
});

test("all commits in base..head carrying the trailer pass the gate", () => {
  const { root, dir, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  addCommit("one", { trailer });
  addCommit("two", { trailer });
  const r = checkAttribution({ cwd: dir, trailer, base: "main" });
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
  assert.equal(r.total, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test("unresolvable base fails closed with a git fetch hint", () => {
  const { execFileSync } = require("node:child_process");
  const { root, dir, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  addCommit("no trailer");
  // No local branch/ref named "release" anywhere -> base must not resolve.
  const r = checkAttribution({ cwd: dir, trailer, base: "release" });
  assert.equal(r.ok, false, "unresolvable base must fail closed");
  assert.equal(r.total, 0);
  assert.match(r.error, /cannot resolve base ref 'release'/);
  assert.match(r.error, /git fetch origin release/);
  assert.equal(r.base, "release");
  fs.rmSync(root, { recursive: true, force: true });
});

test("--head-branch naming a branch that does not exist locally fails closed (INF-14)", () => {
  const { root, dir, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  addCommit("no trailer");
  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "does-not-exist" });
  assert.equal(r.ok, false, "typo'd/nonexistent head branch must fail closed");
  assert.equal(r.total, 0);
  assert.equal(r.branch, "does-not-exist");
  assert.match(r.error, /cannot resolve head branch 'does-not-exist'/);
  assert.match(r.error, /git fetch origin does-not-exist/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("head branch present only on the fork remote (no local ref) fails closed (INF-14)", () => {
  const { root, dir, git } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  // Push a branch to origin, then delete its local branch: `remote-only`
  // exists only as origin/remote-only and must NOT resolve as the head.
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "remote-only"]);
  fs.writeFileSync(path.join(dir, "r.txt"), "r\n");
  git(["add", "r.txt"]);
  git(["commit", "-q", "-m", "remote only", "--trailer", "Co-authored-by: MyAnyAgent[bot] <b@b.c>"]);
  git(["push", "-q", "origin", "remote-only"]);
  git(["checkout", "-q", "main"]);
  git(["branch", "-D", "remote-only"]);
  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "remote-only" });
  assert.equal(r.ok, false, "head only on the remote must fail closed, not silently pass");
  assert.equal(r.total, 0);
  assert.match(r.error, /cannot resolve head branch 'remote-only'/);
  assert.match(r.error, /git fetch origin remote-only/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("not inside a git repository fails closed (INF-14)", () => {
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  const r = checkAttribution({ cwd: tmpHome(), trailer, base: "main" });
  assert.equal(r.ok, false, "no repo / unresolvable HEAD must fail closed, not soft-pass");
  assert.equal(r.total, 0);
  assert.match(r.error, /cannot resolve HEAD/);
});

test("a legitimately empty range (head == base) passes with total 0", () => {
  const { root, dir } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "feature" });
  assert.equal(r.ok, true, "empty range is the one legit ok:true,total:0");
  assert.equal(r.total, 0);
  assert.equal(r.missing.length, 0);
  assert.equal(r.branch, "feature");
  fs.rmSync(root, { recursive: true, force: true });
});

test("--head-branch names a non-current branch: that branch is checked against the base", () => {
  const { root, dir, branch, git, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";

  // feature is exactly at the base -> its range is empty.
  // A DIFFERENT local branch carries a no-trailer commit, while the current
  // branch (feature) stays clean. The gate must check `feature` (the named
  // head), not the current branch.
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "other"]);
  addCommit("no trailer on other");
  assert.notEqual(branch(), "feature");

  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "feature" });
  assert.equal(r.ok, true, "named head branch feature is clean");
  assert.equal(r.total, 0);
  assert.equal(r.branch, "feature");

  const other = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "other" });
  assert.equal(other.ok, false, "named head branch other has the missing trailer");
  assert.equal(other.total, 1);
  assert.equal(other.missing[0].subject, "no trailer on other");

  fs.rmSync(root, { recursive: true, force: true });
});

test("unrelated local branch without trailer does NOT block the PR branch", () => {
  const { root, dir, branch, git, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";

  // feature is clean; an unrelated local branch carries a no-trailer commit.
  // It is never PRed, so it must not affect the gate for the feature branch
  // (I1).
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "unrelated"]);
  addCommit("no trailer on unrelated branch");
  git(["checkout", "-q", "feature"]);

  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: branch() });
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("commits on the base branch before the branch point are not in the commit set", () => {
  const { root, dir, git, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  git(["checkout", "-q", "main"]);
  // Two more base commits — one WITHOUT the trailer — then branch.
  addCommit("base2", { trailer });
  addCommit("base3 no trailer", { file: "b.txt" }); // on main, before branch point
  // The base remote-tracking ref is advanced, as `git fetch` would do.
  git(["push", "-q", "origin", "main"]);
  git(["checkout", "-q", "-b", "feat"]);
  addCommit("feat has trailer", { trailer });

  const r = checkAttribution({ cwd: dir, trailer, base: "main", headBranch: "feat" });
  assert.equal(r.ok, true, "base commits before branch point must be excluded");
  assert.equal(r.total, 1, "only the feat commit is in main..feat");
  assert.equal(r.missing.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a local branch without a remote-tracking counterpart still resolves as the base", () => {
  const { root, dir, git, addCommit } = gateRepo();
  const { checkAttribution } = require("../bin/myanyagent-upstream.cjs");
  const trailer = "MyAnyAgent[bot] <b@b.c>";
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "release"]); // local only, never pushed
  git(["checkout", "-q", "feature"]);
  addCommit("no trailer");
  // origin/release does NOT exist; local branch `release` must be the fallback.
  const r = checkAttribution({ cwd: dir, trailer, base: "release" });
  assert.equal(r.base, "release");
  assert.equal(r.ok, false, "local branch release exists, so the gate runs");
  assert.equal(r.total, 1);
  assert.equal(r.missing[0].subject, "no trailer");
  fs.rmSync(root, { recursive: true, force: true });
});

// Locks the plan's gate semantics: the attribution gate enforces for EVERY
// resolved trailer source — including [bot]-only repos (ruling: bot identity
// is the transport credential; the trailer is authorship disclosure; the two
// are orthogonal, and the policy must close on this repo itself).
test("pr create gate blocks a [bot]-only repo whose commits lack the trailer", async () => {
  const { root, dir, branch, addCommit } = gateRepo();
  addCommit("no trailer here");

  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 201, json: { number: 5, html_url: "https://example/pr/5" } };
  const f = path.join(dir, "body.md");
  fs.writeFileSync(f, "pr body\n");
  const before = hits.length;
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "main",
    "--head-branch", branch(), "--title", "My fix", "--body-file", f, "--yes",
  ], { cwd: dir });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /attribution gate/);
  assert.match(r.stderr, /Co-authored-by: MyAnyAgent\[bot\] <b@b\.c>/);
  assert.ok(
    !hits.slice(before).some((h) => h.url === "/repos/o/r/pulls"),
    "mock server must not receive a /pulls request when the gate blocks",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("pr create fails closed when the PR base ref cannot be resolved locally", async () => {
  const { root, dir, branch, addCommit } = gateRepo();
  addCommit("no trailer");

  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 201, json: { number: 5, html_url: "https://example/pr/5" } };
  const f = path.join(dir, "body.md");
  fs.writeFileSync(f, "pr body\n");
  const before = hits.length;
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "release",
    "--head-branch", branch(), "--title", "My fix", "--body-file", f, "--yes",
  ], { cwd: dir });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /attribution gate/);
  assert.match(r.stderr, /cannot resolve base ref 'release'/);
  assert.ok(
    !hits.slice(before).some((h) => h.url === "/repos/o/r/pulls"),
    "mock server must not receive a /pulls request when the gate fails closed",
  );
  fs.rmSync(root, { recursive: true, force: true });
});
