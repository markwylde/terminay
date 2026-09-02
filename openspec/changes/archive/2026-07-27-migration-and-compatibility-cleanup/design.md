## Context

See proposal.md. The evidence boundary for this change is recorded in
`openspec/adr/evidence/task19-20-release-migration-audit.md`. This change depends
on the whole server-backed programme: the workspace and protocol foundation, the
server-owned workspace model, the standalone and embedded server runtime, the
Desktop connection host and Local mode, the server terminal, activity and agent,
MCP, files and file viewer, Git, recordings, settings/secrets/macros, and
AI/dictation services, the shared responsive server UI, full WebRTC server
connections, and the connection menu and web host.

## Goals / Non-Goals

Goals: a tested, recoverable migration for existing Desktop users; explicit
evidence that the full product works through the server architecture; and the
removal of every transitional implementation that could act as a second authority.

Non-Goals: proving hosted or physical-device execution. External hosted deployment,
real provider execution, native data channels, TURN, and physical target devices
are operational boundaries recorded as operational assurance, not project
checkboxes.

## Decisions

### Migration is preflight-first and value-free

The preflight (`inspectLegacyMigration.storeVersions`) inventories store versions
and paths across supported Desktop releases without reading values, so an
inventory can be produced and reviewed without handling secrets. Import is
idempotent, writes a completion marker, takes a backup, resumes after failure, and
never writes a plaintext secret file.

### Some state is honestly unrecoverable

Renderer-only historic layouts cannot be reconstructed. Rather than guessing,
preflight reports them as unrecoverable and `WorkspaceRepository.load()` commits
the empty canonical snapshot on first server load. Missing project or recording
paths are represented explicitly in the inventory rather than silently dropped.

### Identity collisions are user decisions

Cloned or colliding server identities require explicit resolution. Silently
merging or renaming would produce two servers claiming the same trust state.

### Manager origins and credentials stay separate

Sanitized `app.terminay.com` manager metadata moves or redirects to
`web.terminay.com` without copying cross-origin credentials. Existing
`<session>.terminay.com` origins and their valid reconnect grants are preserved:
the migration reloads the unchanged origin-bound grant and completes a fresh
challenge and proof. Connection profiles migrate separately from server trust
state, non-canonical profile URLs are rejected, and trust and profile outputs omit
credential-bearing fields. Pairing fragments and credentials never enter either
manager origin.

### Rollback has a hard boundary

Pre-migration Electron state is restored on rollback only before server-only
mutations commit. After that boundary, recovery is by explicit backup rather than
by an implicit reversal, because a partial reversal across two authorities cannot
be made consistent.

### Cleanup follows parity, and parity is measured honestly

Every required surface and canonical feature is an explicit evidence cell in
`scripts/task19-compatibility-matrix.mjs`. The matrix keeps partial and open cells
visible and does not claim rendered parity. Matrix validation resolves task
contracts from either the active or the completed task directory, so moving a
completed task does not silently invalidate its evidence.

The matrix was re-audited several times. A previous 52/52 claim was found invalid
because wide and mobile web production used a different feature-body and component
tree from Electron; protocol workflows and overflow checks do not establish shared
renderer or visual parity. The corrected matrix retained the Desktop protocol
evidence and marked all 26 wide and mobile web cells partial until the shared
responsive UI work closed. Touch-enabled Chromium workflows subsequently
strengthened those cells — settings, file-open, terminal lifecycle, Git
pull/rename/Quick Push approval/removal, recordings select/replay/delete/list-empty
with bounded overflow, project and panel create/move/close through the bounded
`WorkspaceClient`, and AI/dictation idle/recording/error/cancel/ready states with
44-pixel actions and no horizontal overflow — while soft-keyboard behaviour,
mobile networking, backgrounding, and physical devices remained operational
follow-up.

The full checked-in Playwright suite was run serially after the shared-UI move and
the activity-acknowledgement closure: `npx playwright test --workers=1` completed
with 172 passed, 5 explicitly environment-gated skips, and 0 failures. That proves
the local Desktop and checked-in Chromium application paths compose together; the
skipped real-provider, native-datachannel, and TURN cases and external hosted
pairing remain outside this evidence.

### The one-server-model baseline is locked at exact zero

The connected renderer's second-authority count is pinned at zero by
`scripts/one-server-model-boundary-baseline.json`. The feature matrix cites that
architecture evidence separately from rendered parity, so a canonical-client
boundary regression fails without promoting any contract, partial, or open surface
cell.

