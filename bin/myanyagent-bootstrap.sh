#!/bin/sh
set -eu

fail() {
  printf '%s\n' "myanyagent: $1" >&2
  printf '%s\n' '-> run: myanyagent-status   (inspect)' >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail 'git is required'
command -v node >/dev/null 2>&1 || fail 'node.js is required'

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail 'run inside a Git repository'
cd "$repo_root"

toml="$repo_root/.myanyagent.toml"
[ -f "$toml" ] || fail ".myanyagent.toml not found at repository root"

# Parse .myanyagent.toml (simple key=value and [section] parser)
toml_get() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\\([^\"]*\\)\".*$/\\1/p" "$toml" | head -1
}

# Section-aware variant: toml_get_in <section> <key>
toml_get_in() {
  sed -n "/^\[$1\]/,/^\[/p" "$toml" |
    sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*\"\\([^\"]*\\)\".*$/\\1/p" | head -1
}

repository=$(toml_get repository) || repository=""
installation_id=$(toml_get installation_id) || installation_id=""
bot_name=$(toml_get_in bot name) || bot_name=""
bot_email=$(toml_get_in bot email) || bot_email=""
id_name=$(toml_get_in identity name) || id_name=""
id_email=$(toml_get_in identity email) || id_email=""
id_coauthor=$(toml_get_in identity co_author) || id_coauthor=""

[ -n "$repository" ] || fail "repository not set in .myanyagent.toml"
[ -n "$installation_id" ] || fail "installation_id not set in .myanyagent.toml"
[ -n "$bot_name" ] || fail "bot.name not set in .myanyagent.toml"
[ -n "$bot_email" ] || fail "bot.email not set in .myanyagent.toml"

# Commit authorship: [identity] (human contribution mode) wins over [bot].
author_name="$bot_name"
author_email="$bot_email"
contribution_mode=false
if [ -n "$id_name" ] || [ -n "$id_email" ]; then
  [ -n "$id_name" ] || fail "identity.name must be set when [identity] is present"
  [ -n "$id_email" ] || fail "identity.email must be set when [identity] is present"
  author_name="$id_name"
  author_email="$id_email"
  contribution_mode=true
fi

fetch_url=$(git remote get-url origin 2>/dev/null) || fail 'origin remote is missing'
push_url=$(git remote get-url --push origin 2>/dev/null) || fail 'origin push remote is missing'
target_url="https://github.com/${repository}.git"
[ "$fetch_url" = "$target_url" ] || fail "origin fetch URL must be $target_url (got $fetch_url)"
[ "$push_url" = "$target_url" ] || fail "origin push URL must be $target_url (got $push_url)"

# Private key resolution: env > machine config > default
config_file="$HOME/.config/myanyagent/config.toml"
key_file=""
if [ -n "${MYANYAGENT_PRIVATE_KEY:-}" ]; then
  key_file="$MYANYAGENT_PRIVATE_KEY"
  case "$key_file" in /*) ;; *) fail "MYANYAGENT_PRIVATE_KEY must be an absolute path" ;; esac
elif [ -f "$config_file" ]; then
  key_file=$(sed -n 's/^[[:space:]]*private_key[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' "$config_file" | head -1)
  # Expand ~ in path
  case "$key_file" in '~'*) key_file="$HOME${key_file#"~"}" ;; esac
fi
[ -n "$key_file" ] || fail "private key path not configured (set MYANYAGENT_PRIVATE_KEY or private_key in config.toml)"
[ -r "$key_file" ] || fail "private key is missing or unreadable: $key_file"

# Tool paths
tool_dir="$HOME/.local/share/myanyagent"
helper="$tool_dir/bin/myanyagent-credential-helper.cjs"
[ -f "$helper" ] || fail "tool not installed at $tool_dir (run install.sh first)"

# Write local git config
git config --local user.name "$author_name"
git config --local user.email "$author_email"
git config --local user.useConfigOnly true
git config --local commit.gpgsign false
git config --local credential.useHttpPath true
git config --local myanyagent.repository "$repository"
git config --local myanyagent.installationId "$installation_id"
git config --local myanyagent.privateKey "$key_file"
git config --local --unset-all credential.helper >/dev/null 2>&1 || :
git config --local credential.helper ''
git config --local --add credential.helper "!node \"$helper\""

# In contribution mode the worktree usually feeds a PR to an upstream repo:
# keep .myanyagent.toml out of the PR diff via .git/info/exclude.
# git rev-parse --git-path resolves correctly for both main trees (.git dir)
# and linked worktrees (.git is a gitdir file).
if $contribution_mode; then
  exclude_file=$(git rev-parse --git-path info/exclude) || fail "cannot resolve git exclude path"
  touch "$exclude_file"
  grep -qxF '.myanyagent.toml' "$exclude_file" || printf '%s\n' '.myanyagent.toml' >> "$exclude_file"
fi

# Attribution hook: every commit in this repo auto-carries the Co-authored-by
# trailer (agent disclosure). We only ever manage our own hook (marker line),
# and we never clobber a repo's existing core.hooksPath — if one is set, the
# hook is copied into that directory instead.
hook_src="$tool_dir/hooks/prepare-commit-msg"
if [ -f "$hook_src" ]; then
  existing_hooks_path=$(git config --local --get core.hooksPath 2>/dev/null || true)
  if [ -z "$existing_hooks_path" ]; then
    existing_hooks_path=$(git config --global --get core.hooksPath 2>/dev/null || true)
  fi
  if [ -n "$existing_hooks_path" ]; then
    case "$existing_hooks_path" in
      /*) hooks_dir="$existing_hooks_path" ;;
      *) hooks_dir="$repo_root/$existing_hooks_path" ;;
    esac
  else
    hooks_dir=$(git rev-parse --git-path myanyagent-hooks) || fail "cannot resolve git hooks path"
    case "$hooks_dir" in
      /*) ;;
      *) hooks_dir="$repo_root/$hooks_dir" ;;
    esac
    # Per-worktree core.hooksPath via extensions.worktreeConfig: bootstrapping a
    # linked worktree must never touch the main worktree's hooks config (--local
    # writes the shared config file). git rev-parse --git-path already resolves
    # per-worktree, so the value is correct for whichever worktree runs this.
    if git config extensions.worktreeConfig true 2>/dev/null \
       && git config --worktree core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)" 2>/dev/null; then
      # A previous bootstrap may have set core.hooksPath via --local (shared
      # across worktrees); unset it so the per-worktree value is not shadowed.
      git config --local --unset core.hooksPath >/dev/null 2>&1 || true
    else
      printf 'myanyagent: warning: git too old for per-worktree core.hooksPath; falling back to --local\n' >&2
      git config --local core.hooksPath "$(git rev-parse --git-path myanyagent-hooks)"
    fi
  fi
  mkdir -p "$hooks_dir"
  hook_dst="$hooks_dir/prepare-commit-msg"
  if [ -f "$hook_dst" ] && ! grep -qF '# MyAnyAgent prepare-commit-msg hook' "$hook_dst" 2>/dev/null; then
    printf 'Attribution hook: NOT installed (foreign prepare-commit-msg exists at %s)\n' "$hook_dst"
  else
    cp "$hook_src" "$hook_dst"
    chmod +x "$hook_dst"
    printf 'Attribution hook: installed (prepare-commit-msg auto-appends Co-authored-by).\n'
  fi
fi

# Smoke test
credential_result=$(
  printf 'protocol=https\nhost=github.com\npath=%s.git\n\n' "$repository" |
    GIT_TERMINAL_PROMPT=0 git credential fill |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=Object.fromEntries(s.trim().split(/\n/).map(x=>x.split(/=(.*)/s,2)));if(f.username!=="x-access-token"||!f.password)process.exit(1);process.stdout.write(f.username+"|"+f.password.length)})'
) || fail 'GitHub App credential smoke test failed (token mint error)'

case "$credential_result" in
  x-access-token\|[1-9]*) ;;
  *) fail "credential smoke test returned an unexpected result" ;;
esac

printf 'MyAnyAgent Git identity and repository-local App authentication configured.\n'
if $contribution_mode; then
  printf 'Identity: contribution mode — commits will be authored as %s <%s>.\n' "$author_name" "$author_email"
  printf 'Note: .myanyagent.toml added to .git/info/exclude so it never enters a PR diff.\n'
  if [ -n "$id_coauthor" ]; then
    printf 'Tip: append this trailer to commits to disclose AI involvement:\n'
    printf '  Co-authored-by: %s\n' "$id_coauthor"
  fi
else
  printf 'Identity: %s <%s>.\n' "$author_name" "$author_email"
fi
printf 'Credential smoke test: username=x-access-token, token length=%s.\n' "${credential_result#*|}"
