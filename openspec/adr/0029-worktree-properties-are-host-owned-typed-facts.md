# ADR-0029: Extensions publish typed worktree facts; Terminay renders them

Status: accepted
Date: 2026-09-24

## Context

Users want to see each worktree's pull request and CI state on its Worktrees
panel row. That knowledge is forge-specific (Gitea now, GitHub or GitLab later)
and belongs in extensions. The extension platform, though, makes sidebar
rendering host-owned: an extension has no way to draw on a row, and letting it
contribute free-form badges would hand presentation to each provider and break a
consistent UI.

Forge state lives on a remote server. No filesystem watch observes it, and the
only push channel, a forge webhook, needs the Terminay Server to be reachable
from the forge. ADR-0028 makes any poll a last resort that only the repository
owner can approve, so how this state stays fresh has to be decided explicitly.

## Decision

1. **Worktree properties are a closed, Terminay-owned model.** Extensions
   publish typed facts: a pull request (number, title, URL, state, mergeability)
   and a checks summary (counts plus bounded items with links). Terminay alone
   decides how they look and what activating them does. A provider that needs a
   new kind of fact gets it by extending the model in Terminay, not by sending
   presentation.
2. **Publication is scoped by a host-issued repository context.** Terminay issues
   each insight source a context per open project, and accepts properties only
   for worktree ids in a context it issued and has not cancelled. Properties
   travel only on that project's subscription. Cancelling the context is what
   stops a source's work for that project (ADR-0028 decision 6).
3. **Credentials for forge origins are host-prompted and vault-bound per
   `(extension, origin)`.** An extension asks for sign-in; Terminay owns the
   prompt, its suppression choices, and storage.
4. **Forge state is refreshed by events first, and by a poll only with the
   owner's approval under ADR-0028.** A context issue or re-issue (a push, a
   branch switch, a new worktree) triggers an immediate refresh. The Gitea
   extension's 60 s per-repository refresh is a poll: the repository owner
   approved it on 2026-09-24 in change `gitea-worktree-status`, whose
   `design.md` records it. Any other extension's forge poll needs its own
   approval. Failure back-off is a bounded retry, not a poll.

## Consequences

- A GitHub or GitLab extension renders identically to Gitea with no UI work.
- Adding a property kind is a Terminay change plus an extension API minor bump.
- Forge webhooks remain a possible later improvement for servers reachable from
  their forge; adopting them would retire the approved poll.
