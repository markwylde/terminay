# Canonical terminal launch resolution

## Goal

Make every PTY creation route resolve its shell profile, arguments, environment,
and working directory through one privileged server-owned launch component.

Governing features:

- [Shell profiles and terminal launch](../features/shell-profiles-and-terminal-launch.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)

Depends on [Task 24](./24-shell-profile-domain-and-discovery.md).

## Current gap

Embedded startup resolves an omitted cwd to the Desktop home directory, while
protocol-created terminals pass an omitted cwd into a PTY service that uses
`"."`. In a packaged app that process directory can be `/`. Shell fallback also
exists in more than one layer. As a result, startup, new-project, and new-tab
creation can launch the same shell in different directories, and testing one
route does not establish the product contract.

## Implementation slices

- [x] Define one immutable launch-resolution input/output contract containing
  authorized server/project/panel identity, explicit choices, the settings and
  workspace revisions used, resolved profile metadata, target, argument array,
  environment, cwd, and dimensions.
- [x] Implement profile precedence (explicit, project, server, System default),
  known-shell startup-mode translation, target revalidation, protected
  environment layering, and bounded failure codes in one server component.
- [x] Require an explicit shell for WSL startup/arguments/environment, keep
  `WSLENV` server-controlled, and handle protected Windows environment names
  case-insensitively.
- [x] Implement the cwd policies and exact fallback semantics from the feature
  specification. Distinguish invalid explicit paths, stale observed panel cwds,
  missing project roots, explicit root projects, unsafe implicit roots, and
  legacy-unverified root provenance.
- [x] Remove production shell candidate lists, `"."`, `process.cwd()`, and
  Electron-home fallbacks outside the resolver. The PTY service requires a
  fully resolved launch snapshot and performs no policy decisions.
- [x] Route initial workspace seed, new project, new tab, split, open-at-folder,
  Desktop compatibility, browser, local protocol, and remote protocol creation
  through the same resolver.
  - [x] Standalone-server initial workspace seed.
  - [x] Standalone MCP `open_terminal`, including post-spawn panel
    reconciliation.
  - [x] Embedded Desktop and shared application-protocol routes listed above.
- [x] Enforce authenticated project/session claims on terminal create, list,
  cwd, attach, resume, input, resize, kill, detach, and inactivity operations.
- [x] Extend `terminal.create` with optional profile and active-panel intent
  without accepting ad-hoc launch data. Resolve authoritative project/panel
  records on the server and commit a panel only after successful spawn.
- [x] Persist resolved profile id/revision, safe target summary, cwd, and
  creation time as session metadata. Exclude environment values and ensure
  recording and MCP receive only their permitted resolved metadata/internal
  environment.
- [x] Make resolution and spawn observe one settings/workspace snapshot and
  define deterministic results for concurrent profile, project, and settings
  mutations.

## Acceptance checks

- A matrix test asserts the exact executable/profile id, ordered arguments, and
  `pwd` for startup seed, first terminal in a new project, new tab, split,
  open-at-folder, explicit profile, project default, server default, and System
  default.
- The same matrix passes through embedded Desktop and the framed local/remote
  application protocol; transports do not change launch results.
- A new project rooted at home starts its first and later terminals at home. An
  implicit request never starts at `/`, a drive root, or the packaged app cwd.
- An explicitly selected root project may start at root, proving that the safety
  rule rejects accidental fallback rather than valid user intent.
- A migrated root-like project is marked legacy-unverified and fails with
  `unsafe_legacy_root` until an authorized user confirms or replaces its root.
- Missing explicit cwd and missing project-root tests produce distinct bounded
  failures; stale active-terminal cwd falls back only as specified.
- Profile environment tests prove merge order, `null` removal, protected-name
  enforcement, no string evaluation, and absence from snapshots, logs, errors,
  recordings, and diagnostics.
- Unavailable custom profiles fail without falling back, while System default
  follows only its documented platform fallback chain.
- A spawn failure creates neither a live session nor a durable panel, and a
  settings revision race cannot mix fields from two profile versions.

## Definition of done

All production PTY creation paths consume one tested launch resolver, exact
shell-and-cwd integration tests pass for local and remote transports, and no
lower layer retains an implicit shell or cwd policy.
