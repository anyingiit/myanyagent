#!/bin/sh
set -eu

tool_dir="$HOME/.local/share/myanyagent"
bin_dir="$tool_dir/bin"
config_file="$HOME/.config/myanyagent/config.toml"
local_bin="$HOME/.local/bin"

# Determine command path for -> run: hints: bare name if ~/.local/bin on PATH, else absolute
on_path() {
  case ":$PATH:" in
    *:"$local_bin":*) return 0 ;;
    *) return 1 ;;
  esac
}

hint_cmd() {
  if on_path; then
    printf '%s' "$1"
  else
    printf '%s/%s' "$bin_dir" "$1"
  fi
}

# Check we are in a git repo with .myanyagent.toml
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || true
toml="${repo_root:-.}/.myanyagent.toml"

if [ -f "$toml" ]; then
  repository=$(sed -n 's/^[[:space:]]*repository[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' "$toml" | head -1)
  installation_id=$(sed -n 's/^[[:space:]]*installation_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' "$toml" | head -1)
  printf 'repo: %s   (from .myanyagent.toml)\n' "$repository"
else
  printf 'repo: (no .myanyagent.toml found)\n'
  printf '%s\n' "-> run: $(hint_cmd myanyagent-bootstrap)   (create .myanyagent.toml with repository, installation_id, [bot])"
  exit 0
fi

# Tool installed?
if [ -d "$tool_dir" ] && [ -f "$bin_dir/myanyagent-credential-helper.cjs" ]; then
  version=$(cat "$tool_dir/VERSION" 2>/dev/null || echo "?")
  printf 'tool: installed v%s at %s\n' "$version" "$tool_dir"
else
  printf 'tool: NOT installed\n'
  printf 'install the tool first, then run myanyagent-bootstrap\n'
  printf '%s\n' "-> run: sh install.sh"
  exit 0
fi

# Machine config?
client_id=""
if [ -f "$config_file" ]; then
  client_id=$(sed -n 's/^[[:space:]]*client_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' "$config_file" | head -1)
  printf 'client_id: %s   (from %s)\n' "${client_id:-?}" "$config_file"
else
  printf 'client_id: NOT configured   (missing %s)\n' "$config_file"
fi

# Private key?
key_file=""
if [ -n "${MYANYAGENT_PRIVATE_KEY:-}" ]; then
  key_file="$MYANYAGENT_PRIVATE_KEY"
elif [ -f "$config_file" ]; then
  key_file=$(sed -n 's/^[[:space:]]*private_key[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' "$config_file" | head -1)
  case "$key_file" in '~'*) key_file="$HOME${key_file#"~"}" ;; esac
fi
if [ -n "$key_file" ] && [ -r "$key_file" ]; then
  printf 'private key: OK   %s\n' "$key_file"
else
  printf 'private key: MISSING   %s\n' "${key_file:-not configured}"
fi

# Git config bootstrapped?
configured=false
if [ -n "$repo_root" ]; then
  cfg_repo=$(git config --local --get myanyagent.repository 2>/dev/null || true)
  cfg_helper=$(git config --local --get credential.helper 2>/dev/null || true)
  if [ -n "$cfg_repo" ] && echo "$cfg_helper" | grep -q "myanyagent-credential-helper" 2>/dev/null; then
    configured=true
  fi
fi

needs_action=false

# Contribution identity: [identity] in .myanyagent.toml means this worktree feeds
# PRs to an upstream repo — commits must be authored by the human, not the bot.
identity_email=$(sed -n '/^\[identity\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*email[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
if [ -n "$identity_email" ] && [ -n "$repo_root" ]; then
  cfg_email=$(git config --local --get user.email 2>/dev/null || true)
  if [ "$cfg_email" = "$identity_email" ]; then
    printf 'identity: contribution (%s)\n' "$cfg_email"
  else
    printf 'identity: MISMATCH (want %s, configured %s)\n' "$identity_email" "${cfg_email:-unset}"
    needs_action=true
  fi
fi

# Attribution state (read-only): hook presence, resolved trailer, unpushed gaps.
attr_coauthor=$(sed -n '/^\[identity\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*co_author[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
bot_name=$(sed -n '/^\[bot\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
bot_email=$(sed -n '/^\[bot\]/,/^\[/p' "$toml" | sed -n 's/^[[:space:]]*email[[:space:]]*=[[:space:]]*"\([^"]*\)".*$/\1/p' | head -1)
attr_trailer=""
if [ -n "${MYANYAGENT_ATTRIBUTION:-}" ]; then
  attr_trailer="$MYANYAGENT_ATTRIBUTION"
elif [ -n "$attr_coauthor" ]; then
  attr_trailer="$attr_coauthor"
elif [ -n "$bot_name" ] && [ -n "$bot_email" ]; then
  attr_trailer="$bot_name <$bot_email>"
fi
if [ -n "$attr_trailer" ]; then
  printf 'attribution trailer: %s\n' "$attr_trailer"
else
  printf 'attribution trailer: (none configured)\n'
fi

hook_found=false
hooks_path=$(git config --local --get core.hooksPath 2>/dev/null || true)
[ -n "$hooks_path" ] || hooks_path=$(git config --global --get core.hooksPath 2>/dev/null || true)
if [ -n "$hooks_path" ] && [ -n "$repo_root" ]; then
  case "$hooks_path" in /*) hooks_dir="$hooks_path" ;; *) hooks_dir="$repo_root/$hooks_path" ;; esac
else
  hooks_dir=""
fi
if [ -n "$hooks_dir" ] && [ -x "$hooks_dir/prepare-commit-msg" ] \
   && grep -qF '# MyAnyAgent prepare-commit-msg hook' "$hooks_dir/prepare-commit-msg" 2>/dev/null; then
  hook_found=true
fi
if $hook_found; then
  printf 'attribution hook: installed\n'
else
  printf 'attribution hook: NOT installed\n'
  needs_action=true
fi

# Unpushed commits missing the trailer (only meaningful when trailer + upstream exist)
if [ -n "$attr_trailer" ] && [ -n "$repo_root" ]; then
  upstream=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    missing=$(git log --format=%B "@{upstream}..HEAD" 2>/dev/null |
      grep -ciF "co-authored-by:" || true)
    total=$(git rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo 0)
    if [ "${total:-0}" -gt 0 ] && [ "$missing" -lt "$total" ]; then
      printf 'unpushed commits without trailer: %s of %s\n' "$((total - missing))" "$total"
      needs_action=true
    fi
  fi
fi

if $configured; then
  printf 'git config: configured\n'
else
  printf 'git config: NOT configured\n'
  needs_action=true
fi

# Private key or client_id missing also need action
if [ -z "$client_id" ] || [ -z "$key_file" ] || [ ! -r "$key_file" ]; then
  needs_action=true
fi

if $needs_action; then
  printf '%s\n' "-> run: $(hint_cmd myanyagent-bootstrap)"
else
  printf 'OK\n'
fi