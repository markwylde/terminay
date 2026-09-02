## Context

See proposal.md for the defect. Depended on the shell profile domain and
discovery work that had already made profiles server-owned; this change made the
launch itself server-owned.

## Goals / Non-Goals

Goals:
- One tested resolver consumed by every production PTY creation path.
- Identical launch results across embedded Desktop, framed local, and remote
  transports.
- Bounded, distinguishable failure codes instead of silent fallback.

Non-Goals:
- Changing the profile catalogue, discovery, or the settings UI.
- Changing existing sessions: resolution affects only newly created terminals.

## Decisions

- **One immutable launch snapshot.** Resolution produces a single immutable
  record — identity, explicit choices, the settings and workspace revisions it
  read, resolved profile metadata, target, argument array, environment, working
  directory, and dimensions — and the PTY service consumes it whole. Because
  resolution and spawn observe one settings/workspace snapshot, a concurrent
  profile, project, or settings mutation either precedes that snapshot or affects
  the next terminal; it can never produce a mixed launch.
- **Policy exists only in the resolver.** Shell candidate lists, `"."`,
  `process.cwd()`, and the Electron home fallback were removed from the renderer,
  the Electron bootstrap, the protocol adapter, and the PTY service. This is the
  decision that makes the contract testable: a route cannot quietly disagree
  because it has no policy of its own left to disagree with.
- **Unsafe implicit roots fail rather than fall back.** An implicit request must
  never start at `/`, a drive root, or the packaged application's working
  directory. An explicitly selected root project may still start at root, so the
  safety rule rejects accidental fallback rather than valid user intent.
- **Legacy root provenance is tracked.** A migrated project whose root is
  root-like is marked legacy-unverified and fails with `unsafe_legacy_root`
  until an authorized user confirms or replaces its root. This crosses a safety
  boundary deliberately: an old snapshot cannot be trusted to distinguish
  "the user chose /" from "we fell back to /".
- **Unavailable custom profiles fail closed.** Only System default follows its
  documented platform fallback chain; a named unavailable profile does not
  silently become another shell.
- **Server-side authority over client-supplied inputs.** `terminal.create` takes
  an optional profile id and active-panel intent, never ad-hoc launch data. The
  server reads the authoritative project, profile, and panel records itself and
  performs final path and executable validation. Every `terminal.*` operation is
  checked against authenticated project and session claims.
- **Commit the panel only after a successful spawn.** A spawn failure leaves
  neither a live session nor a durable panel.
- **WSL requires an explicit shell.** WSL startup, arguments, and environment
  require an explicit shell rather than an implicit distribution default, and
  `WSLENV` stays server-controlled. Protected Windows environment names are
  matched case-insensitively because the platform treats them that way.
- **Environment values never leave the resolver.** Session metadata retains the
  profile identity, target summary, working directory, and creation time; it
  excludes environment values, and recording and MCP receive only the resolved
  metadata or internal environment they are permitted.

## Risks / Trade-offs

- Failing closed on unsafe implicit roots and legacy-unverified projects is a
  visible behaviour change for existing users, who must confirm a root before
  terminals launch. Accepted: the alternative is silently starting shells at `/`.
- Concentrating policy in one component makes it a single point of failure; it
  is mitigated by the matrix test that asserts exact executable, profile id,
  ordered arguments, and `pwd` for every route and transport.

## Migration Plan

Projects migrated from earlier snapshots whose roots look like a filesystem or
drive root are marked legacy-unverified. Their terminals fail with
`unsafe_legacy_root` until an authorized user confirms the root or replaces it.
No project identity, environment binding, panel, or layout is changed.
