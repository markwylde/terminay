# ADR-0106: Forge pull requests and issues come from pull-based, on-demand forge sources; Terminay renders and joins them

Status: accepted
Date: 2026-11-11

## Context

Users want Terminay to list the pull requests and issues of every forge
account they have, on Home and in each project, and to go from an item to a
worktree and an agent. The knowledge is forge-specific and belongs in
extensions, as worktree properties do (ADR-0029). But worktree insights are
push-based and scoped to host-issued worktrees. An account-wide list is
unbounded on large organisations, has to be searchable and paged, and is only
worth fetching while someone looks at it. ADR-0028 forbids polling without the
owner's approval for that specific poll.

## Decision

1. **A separate `forgeSources` contribution, answered on request.** Terminay
   asks a source for its accounts, whether it claims a remote, one page of item
   summaries for a typed query, and one item's detail. A source keeps no list
   state and may only hint that an origin's results changed.
2. **A closed, Terminay-owned model.** Items are typed facts: reference,
   title, credential-free HTTPS URL on the item's origin, state, author,
   labels, counts, times, branch facts, and checks in the worktree property
   shape. Sources send no presentation. Terminay validates every value and
   drops what fails.
3. **Terminay owns joins and actions.** Matching items to open projects and
   worktrees, and every action that touches Git or terminals, is host code. A
   source never learns about projects, worktrees, terminals, or clients.
4. **Freshness is on demand.** Results are fetched when shown, when the query
   changes, on Refresh, on focus, on a repository context re-issue, and on a
   source's hint. They are cached in memory for at most 60 seconds. No timer
   refreshes them. A periodic refresh would be a poll and needs owner approval
   under ADR-0028.
5. **Authority narrows queries.** A client bound to one project can only query
   that project's claimed repositories and never sees account-wide lists or
   accounts. Settings and accounts need admin scope. Settings are server-scoped
   and stored by Terminay, which applies them by narrowing queries.
6. **Credentials as for worktree insights.** Each extension uses the tokens it
   already obtains under ADR-0063 and the vault binding per extension and
   origin. All forge traffic is HTTPS through `fetch`.

## Consequences

- A GitLab or other forge extension gets Home and project lists by
  implementing four calls, with no UI work.
- Forge rate limits are spent only when someone is looking.
- Lists can be up to 60 seconds stale between explicit refreshes, and longer
  while nobody interacts. The UI says when each list was fetched.
- Writing to a forge (comments, reviews, merges) needs a further contribution
  and permission, recorded in its own ADR.
