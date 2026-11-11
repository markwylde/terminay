## Context

`terminay-gitea` and `terminay-github` contribute worktree insight sources
(ADR-0029). The host issues them a repository context per open project, they
push typed facts for that project's worktrees, and Terminay renders the facts.
Credentials come from `tea`'s configuration, `gh` (at most one spawn per token
lifetime, ADR-0063), the environment, or the sign-in prompt, and are held per
`(extension, origin)` in the server vault.

That model cannot answer what Home needs: "which pull requests request my
review, across everything I can reach?". There is no project and no worktree,
the answer is a searchable, paged list, and it is only worth fetching while
someone is looking at it.

The design was settled in an exploration with the repository owner on
2026-11-11, using five mockups: Home Pull Requests, Home Issues, the project
left-column tabs, Settings › Extensions for Gitea and GitHub, and the extension
API. The owner approved them that day.

Relevant in-force ADRs: 0021 (count spawns), 0028 (no polling without owner
approval), 0029 (host-owned typed worktree facts), 0050 (server-resolved folder
roots), 0057 (session recordings), 0063 (forge CLI only for a token, once),
0081 (launcher typing rules, superseded here by ADR-0104).

## Goals / Non-Goals

**Goals:**

- Home Pull Requests and Issues sections across every forge account, with the
  scopes, grouping, detail, and actions shown in the mockups.
- Project left-column Pull Requests and Issues tabs for claimed repositories.
- A pull-based `forgeSources` extension contribution, implemented by both
  built-in forge extensions, with Terminay owning presentation, joins, and
  caching.
- Automatic account discovery, with Settings to narrow scope, add accounts,
  and switch features off.
- Start work and Review with agent: worktree creation plus an agent started
  with a user-confirmed prompt.

**Non-Goals:**

- Writing to the forge: comments, reviews, merges, closing, assigning, labels.
  That needs a separate action contribution and permission.
- Cloning a repository that is not open as a project. Start work and checkout
  are disabled there with a reason. (The issue mockup's "clone first" note is
  deferred.)
- Checking out pull requests from forks.
- Periodic background refresh of lists or badges (see Decision 5).
- GitLab or other forges. The contribution is provider-neutral, so they can be
  added later as extensions.
- Rendering Markdown. Bodies show as plain text with links in v1.

## Decisions

### 1. A new pull-based contribution, not an extension of worktree insights

`contributes.forgeSources` sits beside `worktreeInsights` with its own runtime:
`accounts`, `claim`, `query`, `detail`. Terminay calls these as host→child
request frames (`forge.source.accounts`, `.claim`, `.query`, `.detail`) and the
child answers with a result payload, the same request/result pattern as
language sessions. A source can send `forge.source.invalidate` with an origin.

*Alternatives:* pushing whole lists, as worktree insights do. That fails for
"everything I can access" on large organisations (the list is unbounded), for
search and paging (the source cannot guess what to pre-fetch), and for rate
limits (it fetches when nobody looks). Rejected, as the explored comparison
showed.

*Boundary:* extension host ↔ Server Core. Every value is validated by the host
before use, as worktree properties are (ADR-0029). Extensions never see
projects, terminals, worktrees, or clients.

### 2. Terminay owns the joins and all presentation

The host matches a pull request's head branch to worktrees of open projects. It
does this by asking each source to `claim` each open project's remotes and
comparing the full identity, origin plus `owner/repo` (owner and name without
case), with the Git service's worktree listing. A worktree matches only when
the pull request's head repository is the repository itself and the worktree's
branch has the head branch's name or tracks `<claimed remote>/<head branch>`,
so a fork's `main` never matches a local `main`. Several matching worktrees
show as one chip with "+N" and a chooser; a repository open as two projects
asks which project a new worktree goes in. The
"This worktree" group, the worktree chip, Open worktree, Check out, Start work,
and Review with agent are host features. The model is closed and typed, like
ADR-0029's: a source cannot send markup or presentation.

*Boundary:* the project/window boundary. The join runs server-side, and its
results reach a client only for projects it is authorized for.

### 3. One forge service in Server Core

`packages/server-core/src/forge/` holds a `ForgeService` that:

- keeps the registered sources and their declared kinds;
- answers `forge.accounts`, `forge.query`, `forge.detail`, `forge.claims`
  protocol operations;
- applies settings (repository scope, chosen owners, feature switches) by
  narrowing queries before they reach sources;
- fans out queries in parallel, once per account (one account per source and
  origin in v1), with a timeout of 15 s per source call;
- validates every answer against its question: items on the queried origin,
  kind, and narrowed repositories or owners; a detail for the requested
  reference; a claim on the remote's host; at most one account per origin;
- merges pages with a watermark: an item is returned only when no account that
  still has pages could return a newer one, and held-back items lead the next
  page. The client continuation is a service-issued opaque token (an in-memory
  handle holding each account's cursor and held-back items, expiring with the
  cache); source cursors never reach clients. Pages may be short;