### Compatibility imports are exact directed edges

Remaining hidden compatibility imports are inventoried as exact directed edges.
Only the renderer-entry hand-off, named transitional callers, and the canonical
transport bridge may reach legacy or disconnected modules; normal web entries stay
compatibility-free, and any new edge fails until it is removed or explicitly
classified. The retired Electron terminal service and its protocol are quarantined
sources with no normal main or bootstrap importer, retained only by isolated
historical test harnesses.

### A facade that cannot subscribe must fail, not no-op

Every feature client that owns live state — settings, macros, activity, agent
status, and the generic `TerminayClientFacade` — rejects a transport that cannot
subscribe, instead of returning a silent no-op unsubscribe. A no-op would let a
compatibility bridge leave a stale renderer projection looking authoritative,
which is precisely the second-authority failure this change exists to remove.
Creating a shared authenticated server context likewise requires both the activity
and agent-status projections, so a partial compatibility connection is never
retained.

### Narrow frozen hosts replace the broad preload

Every remaining native behaviour moved off the broad application preload onto its
own frozen, versioned host that validates its exact message shape before renderer
delivery: workspace transfer, project tab drag and tear-off, terminal clipboard,
terminal presentation zoom and remote viewport override, settings focus section,
file-explorer watch and folder-size progress, remote-access status (read-only),
server connection lifecycle and framed transport, file-viewer operations, terminal
settings, macro settings and secrets, AI metadata, edit-window state and result,
Quick Push plan and apply, and remote pairing PIN. A declaration gate freezes each
host's exact version-one operation set, so adding a file, project, or server data
method fails review. Zero-consumer operations were removed from the public preload
entirely, which allowed the empty broad `terminay` global and the `TerminayApi`
marker to be deleted.

Adapters must receive their narrow host capability explicitly and snapshot it into
an immutable frozen wrapper before use, so importing a component or hook cannot
silently acquire `window.terminay` and cannot observe a later replacement of a
host method. Renderer-global registries were removed in favour of composition-root
injection.

### Connected Desktop reads server-owned data

Every `window.terminay*Host` call in the production renderer was audited and
classified as server data authority to move onto the `TerminayClient` protocol,
native presentation to keep as a narrow bridge, or disconnected-only compatibility
to delete after parity. File explorer and Git fallback reads and mutations moved
onto `FileViewerClient` and `TerminayGitClient`; macro persistence and
subscriptions, model discovery, recording state, Parakeet runtime management,
dictation upload, and OpenAI transcription and API-key mutation moved onto the
selected server's clients. Electron's local settings file retains only
connection-host presentation fields and the microphone device override. Native
reveal, clipboard, microphone capture and permission, and settings-window
launch/focus remain native host actions.

### Cross-repository CI ownership

Public Terminay CI runs its selected secure-Werift runtime against an
in-repository mock signaling peer and native Chromium on every pull request and
`main`; it never checks out, mirrors, or receives credentials for the proprietary
hosted service. The sibling `terminay.com` CI owns the full integration proof
against its real browser peer, using a reviewed public Terminay revision and the
ticket-bound four-channel bridge. This repository rejects swapped or aliased lanes
and contains no terminal-protocol fallback.

## Risks / Trade-offs

- Deleting a transitional path before parity is unrecoverable, so every removal is
  gated on a matrix cell plus a boundary test that fails if the path returns.
- Failing closed on a missing subscription can refuse a connection to an older
  server. That is accepted: a refused connection is visible, whereas a stale
  projection is not.
- The matrix deliberately keeps partial and open cells rather than rounding up to
  a parity claim, which makes the record less tidy but honest.

## Migration Plan

1. Run the value-free preflight inventory across supported Desktop releases.
2. Back up, then import idempotently into the embedded server with a completion
   marker and resumable failure.
3. Migrate manager metadata and connection profiles separately from trust state,
   preserving session origins and reconnect grants.
4. Roll back to pre-migration Electron state only before server-only mutations
   commit; after that boundary, recover from the backup explicitly.
5. Keep the direct server-bundled UI as a credential-free recovery client
   throughout.
6. Remove transitional implementations only after the corresponding matrix
   evidence exists, each removal guarded by a boundary test.

## Open Questions

Operational follow-up, outside this change's checkboxes: execute the
environment-gated native-datachannel, TURN, and real-provider cases plus external
hosted pairing and reconnect on provisioned infrastructure and physical target
devices, and record that evidence in the compatibility matrix as operational
assurance.
