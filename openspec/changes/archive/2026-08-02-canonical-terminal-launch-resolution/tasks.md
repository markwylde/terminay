## 1. Launch-resolution contract

- [x] 1.1 Define one immutable launch-resolution input/output contract carrying
  authorized server/project/panel identity, explicit choices, the settings and
  workspace revisions used, resolved profile metadata, target, argument array,
  environment, working directory, and dimensions, verified by the resolver's
  contract tests
- [x] 1.2 Implement profile precedence (explicit, project, server, System
  default), known-shell startup-mode translation, target revalidation, protected
  environment layering, and bounded failure codes in one server component,
  verified by precedence and failure-code tests
- [x] 1.3 Require an explicit shell for WSL startup, arguments, and environment,
  keep `WSLENV` server-controlled, and handle protected Windows environment names
  case-insensitively, verified by the Windows and WSL profile tests
- [x] 1.4 Implement the working-directory policies and exact fallback semantics,
  distinguishing invalid explicit paths, stale observed panel directories,
  missing project roots, explicit root projects, unsafe implicit roots, and
  legacy-unverified root provenance, verified by distinct bounded failure
  assertions per case

## 2. Removing competing policy

- [x] 2.1 Remove production shell candidate lists, `"."`, `process.cwd()`, and
  Electron-home fallbacks outside the resolver, verified by a source check plus
  the PTY service refusing anything but a fully resolved launch snapshot

## 3. Routing every creation path

- [x] 3.1 Route initial workspace seed, new project, new tab, split,
  open-at-folder, Desktop compatibility, browser, local protocol, and remote
  protocol creation through the resolver, verified by the launch matrix test
- [x] 3.2 Route the standalone-server initial workspace seed through the
  resolver, verified by standalone startup coverage
- [x] 3.3 Route standalone MCP `open_terminal` through the resolver, including
  post-spawn panel reconciliation, verified by MCP tool tests
- [x] 3.4 Route embedded Desktop and the shared application-protocol routes
  through the resolver, verified by running the same matrix over both transports

## 4. Authority and metadata

- [x] 4.1 Enforce authenticated project and session claims on terminal create,
  list, cwd, attach, resume, input, resize, kill, detach, and inactivity
  operations, verified by unauthorized-claim rejection tests
- [x] 4.2 Extend `terminal.create` with optional profile and active-panel intent
  without accepting ad-hoc launch data, resolve authoritative project and panel
  records server-side, and commit a panel only after a successful spawn, verified
  by a spawn-failure test asserting neither a live session nor a durable panel
- [x] 4.3 Persist resolved profile id/revision, safe target summary, working
  directory, and creation time as session metadata while excluding environment
  values, and give recording and MCP only their permitted resolved metadata or
  internal environment, verified by snapshot, log, error, recording, and
  diagnostics assertions
- [x] 4.4 Make resolution and spawn observe one settings/workspace snapshot with
  deterministic results for concurrent profile, project, and settings mutations,
  verified by a settings-revision race test proving fields are never mixed across
  two profile versions

## 5. Acceptance

- [x] 5.1 Assert exact executable, profile id, ordered arguments, and `pwd` for
  startup seed, first terminal in a new project, new tab, split, open-at-folder,
  explicit profile, project default, server default, and System default, verified
  by the matrix test
- [x] 5.2 Run the same matrix through embedded Desktop and the framed
  local/remote application protocol and verify transports do not change launch
  results
- [x] 5.3 Verify a new project rooted at home starts its first and later terminals
  at home, and that an implicit request never starts at `/`, a drive root, or the
  packaged application working directory
- [x] 5.4 Verify an explicitly selected root project may start at root, and that a
  migrated root-like project is marked legacy-unverified and fails with
  `unsafe_legacy_root` until confirmed or replaced
- [x] 5.5 Verify profile environment merge order, `null` removal, protected-name
  enforcement, absence of string evaluation, and absence from snapshots, logs,
  errors, recordings, and diagnostics
- [x] 5.6 Verify unavailable custom profiles fail without falling back while
  System default follows only its documented platform fallback chain