- caches each `(account, normalized query)` page for at most 60 s in memory,
  and drops entries on invalidation, extension stop, account change, or
  settings change. Each source has a generation number that those events bump;
  a result from an older generation is discarded, so a disabled extension's
  in-flight answer never lands;
- computes the Home badge counts from a `reviewRequested`/`assigned` open query
  with page size 1, using the forge's total count.

Forge settings are server-scoped settings stored by Terminay under the
extension id, read and written through the existing settings store with admin
scope.

*Boundary:* the server owns the data (architecture rule). Nothing reaches disk
except settings and vault tokens.

### 4. Authority follows the existing Git authorization shape

Forge operations take the same authorization as Git operations: server id,
scope, and optional project binding. Read scope reads; admin scope changes
settings and accounts. A project-bound client's queries are rewritten to that
project's claimed repositories, its detail requests are checked against the
same set before the cache is consulted, and Home sections are hidden from it.
Its project-tab rows open the item detail as a project tab instead of Home.
Worktree creation requires write scope and the project.

Restrictions fail closed. "Absent" means unrestricted; an empty set after
narrowing means "send nothing". Project binding, the Repositories setting, and
the client's own filter are intersected. Chosen owners with none switched on
sends nothing. The owner catalogue comes from each account's `owners` (login
plus organisations), reported by `accounts`.

Forge operations are advertised in the server's protocol capabilities, so an
older server simply shows no forge UI.

*Boundary:* remote access and project scoping. Without this, a remote device
paired for one project could list every private repository the server owner
can reach.

### 5. Refresh on demand, never on a timer (ADR-0028)

Lists and badges refresh when shown, when their query changes, on Refresh, on
window or tab focus after 60 s, when a repository context is re-issued for a
repository in the query, and on a source's invalidation hint. A list shows
"Updated N min ago". There is no interval and no refresh setting.

*Alternatives:* the explored Settings mockup showed "Check for changes every 5
minutes". That is a poll, and ADR-0028 allows a poll only with an explicit
owner approval recorded for that specific poll. On-demand freshness meets the
need without one, so the setting was removed. A later change can propose a
visible-list refresh interval for owner approval if on-demand proves stale in
use.

### 6. Accounts from CLI configuration, tokens per ADR-0063, HTTPS for everything

Gitea enumerates `tea`'s `logins:` (URL and token, read from the file it
already watches). GitHub enumerates `hosts.yml` hosts and the environment
token, and obtains keychain tokens with `gh auth token` under ADR-0063. Both
add vault-bound sign-in origins. All queries use `fetch`. GitHub uses one
GraphQL `search` per account and query, with qualifiers built from fixed
strings and user text passed as a quoted term, so text cannot widen scope.
Gitea uses `/repos/issues/search`. Its `involved` scope merges four filtered
requests, because Gitea has no single "involves" filter; its cursor records
each request's page so the next page continues all four. Gitea's `merged`
filters closed pull requests, so pages can be short.

v1 has one effective account per `(source, origin)`, matching how tokens are
already bound per `(extension, origin)` in the vault. When an origin has
several credentials (two `tea` logins, a sign-in plus a CLI login), the source
uses the one its worktree insight source would use and reports one account.
Multiple accounts per origin need a vault keyed by account and are deferred.

URLs: an item's canonical URL must be HTTPS on its own origin. Check target
URLs may be any credential-free HTTPS origin, because CI often runs elsewhere.
Body links are plain text opened through the guarded external-link path.

### 7. GitHub "All" is the account's own login plus its organisations

GitHub search needs a qualifier, and "everything I can read" is not one. `all`
with no narrowing becomes `user:<login> org:<each org>`. The org list comes
from `viewer.organizations` and is cached with the account. Repositories that
belong to other owners and that the user only collaborates on are reached
through Involved, or through Repos of open projects.

To keep this honest, a forge source declares its `all` reach in the manifest:
`readable` (Gitea) or `owners` (GitHub). Where it is `owners`, the All chip and
the Settings Repositories section say that All covers the account's own and
its organisations' repositories. "Everything I can access" stays the label of
the Repositories setting, which is about narrowing, not about All.

### 8. Worktree creation is a server-owned Git operation

`git.worktree.create` (with `plan` mode) validates the branch with
`git check-ref-format --branch`, chooses the path itself as a sibling of the
repository root, fetches, and runs `git worktree add` with fixed arguments
(`-b <branch> <path> <remote>/<base>`, `--track -b <branch> <path>
<remote>/<branch>`, or `<path> <branch>` to reuse an existing local branch the
client explicitly asked to reuse). The client never supplies a path
(ADR-0050). The existing Git watch and folder reconciler pick the new worktree
up. Errors are typed (`invalidBranch`, `branchExists`, `checkedOut` with the
path, `fetchFailed`, `remoteMissing`, `addFailed`) and shown.

