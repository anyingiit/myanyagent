# MyAnyAgent

English | [简体中文](README.zh-CN.md)

MyAnyAgent lets an **AI agent** push to GitHub for you — no passwords, no
PATs in your repo. You do a one-time setup in your browser; after that you
just tell the agent what you want ("push this", "open a PR upstream") and
it handles authentication itself.

**How it works in one line:** you register a GitHub App once, the agent
exchanges its private key for short-lived tokens per push, and every
commit is automatically signed with a `Co-authored-by:` AI-disclosure
trailer.

## From Zero to Working (about 10 minutes)

### Step 0 — Prerequisites

A Linux/macOS machine with `git` and Node.js 18+:

```sh
git --version && node --version
```

### Step 1 — Create your GitHub App (browser, ~5 min)

1. Follow the
   [official "Register a GitHub App" tutorial](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
   While registering:
   - **Permissions**: set only **Contents → Read and write** (everything
     else can stay "No access")
   - **Webhook**: deselect "Active" (not needed)
   - **Where can this app be installed**: "Only on this account"
2. After creating, on the same settings page click
   **"Generate a private key"** and download the `.pem` file. (Tutorial:
   [Managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).)
3. Install the App on your own account:
   [official tutorial](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app),
   covering the repositories you want to push to.

**Write down from the App settings page:** the **App ID**, the
**Client ID**, and the installation's numeric ID (visible in the URL of
`https://github.com/settings/installations/<ID>` when you open the
installation's configure page).

### Step 2 — Save the private key on this machine

```sh
mkdir -p ~/.secrets
mv ~/Downloads/*.pem ~/.secrets/myanyagent.private-key.pem
chmod 600 ~/.secrets/myanyagent.private-key.pem
```

(Any path works — you'll point the config at it next. Never commit it.)

### Step 3 — Install MyAnyAgent

```sh
git clone https://github.com/anyingiit/myanyagent.git
cd myanyagent
sh install.sh
```

Then edit the config it printed:

```sh
nano ~/.config/myanyagent/config.toml    # or any editor
```

Fill in your three values from Step 1:

```toml
client_id  = "Iv23xxxxxxx"     # <- Client ID from the App page
app_id     = "12345678"        # <- App ID from the App page
private_key = "~/.secrets/myanyagent.private-key.pem"
```

If `~/.local/bin` isn't on your PATH (install.sh will warn), add it:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile && . ~/.profile
```

### Step 4 — Enable a repository (per repo, once)

In the repo you want to push from, create `.myanyagent.toml`:

```toml
repository = "you/your-repo"    # <- the repo this file lives in
installation_id = "123456"     # <- the number from Step 1's installation URL
[bot]
name  = "your-app[bot]"        # <- the bot name shown on the App page
email = "11111111+your-app[bot]@users.noreply.github.com"
#       ^ 8-10 digit bot user ID (App settings → Advanced), + app slug
```

Commit it, then run:

```sh
myanyagent-bootstrap
```

That's it — `git push` now authenticates through your App. Verify:

```sh
myanyagent-status    # should end with: OK
```

### Optional — Upstream contributions (third-party public repos)

To comment / open PRs on repos **without** your App installed, add a
classic PAT: [official tutorial](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
(scope: `public_repo` only):

```sh
install -m 600 /dev/stdin ~/.secrets/myanyagent-upstream.pat <<< "ghp_xxxx"
```

Skip this if you only push to your own repos.

## Daily Use — Just Talk to the Agent

From here on **you never run tool commands yourself**. Say:

| You say | What happens |
|---|---|
| "push my branch" | Agent pushes; auth is automatic; commits carry AI disclosure |
| "fork this repo and open a PR" | Dry-run first, then executes on confirmation |
| "comment on upstream PR #12" | Allowlisted API write, dry-run first |
| "close upstream issue #5 as completed" | `issue close` with reason |
| "check the auth state" | Agent runs `myanyagent-status`; follows `-> run:` hints to self-heal |

The tool is self-describing: whenever something's wrong it prints
`-> run: <command>`, so the agent (or you) always knows the next step.

## OpenCode Users

Give the agent the bundled skill so it knows the tool from the start:

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## Deep Dive

- [docs/reference.md](docs/reference.md) — every config field, the
  token-minting flow, the endpoint allowlist, all commands
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — research notes behind the upstream model
- [README.zh-CN.md](README.zh-CN.md) — the same guide in Chinese

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