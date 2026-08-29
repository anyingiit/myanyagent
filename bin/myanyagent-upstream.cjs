#!/usr/bin/env node
"use strict";

// myanyagent-upstream — minimal, allowlisted API adapter for contributing to
// third-party public repositories as the human account (classic PAT,
// public_repo scope). Git transport is intentionally NOT here: pushes to your
// own forks stay on the GitHub App installation token (credential helper).
//
// Guardrails:
//  - token from $MYANYAGENT_UPSTREAM_TOKEN or ~/.secrets/myanyagent-upstream.pat
//    (file must be mode 0600; never printed, never in argv)
//  - single request() chokepoint with a method+path allowlist
//  - write commands are DRY-RUN unless --yes is given
//  - rate-limit / secondary-limit responses produce guidance, not retries

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const API = process.env.MYANYAGENT_UPSTREAM_BASE_URL || "https://api.github.com";
const TOKEN_FILE = path.join(os.homedir(), ".secrets", "myanyagent-upstream.pat");

// The allowlist scopes HTTP method+path only. For the "graphql" entry it does
// NOT constrain the GraphQL operation; the CLI surface only ever sends
// THREADS_QUERY / RESOLVE_MUTATION. Programmatic callers via require() can send
// any operation — treat that surface as trusted-only.
const ALLOWLIST = {
  user:            { method: "GET",  path: "/user" },
  reviewComments:  { method: "GET",  path: "/repos/{repo}/pulls/{pr}/comments" },
  reviews:         { method: "GET",  path: "/repos/{repo}/pulls/{pr}/reviews" },
  notifications:   { method: "GET",  path: "/notifications?participating=true&per_page=50" },
  forks:           { method: "POST", path: "/repos/{repo}/forks" },
  pulls:           { method: "POST", path: "/repos/{repo}/pulls" },
  issueComments:   { method: "POST", path: "/repos/{repo}/issues/{n}/comments" },
  reviewReplies:   { method: "POST", path: "/repos/{repo}/pulls/{pr}/comments/{id}/replies" },
  graphql:         { method: "POST", path: "/graphql" },
};

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

// Local gate: every commit that this PR would publish — the ahead-set of the PR
// head branch relative to ITS upstream — must carry the resolved Co-authored-by
// trailer. The branch's upstream is the delivery target, so the range is
// `@{upstream}..HEAD` (or `<upstream>..<branch>` when --head-branch names a
// different local branch). This is symmetric across push: pushing the commits
// elsewhere does not hide them, and only the PR branch is ever checked.
//
// No upstream configured => FAIL CLOSED: the gate has no delivery target to
// compare against, so it reports not-ok with a `git push -u origin <branch>`
// hint. Other git failures stay soft (ok:true, total:0) so odd repos or
// transient errors never break the API flow.
function checkAttribution({ cwd, trailer, headBranch }) {
  const empty = { ok: true, missing: [], total: 0 };
  if (!trailer) return empty;
  const git = (args, opts = {}) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      ...opts,
    });

  let branch;
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return empty;
  }
  if (headBranch && headBranch !== branch) {
    branch = headBranch;
  }

  let upstream;
  try {
    upstream = git(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]).trim();
  } catch (e) {
    const err = String((e && e.stderr) || (e && e.message) || "").toLowerCase();
    if (err.includes("no upstream configured")) {
      return {
        ok: false,
        missing: [],
        total: 0,
        branch,
        error: `branch '${branch}' has no upstream configured — the attribution gate needs a delivery target; git push -u origin ${branch} first`,
      };
    }
    return empty;
  }

  let raw;
  try {
    raw = git(["log", "--format=%H%x00%s%x00%B%x00END", `${upstream}..${branch}`]);
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

function fail(msg) {
  console.error(`myanyagent-upstream: ${msg}`);
  process.exitCode = 1;
}

function hint(msg) {
  console.error(`-> run: ${msg}`);
}

function resolveToken() {
  const env = process.env.MYANYAGENT_UPSTREAM_TOKEN;
  if (env && env.trim()) return env.trim();
  if (!fs.existsSync(TOKEN_FILE)) {
    fail(`upstream token not found: ${TOKEN_FILE}`);
    hint(`create a classic PAT (scope: public_repo) and:  install -m 600 /dev/stdin ${TOKEN_FILE}`);
    process.exit(1);
  }
  const mode = fs.statSync(TOKEN_FILE).mode & 0o777;
  if (mode !== 0o600) {
    fail(`token file ${TOKEN_FILE} must be mode 600 (got ${mode.toString(8)})`);
    hint(`chmod 600 ${TOKEN_FILE}`);
    process.exit(1);
  }
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!token) {
    fail(`token file ${TOKEN_FILE} is empty`);
    process.exit(1);
  }
  return token;
}

