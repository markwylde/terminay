# Feature drift alignment

## Goal

Resolve the smaller feature gaps that predate the server/client architecture
work and keep them from becoming hidden assumptions during extraction.

## Governing specifications

- [File viewer](../features/file-viewer.md)
- [Terminal recording](../features/recording.md)
- [Terminay MCP server](../features/mcp-server.md)
- [Remote access](../features/remote-access.md)

## Why this is active

The feature-contract cleanup moved implementation status and old checklists out
of the canonical specifications. Code inspection still found several concrete
gaps in large-file interaction, recording scalability, MCP verification, and
one stale WebRTC fallback message. They need explicit implementation or a
deliberate product-contract change before the corresponding server service is
extracted.

## Dependencies

None. Complete or explicitly resolve these pre-existing gaps before the
affected service extraction task begins.

## Work slices

- [x] Audit [file-viewer](../features/file-viewer.md),
  [recording](../features/recording.md), and
  [mcp-server](../features/mcp-server.md) against current code and tests; record
  exact implementation gaps here before changing code.
- [x] Implement the current Electron large-file text/diff/hex interaction
  slice, including unified and side-by-side virtualized diff rows, selection,
  shared Text/HEX drafts, explicit Performant-to-Monaco transitions, bounded
  incremental indexing, and privileged structured-diff normalization. Keep
  canonical server-session ownership and path authorization explicit for the
  file-service extraction.
- [x] Implement bounded recording replay, opaque-id recording actions,
  active-recording reveal, and the shared privileged input-capture boundary in
  the current Electron runtime. Keep renderer-independent server lifetime
  ownership explicit for the recording-service extraction.
- [x] Run the MCP flow manually in a running multi-project app with Codex and
  Claude Code, or replace the historical unchecked manual-test statement with
  reproducible automated coverage and a documented limitation.
- [x] Replace the obsolete WebRTC “scaffolded/peer handler unavailable” user
  messaging with an accurate recoverable-state explanation when a configured
  host cannot become ready.

## Completion evidence

- Initial drift audit:
  - Performant Text loaded one truncated range into a textarea, had no ranged
    line model or sparse save, and could not satisfy the large-file contract.
  - Diff exposed one preformatted patch rather than distinct virtualized
    unified/side-by-side rows, and had no explicit server-side size result.
  - HEX virtualized ranged reads but normal-file byte edits, shared Text/HEX
    draft state, range selection, and configurable row width were absent.
  - Recording replay read each complete cast into renderer memory; renderer
    IPC accepted filesystem paths for read/delete/reveal; list fallback read a
    complete cast; and active-delete/path-replacement boundaries lacked
    coverage.
  - MCP had unit-level control coverage but no reproducible real-SDK
    Codex/Claude install contract or running multi-project isolation exercise.
- WebRTC exposed the historical `peer-handler-unavailable` scaffold state
    after a configured host failed to become ready.
- Strict follow-up audit found deeper file, recording, MCP, and WebRTC-status
  gaps. This task closes only the interaction and reproducibility slices named
  above. The recording follow-up also closes cast-before-sidecar recovery,
  temporary historical-root unavailability, fatal-writer cleanup, and
  capture-before-first-output at the Electron PTY boundary. The remaining
  defects and their owners are explicit:
  - File access still accepts a renderer-supplied project-root compatibility
    value rather than a canonical server-owned project session. That authority
    seam moves to
    [server files and file viewer](./11-server-files-and-file-viewer.md).
  - Renderer destruction still terminates renderer-owned PTYs. Moving PTY and
    capture ownership into the server, including renderer-independent lifetime,
    belongs to [server recordings](./13-server-recordings.md) and
    [server terminal service](./8-server-terminal-service.md).
  - The MCP control endpoint remains an Electron-main-to-renderer forwarding
    bridge rather than a headless canonical-server operation surface. Removing
    that routing/authority seam belongs to
    [server MCP control](./10-server-mcp-control.md).
  - Provider configuration replacement is atomic, preserves existing modes,
    and refuses to replace a changed Terminay entry. Provider status still
    reports only installed/not-installed rather than the full
    changed/unavailable/error states, and installation does not yet manage a
    separately versioned MCP entry artifact. Those lifecycle and status
    requirements remain in
    [server MCP control](./10-server-mcp-control.md).
