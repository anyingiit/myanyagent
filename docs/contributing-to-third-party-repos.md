# Contributing to third-party public repos — capability research & failure record

> Status: **researched, empirically verified, and concluded — do not re-litigate.**
> Date: 2026-08-12. Target tested: `debpalash/VoiceStudio` (user-owned public repo, App not installed there).

## Goal

Enable the machine's GitHub App bot identity (`MyAnyAgent[bot]`, App installed on
`@anyingiit`, `repository_selection: all`) to act on **third-party public repos**
where the App cannot be installed: file issues, open fork-PRs, comment, reply to
review threads — without a human.

## Empirically verified capability matrix (2026-08-12)

Tested against `debpalash/VoiceStudio` (public, user-owned, App NOT installed):

| Operation | IAT (bot, `ghs_`) | GitHub-App UAT (user, `ghu_`) | Browser (user session) |
|---|---|---|---|
| Create an issue | ✅ 201 (`myanyagent[bot]`) | ❌ 403 | ✅ |
| Comment on issue/PR | ❌ 403 | ❌ 403 | ✅ |
| Close an issue | ❌ 403 | ❌ 403 | ✅ |
| Create PR (fork→base) | ❌ 403 | ❌ 403 | ✅ (compare link) |
| Reply to review thread | ❌ 403 | ❌ 403 | ✅ |

UAT = user access token obtained via GitHub App **device flow** (OAuth
authorization as `@anyingiit`; refresh token rotation working). The UAT was
implemented, verified as `ghu_` with correct identity, then **reverted** —
it does not help.

## Root cause

GitHub's permission model for a GitHub App is installation-scoped:

1. **"Any authenticated user" affordance on public repos applies ONLY to issue
   creation.** The IAT can create issues without installation; everything else
   (comments, close, PR, review replies) requires write access on the base repo,
   which an uninstalled App does not have.
2. **User access tokens are the intersection of user and App access**
   (official docs). Since the App's access is bounded by its installations, the
   UAT is *more* restricted on third-party repos than the IAT, not less. It does
   **not** inherit the issue-creation affordance either (verified 403).
3. **PR creation additionally requires** (official docs): "you must have write
   access to the head or the source branch"; org-owned base repos require org
   membership — regardless of token type.
4. `maintainer_can_modify: false` does not fix this (community-verified, #39178).

## Official documentation anchors

- Fine-grained PAT gap: *"Only personal access tokens (classic) have write access
  for public repositories that are not owned by you or an organization that you
  are not a member of."* — docs.github.com, Managing your personal access tokens.
- PR API: *"To open or update a pull request in a public repository, you must have
  write access to the head or the source branch. For organization-owned
  repositories, you must be a member of the organization."* — REST Pulls.
- UAT scope: *"a user access token can only access resources that both the user
  and app can access."* — GitHub App user access tokens.
- GitHub's preference order: **GitHub App > fine-grained PAT > classic PAT /
  OAuth App** (official docs, "Differences between GitHub Apps and OAuth apps").

## Do NOT try again

| Path | Why it fails |
|---|---|
| GitHub-App UAT (device flow) for cross-repo writes | Empirically 403 on every write except nothing. Reverted. |
| Fine-grained PAT for arbitrary public repos | Official documented gap — no write on third-party public repos. |
| `maintainer_can_modify=false` / extra App permissions | Community-verified ineffective (#39178, SO). |
| GraphQL instead of REST | Same 403 (`Resource not accessible by integration`). |
| Installing the App on the target repo | Requires the maintainer's consent — out of our control. |

## Viable options (for future automation decisions)

| Option | Public-repo scope | Private-repo isolation | Granularity | Fits "no PAT" design? |
|---|---|---|---|---|
| **Browser (human)** + IAT for issue creation | all | n/a | n/a | ✅ current model |
| **Classic PAT `public_repo`** | all public repos | ✅ (no private) | ❌ no per-repo/per-endpoint limits | ❌ long-lived user credential |
| **OAuth App `public_repo` scope** | all public repos | ✅ | ❌ same coarse scope model | ~ (revocable, still a long-lived user token) |
| Maintainer installs the App | target repo only | ✅ | ✅ | ✅ but requires consent |

Both classic-PAT and OAuth-App routes expose the **whole `public_repo` capability
set** (code read/write on every public repo, collaborators, deployment statuses,
etc.) — no finer "PR/comment only" scoping exists. They also act as the human
account (`@anyingiit`).

## Conclusion / operating model

- **File issues**: bot via IAT (works without installation).
- **PR / comments / review replies on third-party repos**: human via browser
  (compare link). This is the supported, minimal-credential model.
- If full automation is ever required, build a **separate** `public_repo`-scoped
  adapter (classic PAT or OAuth App, 0600 storage, endpoint allowlist, short
  expiry, dedicated identity) — do **not** extend the IAT credential helper.
- **Leftover state**: probe issue `debpalash/VoiceStudio#1511` (created by the
  IAT during capability testing) could not be closed by any token — close it
  manually in the browser. Device Flow remains enabled on the App settings
  (harmless; no tokens stored) and the OAuth authorization record can be revoked
  at github.com/settings/applications.
