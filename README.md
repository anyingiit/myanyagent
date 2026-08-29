# MyAnyAgent — Reusable GitHub App Git Auth Tool

A machine-level tool that authenticates `git push` using a GitHub App
installation token, reusable across any repository authorized under the
same App. No per-repo scripts; each repo just commits a small
`.myanyagent.toml` declaring its parameters.

## Install (per machine, once)

```sh
# From a clone of this repo:
sh install.sh
```

This installs the tool to `~/.local/share/myanyagent/`, creates symlinks
in `~/.local/bin/`, and writes `~/.config/myanyagent/config.toml`.

Prerequisites: `git`, `node` 18+, and the GitHub App private key at
`~/.secrets/myanyagent.<date>.private-key.pem` (provision separately,
never commit).

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

## Agent Discovery (how AI agents learn the tool)

The tool is designed for agent use with zero prior knowledge:

- If a repo has `.myanyagent.toml`, it declares MyAnyAgent usage.
- On `git push` auth failure, the credential helper prints a remediation
  hint on stderr: `-> run: myanyagent-status`.
- `myanyagent-status` reports state and prints `-> run: <command>` when
  action is needed (or `OK` when all green).
- The agent follows the `-> run:` lines to self-heal.

No command memorization required; the tool self-describes the next step.

### OpenCode skill

An [OpenCode skill](https://opencode.ai) for this tool ships in the repo at
`skills/myanyagent/SKILL.md`. To let an OpenCode agent load it automatically,
install or symlink it into the user skills directory:

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

The skill tells the agent when to use MyAnyAgent, how the GitHub App
credential-helper flow works, and which commands to run (`myanyagent-status`,
`myanyagent-bootstrap`, `myanyagent-upstream`) — complementing the runtime
`-> run:` hints above.

## Commands

| Command | Purpose |
|---------|---------|
| `myanyagent-bootstrap` | Configure local `.git/config` from `.myanyagent.toml` + machine config |
| `myanyagent-status` | Read-only state report with `-> run:` hints |
| `myanyagent-helper` | Git credential helper (called by git, not directly) |
| `myanyagent-upstream` | Allowlisted GitHub API adapter for third-party public-repo contributions |

## Contributing to third-party public repos

The App installation token can only act on repositories covered by the App's
installations. For upstream repos you do not control, a separate, deliberately
small adapter is used:

- **Git transport** (push to your own forks) stays on the App credential
  helper — unchanged.
- **Upstream API writes** (create fork, open PR, comment, reply to review
  threads, resolve threads) go through `myanyagent-upstream`, which holds a
  classic PAT (`public_repo`) for the human account at
  `~/.secrets/myanyagent-upstream.pat` (mode 0600). Every write is a dry-run
  unless `--yes` is passed; only a fixed allowlist of endpoints is callable.
- **Commit attribution** is orthogonal to authentication. A worktree that
  feeds PRs upstream declares the human's identity in `.myanyagent.toml`:

  ```toml
  [identity]
  name = "your-username"
  email = "<id>+your-username@users.noreply.github.com"
  ```

  `myanyagent-bootstrap` then writes the human identity (not the bot's) into
  git config, and adds `.myanyagent.toml` to `.git/info/exclude` so it never
  enters a PR diff. `myanyagent-upstream identity` prints the exact git config
  lines (and the ID-based noreply address) for the PAT's account.

See `docs/contributing-to-third-party-repos.md` for the full capability
research and failure record behind this design.

## Tests

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
sh test/bootstrap.test.sh
sh test/status.test.sh
```