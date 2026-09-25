## Context

The Worktrees panel (`src/components/git-panel/WorktreesPanel.tsx`) renders
`GitWorktreeStatus` rows produced by `GitService.worktrees()` on the server.
Extensions run in forked children of the server
(`packages/server-core/src/extensions/host.ts`) and today can contribute only
agent session sources, MCP install targets, and language servers. The
extension-platform spec makes sidebar rendering host-owned, so an extension
cannot draw on a worktree row.

Remote forge state (pull requests, commit statuses) is not in the repository and
cannot be observed with a filesystem watch. `tea` 0.16 has no watch command, and
its `actions runs list` reports an empty branch for pull-request runs, so it
cannot key runs to worktrees. The Gitea REST API gives what is needed directly:
`GET /repos/{o}/{r}/pulls?state=open` (head branch → worktree) and
`GET /repos/{o}/{r}/commits/{ref}/status` (combined state plus per-context
statuses with `target_url`).

In-force ADRs that constrain this design: ADR-0011 (trust boundaries), ADR-0017
and ADR-0018 (server owns execution; one workspace bundle), ADR-0019 (providers
are server-hosted extensions), ADR-0021 and ADR-0028 (count spawns; never poll without the owner's approval
poll), ADR-0026 (extension packaging), ADR-0003 (vault).

## Goals / Non-Goals

**Goals:**

- A provider-neutral worktree property model that Terminay owns and renders, so
  a future GitHub or GitLab extension renders identically.
- A bundled Gitea extension that shows each worktree's pull request and CI state
  with no process spawns and bounded HTTPS traffic.
- A sign-in path for users without `tea`, with an honest "don't ask again".

**Non-Goals:**

- Creating, merging, or commenting on pull requests; re-running or cancelling
  runs; streaming logs.
- Webhook or push delivery from Gitea (would need inbound reachability).
- OAuth app registration per Gitea instance.
- Arbitrary extension-defined fields or UI on worktree rows.

## Decisions

### 1. Typed host-owned properties, not extension UI

Extensions publish a closed, versioned DTO (`pullRequest`, `checks`) and
Terminay maps it to chips and a popover. Alternative: a generic "badge" list
(label, tone, icon, link). Rejected because it lets each provider invent its own
vocabulary, which breaks the consistent UI the user asked for and pushes
presentation choices into extensions. New property kinds are added to the model
by Terminay when a second provider needs them.

