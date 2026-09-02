# MyAnyAgent Reference — Internals & Configuration

This document holds the operational details intentionally kept out of the
top-level READMEs (which focus on driving an agent). Read this if you are
setting up a machine, auditing the tool, or debugging it.

- [English README](../README.md) · [中文 README](../README.zh-CN.md)

## Install (per machine, once)

```sh
# From a clone of this repo:
sh install.sh
```

This installs the tool to `~/.local/share/myanyagent/`, creates symlinks
in `~/.local/bin/`, and writes `~/.config/myanyagent/config.toml`.

Prerequisites: `git`, `node` 18+, and the GitHub App private key at
`~/.secrets/myanyagent.private-key.pem` (any path the config points at; provision separately,
never commit).

Offline/air-gapped machines can skip bootstrap's credential smoke test
(which needs GitHub access) with `MYANYAGENT_SKIP_SMOKE_TEST=1`.

## Per-Repo Setup

1. Add the repository to the GitHub App's selected repositories in App
   settings.
2. Create `.myanyagent.toml` at the repo root:

   ```toml
   repository = "owner/repo"
   installation_id = "123456"
   [bot]
   name = "MyAnyAgent[bot]"
   email = "123456789+myanyagent[bot]@users.noreply.github.com"
   ```

3. Commit it.
4. Run `myanyagent-bootstrap` in the repo.
5. `git push` to verify.

## Credential Provisioning (human-only)

These steps require a browser and your GitHub account; the agent cannot
do them. Official tutorials:

- Register the App: <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app>
  — the only permission required is **Contents: Read & write**; webhooks
  can be disabled.
- Install it on your account: <https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app>
- Generate the private key: <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps>
- Classic PAT (upstream contributions only): <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

### Field-by-field: required configuration

**`~/.config/myanyagent/config.toml`** (machine level, written by
`install.sh` from `config/config.template.toml`):

| Field | Meaning | Where to find it |
|---|---|---|
| `client_id` | App's Client ID (public; JWT issuer `iss`) | App settings page, "Client ID" |
| `app_id` | App's ID (reference only) | App settings page, "App ID" |
| `private_key` | Absolute path to the `.pem` | Wherever you saved the generated key |

**`<repo>/.myanyagent.toml`** (per repo):

| Field | Meaning | Where to find it |
|---|---|---|
| `repository` | `owner/repo` this binding is for | Your repo |
| `installation_id` | The App installation's numeric ID | URL of the installation page under github.com/settings/installations — its numeric path segment |
| `[bot] name` | Bot identity for commit authorship | The App page shows the app-slug bot name, e.g. `MyAnyAgent[bot]` |
| `[bot] email` | Bot noreply address | `<bot-user-id>+<bot-slug>@users.noreply.github.com` — the bot user ID is on the App's "Advanced" page after first install |

**Secret files** (never committed, mode 0600):

| File | Purpose |
|---|---|
| `~/.secrets/myanyagent.private-key.pem` | GitHub App private key (signs JWTs) |
| `~/.secrets/myanyagent-upstream.pat` | Classic PAT `public_repo` for the human (upstream writes) |

## How the Credential Flow Works

1. Repo has `.myanyagent.toml` with `repository`, `installation_id`, bot
   identity.
2. `myanyagent-bootstrap` (run once per repo) writes local git config:
   `user.name`/`user.email` (bot, or human when `[identity]` is declared),
   `credential.helper`, `myanyagent.repository`/`installationId`,
   `commit.gpgsign false`, plus the attribution hooksPath.
3. On `git push`/`git fetch` to `github.com/<repository>.git`, git invokes
   the credential helper.
4. Helper signs a JWT (`iss: client_id`, 9-min TTL), POSTs to
   `/app/installations/<id>/access_tokens`, returns
   `username=x-access-token` + `password=<token>`.
5. Git uses the token for HTTPS transport. Token is repo-scoped,
   `contents:write`, short-lived. No persistent credential store.

### Private key resolution

1. `MYANYAGENT_PRIVATE_KEY` env var (absolute path)
2. `git config --local myanyagent.privateKey`
3. `~/.config/myanyagent/config.toml` → `private_key` field
4. Fallback: `~/.secrets/myanyagent.private-key.pem`

## Agent Discovery Protocol

The tool self-describes its next step so agents need zero prior
knowledge:

- If a repo has `.myanyagent.toml`, it declares MyAnyAgent usage.
- On `git push` auth failure, the credential helper prints a remediation
  hint on stderr: `-> run: myanyagent-status`.
- `myanyagent-status` reports state and prints `-> run: <command>` when
  action is needed (or `OK` when all green).
- The agent follows the `-> run:` lines to self-heal.

No command memorization required; the tool self-describes the next step.

## Commands

| Command | Purpose |
|---------|---------|
| `myanyagent-bootstrap` | Configure local `.git/config` from `.myanyagent.toml` + machine config |
| `myanyagent-status` | Read-only state report with `-> run:` hints |
| `myanyagent-helper` | Git credential helper (called by git, not directly) |
| `myanyagent-upstream` | Allowlisted GitHub API adapter for third-party public-repo contributions |

## Contributing to third-party public repos

The App installation token can only act on repositories covered by the
App's installations. For upstream repos you do not control, a separate,
deliberately small adapter is used:

- **Git transport** (push to your own forks) stays on the App credential
  helper — unchanged.
- **Upstream API writes** (create fork, open PR, create/close issues,
  comment, reply to review threads, resolve threads) go through
  `myanyagent-upstream`, which holds a classic PAT (`public_repo`) for
  the human account at `~/.secrets/myanyagent-upstream.pat` (mode 0600).
  Every write is a dry-run unless `--yes` is passed; only a fixed
  allowlist of endpoints is callable.
- **Commit attribution** is orthogonal to authentication. A worktree that
  feeds PRs upstream declares the human's identity in `.myanyagent.toml`:

  ```toml
  [identity]
  name = "your-username"
  email = "<id>+your-username@users.noreply.github.com"
  ```

  `myanyagent-bootstrap` then writes the human identity (not the bot's)
  into git config, and adds `.myanyagent.toml` to `.git/info/exclude` so
  it never enters a PR diff. `myanyagent-upstream identity` prints the
  exact git config lines (and the ID-based noreply address) for the
  PAT's account.
- **AI disclosure is enforced, not advisory.** Every commit carries a
  `Co-authored-by:` trailer naming the agent. Bootstrap installs a
  `prepare-commit-msg` hook that appends the resolved trailer automatically
  (env `MYANYAGENT_ATTRIBUTION` > `[identity].co_author` > `[bot]` block;
  `--no-verify` does NOT skip `prepare-commit-msg`), and
  `myanyagent-upstream pr create` refuses to open a PR when any commit in
  `<base>..<head-branch>` (what the PR will contain) lacks the trailer —
  the gate resolves the base ref locally, so `git fetch origin <base>`
  first if it's missing (`--skip-attribution-check` bypasses).
  `myanyagent-status` reports hook state, the resolved trailer, and
  commits since `origin/HEAD` missing it.

See `docs/contributing-to-third-party-repos.md` for the full capability
research and failure record behind this design.

## OpenCode skill

An [OpenCode skill](https://opencode.ai) for this tool ships in the repo
at `skills/myanyagent/SKILL.md`:

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

The skill tells the agent when to use MyAnyAgent, how the GitHub App
credential-helper flow works, and which commands to run — complementing
the runtime `-> run:` hints.

## Tests

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/hooks.test.sh
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/install.test.sh
```