- The interaction fixes in this task deliberately do not claim that extraction
  is already complete:
  - the file draft and filesystem operations move behind canonical server
    sessions and authorization in
    [server files and file viewer](./11-server-files-and-file-viewer.md);
  - recording capture/storage move from Electron into the server PTY boundary
    in [server recordings](./13-server-recordings.md); and
  - the control socket, provider-install lifecycle, and renderer forwarding
    move behind canonical server state in
    [server MCP control](./10-server-mcp-control.md).
- MCP: `scripts/mcp-stdio.test.mjs`,
  `scripts/mcp-install-providers.test.mjs`, and `e2e/mcp-server.spec.ts`.
  The reproducible suite validates serialization of the synthetic launch
  contract for both provider formats, separately launches a test-built stdio
  entry through the official MCP SDK, and exercises two live project scopes.
  It does not launch the synthetic persisted path, a packaged provider entry,
  or a developer's installed Codex or Claude Code binary, and it does not
  modify real provider configuration.
- WebRTC status: `scripts/webrtc-service-runtime.test.mjs` covers registering,
  ready, relay loss after readiness, pairing-peer loss, relay error, and
  premature close without the obsolete scaffold state.
- File viewer: `scripts/file-viewer-diff.test.mjs`,
  `scripts/file-viewer-draft.test.mjs`, and
  `scripts/file-viewer-performant.test.mjs` cover privileged raw-patch
  normalization into bounded structured hunks, virtualized
  unified/side-by-side rows, one Text/HEX draft, per-request-bounded
  incremental UTF-8 indexing with first-page access before the complete scan,
  BOM/CRLF/multibyte boundaries, length-changing sparse projection, logical
  offsets, atomic saves, and stale/path-replacement rejection. The renderer
  receives no raw Git command output. The focused Electron suites cover
  cross-line selection, structural newline edits, Text→HEX→Text and
  Performant→Monaco dirty transitions with the disk unchanged until explicit
  Save, ranged large HEX edits, and both diff layouts.
- Recording: `scripts/recording-service.test.mjs` covers opaque-id-only public
  DTOs, bounded chunks, atomic private metadata, live input-policy changes,
  startup interruption recovery including a cast created before its sidecar,
  retained historical roots across temporary unavailability, fatal-writer
  cleanup, active-delete rejection, path-free failures, and the one privileged
  local/remote input boundary. Automatic capture starts at the privileged PTY
  creation boundary before the host receives its create command.
  `scripts/recording-replay.test.mjs` covers bounded checkpoints,
  nonzero-offset seek, malformed/truncated input, and cancellation.
  `scripts/webrtc-service-runtime.test.mjs` proves authenticated remote input
  reaches that boundary exactly once. `e2e/recordings.spec.ts` covers capture,
  incremental replay data, current/last reveal, and timeline UI without
  path-bearing recording DTOs.

## Acceptance checks

- The current Electron file viewer has focused coverage for virtualized
  unified/side-by-side rendering, shared Text/HEX draft transitions, sparse
  edits, selection, and explicit save without claiming the extracted server
  file contract is complete.
- The current Electron recording runtime has focused coverage for bounded
  replay, opaque-id actions, reveal, live input policy, and the shared
  local/remote privileged input boundary; its remaining renderer-independent
  lifetime ownership gap is listed above.
- MCP has reproducible provider-format, official-SDK stdio, and live
  multi-project coverage with the separation and limitations listed above.
- WebRTC fallback copy describes the tested configured-host states without
  claiming that remote-access extraction or production transport is complete.

## Definition of done

- Each checked work slice has matching focused code and tests at the narrow
  scope stated in this task.
- Every known broader contract gap found by the audits is named above with its
  owning extraction task; a checked slice is not evidence that the complete
  governing feature is implemented.
- The tested remote status path distinguishes registering, ready, loss after
  readiness, pairing-peer loss, relay error, and premature close.
- Relevant focused tests pass. The repository-wide `npm run smoke` remains a
  release checkpoint for the combined worktree rather than evidence supplied
  by this narrow task alone.
