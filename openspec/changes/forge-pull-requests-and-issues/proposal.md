## Why

A Terminay user who works across several repositories has no way to see, in
Terminay, the pull requests waiting for their review or the issues assigned to
them. They leave for a browser, find the item, then come back and set up a
worktree and an agent by hand. Terminay already knows each worktree's own pull
request and CI state through the Gitea and GitHub extensions, but only for the
branch a worktree is on, and only inside a project.

The extension platform has no way for an extension to answer "which pull
requests and issues does this account have?". Worktree insights push facts
for host-issued worktrees, and that model cannot express an account-wide,
searchable, paged list.

## What Changes

- Home gains two sections, **Pull Requests** and **Issues**, after Recordings.
  Each lists items from every account the forge extensions found. Rows are
  grouped by repository under a forge and `owner/repo` header. There are scope
  chips (pull requests: Needs my review, Mine, Involved, All; issues: Assigned
  to me, Created by me, Mentioned, All), a state control, a Group by Repo/None
  control, and a detail pane.
- The pull request detail shows branch, author, checks, whether the head branch
  is checked out in an open project's worktree, and actions: **Open worktree**,
  **Check out in new worktree**, **Review with agent**, and open on the forge.
- The issue detail ends in **Start work**. It creates a worktree on a branch
  named after the issue and opens a terminal there, either running a chosen
  agent with an editable prompt built from the issue or with only a shell.
- A project's left column gains **Pull Requests** and **Issues** icon tabs,
  shown only when a forge extension claims the project's remote. Each lists
  that repository's items, with the current worktree's pull request first.
  Activating a row opens the Home section with that item selected.
- A new extension contribution, `forgeSources`, with a `forge-source`
  permission. It is pull-based: Terminay asks a source for accounts, for
  whether it claims a remote, for a page of items matching a query, and for
  one item's detail. A source can hint that results changed. Terminay validates,
  caches, merges, and renders everything; v1 is read-only.
- `terminay-gitea` and `terminay-github` implement forge sources. They discover
  every account from `tea`'s `logins:` and `gh`'s `hosts.yml` (and `gh auth
  token` under ADR-0063), plus accounts added through sign-in. All forge calls
  go over HTTPS.
- Settings › Extensions › Gitea and GitHub gain **Accounts**, **Repositories**
  (Everything I can access, Repos of open projects, Chosen owners), and per-feature
  switches (Pull requests on Home, Issues on Home, Project tabs).
- The server gains a server-owned worktree creation operation, used by
  **Check out in new worktree** and **Start work**.
- Terminal launchers may declare that their program accepts an initial prompt
  as a positional argument; Terminay quotes and passes it. The built-in agents
  extension declares it for the agents that accept one.
- Lists refresh on demand (when shown, when their query changes, on explicit
  Refresh, and on a source's invalidation hint), never on a timer (ADR-0028).
- Extension API minor bump to 3.7.0 (additive).

## Capabilities

### New Capabilities

- `forge-sources`: the provider-neutral pull request and issue model, the
  `forgeSources` contribution and its runtime contract, the host forge service
  (fan-out, validation, caching, on-demand refresh, authority), accounts, and
  per-extension forge settings.
- `pull-requests-and-issues`: the Home Pull Requests and Issues sections, their
  list and detail presentation, the project left-column tabs, and the actions
  (open worktree, check out, review with agent, start work, open on forge).

### Modified Capabilities

- `extension-platform`: `forgeSources` joins the supported contribution kinds
  and arrays. Adds the `forge-source` permission. Terminal launchers may
  declare an initial-prompt argument.
- `workspace-dashboard`: the Home sidebar lists Pull Requests and Issues after
  Recordings, each shown only while an enabled forge source provides it.
- `project-sidebar-layout`: the left column tab bar gains Pull Requests and
  Issues tabs when a forge source claims the project's repository.
- `built-in-extensions`: the Gitea and GitHub extensions contribute forge
  sources, account discovery and query mapping. The built-in agents
  extension's launchers declare initial-prompt support.
- `git-worktrees-and-quick-push`: a server-owned operation creates a worktree
  for a new or remote branch.
- `shell-profiles-and-terminal-launch`: the create protocol accepts an initial
  prompt with a launcher id; the launcher list says which launchers accept
  one; a launched terminal may pass a host-quoted prompt after any
  command-default flags (POSIX shells, fish, PowerShell).

## Impact

- `packages/extension-api`: new forge types, contribution, registry, validation,
  limits, conformance fixtures; launcher `initialPrompt` field; version 3.7.0.
- `packages/server-core`: extension manifest validation, child/host frames for
  forge sources, a new forge service (cache, authority, settings), worktree
  creation in the Git service, launcher prompt quoting in terminal launch.
- `packages/protocol`, `packages/client-core`: forge query, detail, accounts,
  and settings operations; worktree create operation.
- `src/`: Home sections, project left-column tabs, Settings extension sections.
- `extensions/gitea`, `extensions/github`, `extensions/builtin-agents`: forge
  source implementations, account discovery, launcher prompt declarations.
- E2E: Home sections, left-column tabs, settings, with a fake forge source.