- *Remote:* the project remote claimed for the forge repository; with several,
  `origin` first, then the current branch's upstream remote. The base is the
  remote's default branch (`refs/remotes/<remote>/HEAD` after fetch, or
  `git ls-remote --symref` when that ref is absent).
- *Concurrency:* creations for one repository run through a per-repository
  queue, and each re-checks branch and path inside the queue, so plan-then-
  create races and double clicks fail cleanly with `checkedOut`.
- *Recovery:* the server removes only what that operation created (the new
  branch, the new directory) when a later step fails. A retry after the
  terminal failed gets `checkedOut` with the path, and the client opens the
  terminal there instead of creating a second worktree.

*Boundary:* Git execution safety. No shell, bounded execution, and the server
resolves the project root.

### 9. Initial prompts for launchers (supersedes ADR-0081; see ADR-0104)

A launcher may declare `initialPrompt: "positional"`. Terminal creation then
accepts a prompt, which the server validates (not empty, at most 4,000
characters, no control characters other than newlines, not starting with `-`
after leading whitespace, newlines folded to spaces) and quotes for the
profile's shell as one argument after the executable path and any
command-default flags, through the existing `launcherCommandLine`. Prompts are
supported in POSIX shells, fish, and PowerShell. `cmd.exe` cannot stop `%VAR%`
expansion inside quotes, so a prompt there is rejected with a reason, as are
unrecognised shells. Rejecting a leading `-` avoids relying on `--`, which not
every agent CLI honours, so a prompt can never become a flag.

This changes the existing "Create protocol accepts only a profile id"
requirement (the prompt is text for one quoted argument, not an argument
string) and the launcher listing, which now says whether a launcher accepts a
prompt so the UI offers only those.

The prompt comes only from a user confirming Start work or Review with agent,
in an editable field. Terminay does not keep it in terminal metadata or
restore state, and never sends it on restore. Because it is typed on the
launch line, it is as visible as any typed command: in shell history, the
terminal's scrollback, session recordings (ADR-0057), and the agent's own
transcript. The built-in agents extension declares it for Claude Code and
Codex.

*Boundary:* terminal input and the agent-observation rule (ADR-0051). This is a
new owner-approved exception, approved on 2026-11-11 with the Start work and
Review with agent mockups.

### 10. UI composition

- Home sections: `src/workspace/forge/PullRequestsHome.tsx` and
  `IssuesHome.tsx`, sharing a list/detail shell and the Workflows toolbar
  styles. Device-local preferences (scope, state, group) are stored like
  other Home view preferences.
- Left-column tabs: `foldersColumnTabs.tsx` gains two tabs, fed by a
  per-project forge claim and a repository-scoped query.
- Navigation from a project row to Home uses the existing Home tab opening, with
  a section argument carrying `{ repository, item }`. For a project-bound
  client, which has no Home sections, the row opens a project tab holding the
  same detail pane and actions.
- Clients tag each request with a sequence number and ignore responses to a
  query they have since replaced.
- Settings: `ExtensionSettingsSection` renders Accounts, Repositories, and
  Pull requests and issues for an extension that contributes a forge source.
- The checks list and chips reuse the worktree property components.

## Risks / Trade-offs

- [Forge text is attacker-controlled: titles, bodies, labels] → Plain text
  only, no HTML. Bounded lengths. URLs restricted to the item's origin over
  HTTPS. Links open through the guarded external-link path.
- [Issue bodies become agent prompts (prompt injection)] → The prompt is
  composed by Terminay, quotes only the start of the body, and is shown
  editable. The user confirms it. Nothing is sent without that click.
- [Shell injection through the prompt] → Host-side quoting for the profile's
  shell, control characters rejected, and tests with metacharacters for every
  supported shell family.
- [Rate limits on big accounts] → Cache for 60 s, fetch on demand, page size
  at most 50, honour GitHub's reset time, badge counts with page size 1.
- [Gitea Involved costs four requests] → Accepted, and cached. The default
  scope for PRs is Needs my review (one request).
- [GitHub All misses collaborator-only repositories] → Documented in
  Decision 7. Involved and Repos of open projects cover them.
- [Stale lists without a timer] → "Updated N min ago", Refresh, and refresh on
  focus. Owner approval can add a poll later.
- [Extension API grows again] → Additive minor bump to 3.7.0. Older builds of
  the forge extensions run unchanged and simply contribute no forge source.

## Migration Plan

Additive. Ship the API, the host service, and the UI together with the
updated built-in extensions. With no forge source registered, Home and the left
column look exactly as before. Rollback is disabling the extensions or
reverting the change. No persisted data needs migrating: forge settings are new
keys with defaults.

## Open Questions

- Whether a visible list should also refresh on an interval. That would need
  owner approval under ADR-0028 and is deferred.
- Cloning a repository from Start work is deferred to a later change.