Boundary: renderer/extension boundary (extension-platform "Host-owned
behaviours"). The DTO carries text and credential-free HTTPS URLs only; strings
render as text; links open through the existing guarded external-link path.

### 2. Host-issued repository context, mirroring terminal context

The host pushes each insight source a `RepositoryContext` per open project
(root, remotes, worktrees with opaque ids, branch, upstream, head) and re-issues
it from the `GitService` status-change stream the panel already uses. Properties
are accepted only for issued, uncancelled worktree ids. Alternative: let the
extension discover repositories itself. Rejected: it cannot know which projects
are open, would re-read Git state the server already has, and would let it
publish for paths outside any project.

Boundary: project/window boundary. Properties are stored per
`(projectId, worktreeId, extensionId)` and delivered only on that project's
subscription, so remote clients of other projects never see them.

API sketch (`@terminay/extension-api`, minor bump):

```ts
context.worktrees.registerInsightSource(id, {
  onContext(ctx: RepositoryContext, signal: CancellationSignal): void,
  // ctx.publish(worktreeId, props | null)
  // ctx.requestSignIn({ origin, provider, tokenPageUrl? })
  // ctx.credentials.withToken(origin, use) / .reject(origin)
  // ctx.onCredentialAvailable(origin, cb)
});
```

### 3. Events first; one owner-approved poll for Gitea

ADR-0028 forbids polling unless the repository owner approves the specific
poll. Remote forge state has no event source Terminay can use: the only push
channel is a Gitea webhook, which needs the server to be reachable from Gitea.

**Approved poll (ADR-0028):** the Gitea extension's per-repository refresh,
every **10 s** for a project a client has active and every **45 s** for any
other open project, plus an immediate refresh when a project becomes active,
while that repository's context is live. Why no event source
works: forge state is remote, and webhooks need inbound reachability that a
desktop server does not have. Approved by the repository owner, Mark Wylde,
on **2026-09-24**, in the planning conversation for this change ("let's just
poll then once a minute… I am happy to use `fetch` once a minute"), and revised
by the owner on **2026-09-25** to "active project: every 10 seconds, inactive
project: every 45 seconds (plus on focus)". "Active" is the server's canonical
`activeProjectId` of any workspace view; a change of it re-issues the context
with `active` set. The timer
site in `extensions/gitea/src/refresh.ts` cites ADR-0028 and this change.

Around that poll:

- Change-driven first: a context re-issue (push, branch switch, new worktree)
  triggers an immediate refresh behind the shared minimum-interval schedule.
- Otherwise one refresh per repository every 10 s (active) or 45 s. Cost per refresh is
  `1 + N` HTTPS requests (N = worktrees with an upstream), not per terminal.
- Nothing scheduled for cancelled contexts; nothing while the extension is
  disabled or the sign-in is outstanding.
- After consecutive failures, back off 60 s → 2 m → 5 m → 10 m; a success
  resets.
- Zero spawns (ADR-0021): `fetch` only.

Alternative: faster polling only while a run is pending. Not taken — activity is
a better signal of what the user is watching, and the owner chose 10 s / 45 s.

### 4. Detection by probe, not by URL guess

Derive `https://<host>` from `origin` (HTTPS, `ssh://user@host:port/…`, or
`user@host:path`; drop user and SSH port) and call `/api/v1/version`
unauthenticated. Cache the verdict per origin for the server's lifetime.
Alternative: match known hostnames or `.gitea/` in the repo. Rejected: brittle,
and `.gitea/` exists in mirrors. A Forgejo server answers the same endpoint and
is compatible, which is acceptable.

### 5. Credentials: tea config file, then vault; never `tea`

Read `$XDG_CONFIG_HOME/tea/config.yml`, falling back to the platform default
(`~/Library/Application Support/tea/config.yml` on macOS,
`~/.config/tea/config.yml` elsewhere); pick the login whose `url` origin matches.
Keep the token in memory; re-read the file only when it changes (watched, per
ADR-0028) or after a 401. Otherwise use the vault binding for
`(extensionId, origin)`, reusing the existing `ProviderVaultBroker` binding
mechanism keyed by origin. Alternative: shell out to `tea login` or `tea api`
each poll — rejected by the user and by ADR-0021.

Boundary: secrets. The tea token is read by trusted extension code on the
server account (extensions are trusted Node programs), never leaves the child,
and is never placed in DTOs, logs, or errors. Sign-in tokens live only in the
server vault.

### 6. Sign-in prompt is host UI driven by an extension request

The extension calls `requestSignIn({origin, provider: "Gitea",
tokenPageUrl})`. The host de-duplicates per origin, checks suppression state,
and shows the modal to clients of projects on that origin. Choices:

```
 +------------------------------------------------------------+
 | Gitea detected                                             |
 | This project is on a Gitea server (git.example.net) that   |
 | Terminay can show pull request and CI status for. We need  |
 | to authenticate you.                                       |
 |                                                            |
 | [ Don't ask me about Gitea again ] [ No, maybe later ] [Yes]|
 +------------------------------------------------------------+
        Yes --> token field (secret) + "Create a token" link
```

- **No, maybe later**: in-memory suppression for that origin; cleared on server
  start.
- **Don't ask me about Gitea again**: persisted per extension in server-scoped
  settings; re-enabled from Settings → Extensions → Gitea.

Token validation: the host stores the token and notifies the extension, which
refreshes at once. A token the origin refuses is reported rejected, which removes
it and lets the prompt appear again.

### 7. Mapping and matching

- Pull request ↔ worktree: `pr.head.ref == worktree.upstream branch` and
  `pr.head.repo` equals the repository (forks ignored). Draft when Gitea reports
  WIP (`draft` field or a `WIP:`/`[WIP]` title prefix).
- Checks: commit status for the PR head SHA, else the upstream branch ref.
  `success`→passed; `failure`,`error`→failed; `pending`→pending;
  `skipped`,`warning`→skipped. Items truncated to 100; counts reflect all.
- Checks URL: the PR's `/checks`-equivalent is not stable across Gitea
  versions, so the chip opens the host popover and items link to each
  `target_url`.

### 8. Rendering

Row layout gains a compact third line only when properties exist:

```
 terminay-about
 +420 -3  No changes
 [#285]  [x 2  v 12  o 2]
```

Tones map to the panel's existing addition/deletion/warning colours. The checks
popover reuses the context menu surface. No layout change for rows without
properties.

Listings carry the pull request and check counts only; the popover fetches every
check item with `git.worktree.properties`, so a busy repository cannot push a
listing past the protocol's 64 KiB header limit. A property change raises a
`git.status.changed` event for that worktree, and clients re-list as they do for
any Git change.

Gitea Actions reports a status's `target_url` as a server path; the extension
resolves it against the origin before the HTTPS check.

## Risks / Trade-offs

- [Up to 10 s (active) or 45 s (inactive) staleness after CI finishes] → acceptable per request; a push re-issues
  the context immediately, which covers the moment the user cares most about.
- [Many repositories × many worktrees on one Gitea] → 1+N requests per repo per
  minute; back-off on failures; requests serialized per origin with a small
  concurrency limit.
- [tea config format changes] → parse defensively; failure falls through to
  sign-in rather than breaking.
- [Self-signed Gitea TLS] → `fetch` fails; treated as "not Gitea". Documented;
  no TLS bypass.
- [Token scope too broad] → token page link and prompt text recommend
  `read:repository` only.
- [Extension retains tokens] → same trust model as other trusted extensions; the
  install warning already states it.

## Migration Plan

Additive. The extension API gains a minor version; existing extensions are
unaffected. The Gitea extension is bundled and enabled by default; it does
nothing for non-Gitea repositories. Rollback: disable the extension; rows return
to their current appearance.

## Open Questions

- Should forks' pull requests (head in another repository) be matched when the
  worktree's upstream points at the fork? Proposed: yes if the upstream remote's
  repository equals `pr.head.repo`; otherwise ignored.
- The tea config file is watched, not polled. The poll above is the only
  timer that reads external state.
