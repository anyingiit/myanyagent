# Agent Setup Guide — installing MyAnyAgent on a machine

> **Audience: AI agents.** A human asked you to "install myanyagent" or a
> push failed with a myanyagent hint. This page is the exact procedure.
> The human-facing README stays minimal on purpose — you run every step
> except one browser checklist.

## Contract

You (the agent) do all shell work. The human does exactly one thing:
browser-based GitHub App creation + handing you four values. You collect
everything into ONE checklist request (see below), never per-field
pestering.

## Procedure

### 1. Install the tool

```sh
git clone https://github.com/anyingiit/myanyagent.git /tmp/myanyagent-src  # or wherever
cd /tmp/myanyagent-src
sh install.sh
```

Notes:
- Requires `git` and Node.js 18+. If missing, install them (package
  manager) or ask the human how they prefer.
- install.sh writes a **placeholder** `~/.config/myanyagent/config.toml`
  on first run and prints NEXT STEPS. Placeholders are expected — do NOT
  try to invent App values.
- If install.sh warns `~/.local/bin` is not on PATH, add it to the
  shell profile AND export it in your current session.

### 2. Run the self-check

```sh
myanyagent-status
```

Interpret the last block:

| Output | Meaning | Your next step |
|---|---|---|
| `OK` | Everything configured | Done. Verify with a real push if asked. |
| `HUMAN SETUP NEEDED ...` | Config still placeholder | **Paste the checklist verbatim to the human.** Wait for the 4 values (see below). |
| `-> run: myanyagent-bootstrap` | Tool installed, repo not bootstrapped | Step 3. |
| `-> run: sh install.sh` | Tool not installed | Step 1. |

### 3. The human checklist (only human step — do not paraphrase it away)

When status prints `HUMAN SETUP NEEDED`, relay the block to the human
as-is. The human returns:

1. **Client ID** — App settings page
2. **App ID** — same page
3. **private key** — the `.pem` they downloaded (ask them to drop it at
   `~/.secrets/myanyagent.private-key.pem`, mode 0600; or tell you the
   real path)
4. **installation ID** — the number in the URL of their installation's
   configure page: `https://github.com/settings/installations/<ID>`

### 4. Fill the machine config

Edit `~/.config/myanyagent/config.toml` with the returned values:

```toml
client_id  = "<from human>"
app_id     = "<from human>"
private_key = "~/.secrets/myanyagent.private-key.pem"   # <- real .pem path
```

Verify the key file is readable (`test -r`). If the human gave a
different path, use that path in `private_key`.

### 5. Bootstrap the repo (per repo)

In the repo that needs pushing:

- If `.myanyagent.toml` is absent, create it (commit it after):

  ```toml
  repository = "owner/repo"          # <- the origin URL's owner/repo
  installation_id = "<from human>"  # <- step 3's installation ID
  [bot]
  name  = "<app-slug>[bot]"         # <- App page shows the bot login, e.g. "my-app[bot]"
  email  = "<bot-user-id>+<app-slug>@users.noreply.github.com"
  ```

  The bot user ID: App settings → Advanced → "App ID" section, or ask
  the human for the number shown before the `+` on the App page's bot
  account.

- Then:

  ```sh
  myanyagent-bootstrap
  ```

  Bootstrap fails loudly with `-> fix:` / `-> run:` hints when something
  is wrong — follow them. For offline/air-gapped machines, prefix
  `MYANYAGENT_SKIP_SMOKE_TEST=1`.

### 6. Verify

```sh
myanyagent-status    # must end with: OK
git push             # if the human asked for a push
```

Every commit you make will automatically carry a
`Co-authored-by: <bot>` trailer — do not remove it, do not add
`Signed-off-by` for the human.

## Optional: upstream contributions

If the human needs comment/PR operations on repos WITHOUT the App
installed, a classic PAT (`public_repo` only) is required at
`~/.secrets/myanyagent-upstream.pat` (0600). The human must create it in
their browser (you cannot). Ask them to run:

```sh
install -m 600 /dev/stdin ~/.secrets/myanyagent-upstream.pat <<< "ghp_xxxx"
```

Everything else (fork, PR, comment, reply, resolve, issue create/close)
goes through `myanyagent-upstream help` — self-describing. Never read
the PAT file yourself or call the GitHub API directly with it; the
allowlist adapter is the only sanctioned path.

## Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| `config.toml still has placeholder values` | Fresh install | Step 3-4 (get values from human) |
| `private key is missing or unreadable: <path>` | .pem not at the configured path | Save it there, or edit `private_key` in config.toml |
| `origin fetch URL must be https://github.com/<repository>.git` | toml repository ≠ origin URL | Fix the toml (or the remote) to match |
| Push 403 `Resource not accessible by integration` | App not installed on that repo | Human adds the repo to the installation, or it's an upstream repo → PAT route |
| `cannot resolve base ref '<base>' locally` | pr create needs the base ref | `git fetch origin <base>` first |