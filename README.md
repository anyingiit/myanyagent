# MyAnyAgent — How to Use It

English | [简体中文](README.zh-CN.md)

MyAnyAgent is a tool for **AI agents**, operated by **humans**. You don't
run its commands yourself — you tell your agent what you want, and the
agent drives the tool. This README teaches you what to say.

## The One-Time Setup

```sh
sh install.sh
```

That's the only step you ever run by hand. It installs the tool and
sets up authentication (GitHub App token, no passwords). If anything
is missing, your agent will tell you exactly what to install.

Prerequisites: `git`, Node.js 18+. The agent handles the rest — see
[docs/reference.md](docs/reference.md) only if you care about internals.

## Prepare the Credentials (human-only, required)

Before `sh install.sh` can actually authenticate pushes, **you** must
provision one secret and fill in config values. The agent cannot do
these for you — they require your GitHub account in a browser.

### 1. GitHub App private key (required — authenticates `git push`)

1. **Register a GitHub App** under your account:
   [official tutorial](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
   While registering, set **Contents → Read & write** (the only
   permission needed); webhooks can stay off.
2. **Install it on your own account**:
   [installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app),
   selecting the repositories it should cover.
3. **Generate a private key** on the App's settings page:
   [managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).
   Save the `.pem` download as
   `~/.secrets/myanyagent.<date>.private-key.pem` (mode `0600`). Never
   commit it anywhere.

### 2. Required configuration

| File | Required values | Where they come from |
|---|---|---|
| `~/.config/myanyagent/config.toml` (machine, written by `install.sh`) | `client_id`, `app_id`, `private_key` | The App's settings page shows **App ID** and **Client ID**; `private_key` is the `.pem` path above |
| `<repo>/.myanyagent.toml` (per repo) | `repository`, `installation_id`, `[bot]` name/email | `installation_id` is the number in the URL of the installation's configure page (`github.com/settings/installations/<id>`); `[bot]` name is the app-slug form shown on the App page (e.g. `MyAnyAgent[bot]`), email is `<bot-user-id>+<bot-name>@users.noreply.github.com` |

After the files exist, run `myanyagent-bootstrap` in the repo (or let
the agent do it) and the tool is live. Full field-by-field detail:
[docs/reference.md](docs/reference.md).

### 3. Upstream PAT (optional — third-party public-repo contributions)

Commenting/PRs on repos that don't have your App installed need a
classic PAT: [creating a personal access token (classic)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
with scope **`public_repo`**, saved to
`~/.secrets/myanyagent-upstream.pat` (mode `0600`). Skip this if you
only push to your own repos.

## Using a Repo with MyAnyAgent

If a repo contains a `.myanyagent.toml` file, it's MyAnyAgent-enabled.
Just work with the agent as usual:

- **"push these commits"** → the agent pushes; auth just works
- **"open a PR upstream"** → the agent runs the PR command, which
  refuses if any commit lacks AI disclosure (`Co-authored-by:`) —
  every commit gets it automatically, so you rarely see this
- **"comment on PR #12 of that repo"** → the agent handles it through
  the allowlisted upstream adapter

You never need to know which command does what. Two things the agent
will surface to you:

1. **First-time use in a new repo** — the agent may ask you to run
   `myanyagent-bootstrap` there (one command, one time).
2. **Something went wrong** — the agent sees a `-> run: ...` hint and
   fixes it itself, following the tool's self-describing messages.

## What You Can Ask For

| You say | What happens |
|---|---|
| "Push my branch" | Auth via GitHub App token; commits carry AI disclosure automatically |
| "Fork this repo and open a PR" | Fork + PR through the dry-run-first adapter (every write shows a plan first) |
| "Comment / reply / resolve thread on upstream PR" | Allowlisted API writes as your identity, never silently — dry-run until confirmed |
| "What's the auth state here?" | `myanyagent-status` report: green (`OK`) or a `-> run:` fix hint |
| "Read my GitHub notifications / PR reviews" | Read-only commands, no risk |

## Why It's Safe to Let the Agent Drive

- Every upstream write is a **dry-run first** — the agent sees exactly
  what would be sent before anything real happens.
- Only a **fixed allowlist of endpoints** is callable; anything else
  is refused.
- Tokens are **short-lived or file-locked (0600)**, never in argv,
  URLs, or logs.
- **AI disclosure is enforced**: commits carry `Co-authored-by:`
  automatically, and PRs containing undisclosed AI commits are
  blocked from creation.
- On any failure the tool prints a `-> run:` hint — the agent
  self-heals instead of flailing.

## OpenCode Users

If you use [OpenCode](https://opencode.ai), install the bundled skill so
the agent knows MyAnyAgent from the start:

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## Further Reading

- [docs/reference.md](docs/reference.md) — full internals: config
  files, credential flow, allowlist, commands
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — the research behind the upstream model

## Tests

The suite is agent-relevant too — tell the agent "run the myanyagent
tests" and it knows:

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/hooks.test.sh
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/install.test.sh
```