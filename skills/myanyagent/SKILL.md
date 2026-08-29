---
name: myanyagent
description: Use when committing, pushing, or authenticating to GitHub via git on this machine, when debugging git push auth failures or "could not read Username" errors, when setting up a repo for GitHub App bot identity, when contributing to third-party public repos (fork PRs, upstream review replies), or when investigating how this machine pushes to GitHub. Do NOT use for general GitHub API work outside the myanyagent toolchain.
---

# MyAnyAgent GitHub App Authentication

## Overview

This machine authenticates git push to GitHub.com via **GitHub App installation tokens**, not PATs, SSH keys, or `gh` CLI. The mechanism is a git credential helper called `myanyagent` — invisible from `opencode.jsonc`, living entirely in the git layer. A separate allowlisted adapter (`myanyagent-upstream`) covers third-party public-repo contributions.

## When to Use

- Committing or pushing to a GitHub repo on this machine
- Debugging git push auth errors, "could not read Username", 403/401 on push
- Setting up a new repo for GitHub App bot identity
- Contributing to third-party public repos: fork, open PR, reply to review threads
- Investigating how commits get authored as `[bot]`

**Do NOT use** for: GitHub API work outside this toolchain, or auth not tied to `git push`/`git fetch` over HTTPS to github.com.

## What NOT to Check

Git push/fetch auth is `myanyagent` exclusively: **no** `gh` CLI auth, no SSH keys, no `GITHUB_TOKEN`/`GH_TOKEN` env vars, no `~/.config/gh/`. Searching for those wastes time. (One classic PAT exists, but only inside `myanyagent-upstream` — never for git transport.)

## Architecture

| Component | Location | Purpose |
|---|---|---|
| Machine config | `~/.config/myanyagent/config.toml` | `client_id`, `app_id`, `private_key` path |
| RSA private key | `~/.secrets/myanyagent.<date>.private-key.pem` | Signs GitHub App JWTs (0600) |
| Credential helper | `~/.local/share/myanyagent/bin/myanyagent-credential-helper.cjs` | Mints installation tokens on demand |
| Bootstrap script | `~/.local/share/myanyagent/bin/myanyagent-bootstrap.sh` | Writes local git config + smoke test |
| Status script | `~/.local/share/myanyagent/bin/myanyagent-status.sh` | Inspects machine config, key, git config, identity drift |
| Upstream adapter | `~/.local/share/myanyagent/bin/myanyagent-upstream.cjs` | Allowlisted API writes on third-party repos |
| Upstream PAT | `~/.secrets/myanyagent-upstream.pat` | Classic PAT `public_repo` for the human (0600) |
| Per-repo config | `<repo>/.myanyagent.toml` | `repository`, `installation_id`, `[bot]`, optional `[identity]` |

## How It Works

1. Repo has `.myanyagent.toml` with `repository`, `installation_id`, bot identity.
2. `myanyagent-bootstrap` (run once per repo) writes local git config: `user.name`/`user.email` (bot, or human when `[identity]` is declared), `credential.helper`, `myanyagent.repository`/`installationId`, `commit.gpgsign false`.
3. On `git push`/`git fetch` to `github.com/<repository>.git`, git invokes the credential helper.
4. Helper signs a JWT (`iss: client_id`, 9-min TTL), POSTs to `/app/installations/<id>/access_tokens`, returns `username=x-access-token` + `password=<token>`.
5. Git uses token for HTTPS transport. Token is repo-scoped, `contents:write`, short-lived. No persistent credential store.

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

## Key Resolution (private key)

1. `MYANYAGENT_PRIVATE_KEY` env var (absolute path)
2. `git config --local myanyagent.privateKey`
3. `~/.config/myanyagent/config.toml` → `private_key` field
4. Fallback: `~/.secrets/myanyagent.2026-08-04.private-key.pem`

## Operational Commands

- **Inspect**: `myanyagent-status` — repo binding, machine config, key, git config, identity mode
- **Configure a repo**: `myanyagent-bootstrap` — requires `.myanyagent.toml` + `origin` → `https://github.com/<repository>.git`
- **Override key**: `MYANYAGENT_PRIVATE_KEY=/abs/path/key.pem myanyagent-bootstrap`
- **Upstream contributions**: `myanyagent-upstream help` — self-describing usage

## Contributing to third-party public repos (upstream)

The App token is installation-scoped: it **cannot** fork, open PRs, or comment on repos where the App is not installed (403 `Resource not accessible by integration`, docs-verified). Keep three layers separate:

| Layer | Mechanism | Acts as |
|---|---|---|
| Git push to your own fork | credential helper (unchanged) | App |
| Upstream API: fork / PR / comment / review reply / resolve thread | `myanyagent-upstream` | the human |
| Commit authorship | `[identity]` section in `.myanyagent.toml` | the human |

Rules:

- All upstream writes are dry-run unless `--yes`; reads (`status`, `identity`, `reviews`, `threads`, `notifications`) run freely.
- `myanyagent-upstream identity` prints the exact `git config` lines (ID-based noreply) for the PAT account.
- **Contribution worktree = `[identity]` declared.** Bootstrap then writes the human identity and adds `.myanyagent.toml` to `.git/info/exclude` so it never enters a PR diff. Never `git config user.*` by hand — edit the toml and re-run bootstrap.
- GitHub Contributors pages and profile graphs credit the **commit author email** — push credentials are irrelevant to attribution.

## Common Mistakes

| Mistake | Reality |
|---|---|
| Looking for `GITHUB_TOKEN`, `gh` CLI, or SSH keys | Git auth uses the GitHub App flow exclusively. |
| Setting `credential.helper` yourself | Bootstrap owns this. Don't override. |
| Hand-editing `user.name`/`user.email` | Bootstrap owns identity: bot by default, human when `[identity]` is declared. Edit the toml, re-run bootstrap. |
| Using the App token to open PRs or comment upstream | 403 by design (installation-scoped). Use `myanyagent-upstream`. |
| Ignoring `myanyagent-status` when push fails | Run it first. Common causes: key missing/renamed, `.myanyagent.toml` absent, `origin` URL mismatch. |
| Assuming unconfigured repos can push | Without `.myanyagent.toml`, no GitHub App auth exists. Push fails unless another credential source is present. |