function buildPath(spec, params) {
  let p = spec.path;
  for (const [k, v] of Object.entries(params)) {
    if (k === "repo") {
      if (!/^[^/]+\/[^/]+$/.test(String(v))) throw new Error(`--repo must be owner/repo, got: ${v}`);
      p = p.replaceAll("{repo}", String(v)); // keep the owner/repo slash
    } else {
      p = p.replaceAll(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  if (/\{[^}]*\}/.test(p)) throw new Error(`missing path params for ${spec.path}`);
  return p;
}

async function request(key, { params = {}, body } = {}) {
  const spec = ALLOWLIST[key];
  if (!spec) throw new Error(`endpoint not in allowlist: ${key}`);
  const p = buildPath(spec, params);
  const token = resolveToken();
  const res = await fetch(API + p, {
    method: spec.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "myanyagent-upstream",
      "X-GitHub-Api-Version": "2022-11-28",
      Connection: "close",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data, method: spec.method, path: p, body };
}

function explainHttpError(r) {
  const retryAfter = r.headers.get("retry-after");
  const remaining = r.headers.get("x-ratelimit-remaining");
  const msg = (r.data && r.data.message) || String(r.data).slice(0, 200);
  if (r.status === 403 || r.status === 429) {
    if (remaining === "0" || retryAfter || /secondary rate/i.test(msg)) {
      fail(`${r.method} ${r.path} -> ${r.status} (rate limited): ${msg}`);
      hint(`back off${retryAfter ? ` ~${retryAfter}s` : ""}; do NOT retry immediately — continuing while rate limited risks a ban of the account`);
      return;
    }
  }
  fail(`${r.method} ${r.path} -> ${r.status}: ${msg}`);
}

// --- CLI layer ---

const WRITE_COMMANDS = new Set(["fork", "pr", "comment", "reply", "resolve"]);

function parseFlags(args) {
  // Only --yes is boolean; every other --key consumes the next token as its
  // value unconditionally (values may legitimately start with "--").
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--yes") flags.yes = true;
    else if (a.startsWith("--")) {
      const k = a.slice(2);
      flags[k] = i + 1 < args.length ? args[++i] : "true";
    } else flags._.push(a);
  }
  return flags;
}

function need(flags, ...names) {
  for (const n of names) {
    if (!flags[n]) {
      fail(`missing --${n}`);
      return false;
    }
  }
  return true;
}

function readBodyFile(f) {
  return f === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(f, "utf8");
}

function dryRun(key, params, body) {
  const spec = ALLOWLIST[key];
  console.log(`DRY-RUN (pass --yes to execute)`);
  console.log(`${spec.method} ${buildPath(spec, params)}`);
  console.log(`Authorization: Bearer ***`);
  if (body !== undefined) console.log(JSON.stringify(body, null, 2));
}

const THREADS_QUERY = `query($owner:String!,$name:String!,$pr:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      reviewThreads(first:100){
        nodes{ id isResolved comments(first:100){ nodes{ databaseId author{login} } } }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } }
}`;

async function getUser() {
  const r = await request("user");
  if (r.status !== 200) {
    explainHttpError(r);
    process.exit(1);
  }
  return r;
}

async function main(argv) {
  const cmd = argv[0];
  // "pr create" is the only two-word command; everything else parses flags from argv[1]
  const sub = cmd === "pr" ? argv[1] : undefined;
  const flags = parseFlags(cmd === "pr" ? argv.slice(2) : argv.slice(1));

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`usage: myanyagent-upstream <command> [flags]

read:
  status                                  token identity, scopes, rate limit
  identity                                git config lines for human attribution
  reviews       --repo o/r --pr n         list review comments + reviews
  threads       --repo o/r --pr n         map comment IDs to review-thread node IDs
  notifications                           unread participating notifications

write (DRY-RUN unless --yes):
  fork          --repo o/r
  pr create     --repo o/r --base B --head-branch B --title T --body-file F
                (runs the attribution gate: commits ahead of the head branch's
                upstream must carry the trailer; a branch with no upstream
                fails closed until you git push -u origin <branch> first;
                --skip-attribution-check bypasses)
  comment       --repo o/r --number n --body-file F
  reply         --repo o/r --pr n --comment-id id --body-file F
  resolve       --thread-id PRRT_...

body-file "-" reads stdin. token: $MYANYAGENT_UPSTREAM_TOKEN or
~/.secrets/myanyagent-upstream.pat (mode 0600).`);
    return cmd ? 0 : 1;
  }

  if (WRITE_COMMANDS.has(cmd) && !flags.yes) {
    // handled per-command after body construction; see below
  }

  switch (cmd) {
    case "status": {
      const r = await getUser();
      const scopes = r.headers.get("x-oauth-scopes") || "(none)";
      const remaining = r.headers.get("x-ratelimit-remaining") || "?";
      console.log(`login: ${r.data.login}   id: ${r.data.id}`);
      console.log(`noreply: ${r.data.id}+${r.data.login}@users.noreply.github.com`);
      console.log(`scopes: ${scopes}`);
      if (!/\b(public_repo|repo)\b/.test(scopes)) {
        console.log("WARNING: token lacks public_repo scope — third-party writes will fail");
      }
      console.log(`rate limit remaining: ${remaining}`);
      return 0;
    }

    case "identity": {
      const r = await getUser();
      console.log(`git config user.name "${r.data.login}"`);
      console.log(`git config user.email "${r.data.id}+${r.data.login}@users.noreply.github.com"`);
      return 0;
    }

    case "reviews": {
      if (!need(flags, "repo", "pr")) return 1;
      const params = { repo: flags.repo, pr: flags.pr };
      const [comments, reviews] = await Promise.all([
        request("reviewComments", { params }),
        request("reviews", { params }),
      ]);
      for (const r of [comments, reviews]) {
        if (r.status !== 200) {
          explainHttpError(r);
          return 1;
        }
        if (!Array.isArray(r.data)) {
          fail(`unexpected response shape from GET ${r.path}: expected an array`);
          return 1;
        }
      }
      for (const c of comments.data) {
        console.log(
          `comment ${c.id} | ${c.user && c.user.login} | ${c.path}:${c.line ?? c.original_line ?? "?"}${c.in_reply_to_id ? ` | in_reply_to ${c.in_reply_to_id}` : ""}`
        );
        console.log(`  ${String(c.body).split("\n")[0].slice(0, 120)}`);
      }
      for (const rv of reviews.data) {
        console.log(`review ${rv.id} | ${rv.user && rv.user.login} | ${rv.state}`);
        if (rv.body) console.log(`  ${String(rv.body).split("\n")[0].slice(0, 120)}`);
      }
      return 0;
    }

    case "threads": {
      if (!need(flags, "repo", "pr")) return 1;
      const [owner, name] = flags.repo.split("/");
      const r = await request("graphql", {
        body: { query: THREADS_QUERY, variables: { owner, name, pr: Number(flags.pr) } },
      });
      if (r.status !== 200 || !r.data.data) {
        explainHttpError(r);
        return 1;
      }
      const threads = r.data.data.repository.pullRequest.reviewThreads.nodes;
      for (const t of threads) {
        const ids = t.comments.nodes.map((c) => c.databaseId).join(",");
        console.log(`${t.id} | resolved=${t.isResolved} | comments: ${ids}`);
      }
      return 0;
    }

    case "notifications": {
      const r = await request("notifications");
      if (r.status !== 200) {
        explainHttpError(r);
        return 1;
      }
      for (const n of r.data) {
        console.log(
          `${n.repository.full_name}#${(n.subject.url || "").split("/").pop()} | ${n.subject.type} | ${n.subject.title} | ${n.updated_at}`
        );
      }
      return 0;
    }

    case "fork": {
      if (!need(flags, "repo")) return 1;
      if (!flags.yes) {
        dryRun("forks", { repo: flags.repo });
        return 0;
      }
      const r = await request("forks", { params: { repo: flags.repo }, body: {} });
      if (r.status !== 202) {
        explainHttpError(r);
        return 1;
      }
      console.log(`fork: ${r.data.full_name}   ${r.data.html_url}`);
      console.log("note: forking is asynchronous; the repo may take a moment before pushes work");
      return 0;
    }

    case "pr": {
      if (sub !== "create") {
        fail(`unknown subcommand: pr ${sub || ""} (expected "pr create")`);
        return 1;
      }
      if (!need(flags, "repo", "base", "head-branch", "title", "body-file")) return 1;
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
          const gate = checkAttribution({
            cwd: process.cwd(),
            trailer: resolved.trailer,
            headBranch: flags["head-branch"],
          });
          if (!gate.ok) {
            if (gate.error) {
              fail(`attribution gate: ${gate.error}`);
              hint(`git push -u origin ${gate.branch} first, then re-run this command`);
              return 1;
            }
            fail(`attribution gate: ${gate.missing.length} of ${gate.total} local commit(s) lack Co-authored-by: ${resolved.trailer}`);
            for (const c of gate.missing) fail(`  ${c.sha} ${c.subject}`);
            hint("git rebase / amend to add the trailer, or re-run with --skip-attribution-check");
            hint("the prepare-commit-msg hook auto-adds it: myanyagent-bootstrap installs the hook");
            return 1;
          }
        }
      }
      const u = await getUser();
      const body = {
        title: flags.title,
        body: readBodyFile(flags["body-file"]),
        head: `${u.data.login}:${flags["head-branch"]}`,
        base: flags.base,
      };
      if (!flags.yes) {
        dryRun("pulls", { repo: flags.repo }, body);
        return 0;
      }
      const r = await request("pulls", { params: { repo: flags.repo }, body });
      if (r.status !== 201) {
        explainHttpError(r);
        return 1;
      }
      console.log(`PR #${r.data.number} created: ${r.data.html_url}`);
      return 0;
    }

    case "comment": {
      if (!need(flags, "repo", "number", "body-file")) return 1;
      const body = { body: readBodyFile(flags["body-file"]) };
      const params = { repo: flags.repo, n: flags.number };
      if (!flags.yes) {
        dryRun("issueComments", params, body);
        return 0;
      }
      const r = await request("issueComments", { params, body });
      if (r.status !== 201) {
        explainHttpError(r);
        return 1;
      }
      console.log(`comment created: ${r.data.html_url}`);
      return 0;
    }

    case "reply": {
      if (!need(flags, "repo", "pr", "comment-id", "body-file")) return 1;
      const body = { body: readBodyFile(flags["body-file"]) };
      const params = { repo: flags.repo, pr: flags.pr, id: flags["comment-id"] };
      if (!flags.yes) {
        dryRun("reviewReplies", params, body);
        return 0;
      }
      const r = await request("reviewReplies", { params, body });
      if (r.status !== 201) {
        explainHttpError(r);
        return 1;
      }
      console.log(`reply created: ${r.data.html_url}`);
      return 0;
    }

    case "resolve": {
      if (!need(flags, "thread-id")) return 1;
      const body = { query: RESOLVE_MUTATION, variables: { threadId: flags["thread-id"] } };
      if (!flags.yes) {
        dryRun("graphql", {}, body);
        return 0;
      }
      const r = await request("graphql", { body });
      if (r.status !== 200 || !r.data.data) {
        explainHttpError(r);
        return 1;
      }
      const t = r.data.data.resolveReviewThread.thread;
      console.log(`thread ${flags["thread-id"]} resolved=${t.isResolved}`);
      return 0;
    }

    default:
      fail(`unknown command: ${cmd}`);
      hint("myanyagent-upstream help   (usage)");
      return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      fail(e.message);
      process.exitCode = 1;
    });
}

module.exports = { request, ALLOWLIST, checkAttribution };
