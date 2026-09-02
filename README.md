# MyAnyAgent

English | [简体中文](README.zh-CN.md)

MyAnyAgent lets your **AI agent** push to GitHub and manage PRs/issues
for you — without you handling any passwords or tokens.

You don't install anything yourself. **Tell your agent:**

> "Install myanyagent on this machine. The repo is
> https://github.com/anyingiit/myanyagent"

The agent runs the whole setup. It will come back to you **exactly
once** with a short browser checklist (creating your GitHub App and its
key — the only part that genuinely needs your GitHub account). After
you hand back the three values it asks for, you're done forever.

## What you'll be asked to do (the one-time checklist)

When the agent asks, you'll do three browser steps (~5 minutes) and give
it four values:

1. **Register a GitHub App** in your account settings
   ([official tutorial](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app))
   — during registration set **Contents: Read and write** (the only
   permission needed) and leave webhooks off
2. **Generate a private key** on the App's settings page
   ([official tutorial](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps))
   — download the `.pem` file
3. **Install the App on your own account**
   ([official tutorial](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app))
   — select the repos you want the agent to push to

Then hand the agent: the **Client ID**, the **App ID**, the downloaded
**.pem file**, and the **installation ID** (the number in the URL when
you open the installation's configure page:
`github.com/settings/installations/<ID>`).

That's the entire human part. Everything else — installation, config,
per-repo setup, error recovery — the agent handles by itself, guided by
the tool's built-in `-> run:` hints.

## After setup: what you can say

| You say | The agent does |
|---|---|
| "push my branch" | Authenticates via your App; commits get AI disclosure automatically |
| "fork X and open a PR upstream" | Shows you the plan first, then executes |
| "comment on upstream PR #12" / "close issue #5" | Allowlisted API writes, plan shown first |
| "why is pushing failing?" | Runs `myanyagent-status`, self-heals or tells you what it needs |

## Why this is safe

- Every write operation on third-party repos is a **dry-run first** —
  nothing happens silently
- Only a **fixed allowlist** of GitHub endpoints is callable
- Tokens are **short-lived**, secrets stay in `0600` files, never in
  git history or logs
- Every commit carries `Co-authored-by:` AI disclosure — enforced by a
  git hook, not by trust

## For OpenCode users

If you use [OpenCode](https://opencode.ai), the agent gets a skill that
teaches it all of the above:

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## For agents

- [docs/agent-setup.md](docs/agent-setup.md) — the complete
  install/self-check/checklist procedure you follow
- [docs/reference.md](docs/reference.md) — config fields, credential
  flow, allowlist, all commands
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — research notes behind the upstream model

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