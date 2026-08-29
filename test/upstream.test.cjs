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

function run(args, { env = {}, input } = {}) {
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
    const c = spawn("node", [BIN, ...args], { env: e, timeout: 20000 });
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
  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 201, json: { number: 5, html_url: "https://example/pr/5" } };
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "pr body\n");
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "main",
    "--head-branch", "fix-x", "--title", "My fix", "--body-file", f, "--yes",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const prHit = hits.find((h) => h.url === "/repos/o/r/pulls");
  assert.ok(prHit, "pulls endpoint was called");
  const sent = JSON.parse(prHit.body);
  assert.equal(sent.head, "me:fix-x");
  assert.equal(sent.base, "main");
  assert.equal(sent.title, "My fix");
  assert.equal(sent.body, "pr body\n");
  assert.match(r.stdout, /number 5|#5/);
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
  route = ({ url }) =>
    url === "/user"
      ? { status: 200, json: { login: "me", id: 42 } }
      : { status: 200, json: {} };
  const f = path.join(tmpHome(), "body.md");
  fs.writeFileSync(f, "b\n");
  const r = await run([
    "pr", "create", "--repo", "o/r", "--base", "main",
    "--head-branch", "fix", "--title", "--wip title", "--body-file", f,
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"title": "--wip title"/);
});

test("reviews rejects a non-array 200 body with a clear error", async () => {
  route = () => ({ status: 200, json: { unexpected: true } });
  const r = await run(["reviews", "--repo", "o/r", "--pr", "1"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unexpected response/i);
  assert.doesNotMatch(r.stderr, /TypeError|at .*\.js:/);
});

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
