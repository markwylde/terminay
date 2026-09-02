## Context

See proposal.md. The initial drift audit recorded the exact state of each surface before
any code changed:

- Performant Text loaded one truncated range into a textarea, had no ranged line model or
  sparse save, and could not satisfy the large-file contract.
- Diff exposed one preformatted patch rather than distinct virtualized unified and
  side-by-side rows, and had no explicit server-side size result.
- HEX virtualized ranged reads, but normal-file byte edits, shared Text/HEX draft state,
  range selection, and configurable row width were absent.
- Recording replay read each complete cast into renderer memory; renderer IPC accepted
  filesystem paths for read, delete, and reveal; the list fallback read a complete cast;
  and active-delete and path-replacement boundaries lacked coverage.
- MCP had unit-level control coverage but no reproducible real-SDK Codex/Claude install
  contract and no running multi-project isolation exercise.
- WebRTC exposed the historical `peer-handler-unavailable` scaffold state after a
  configured host failed to become ready.

## Goals / Non-Goals

Goals: close the interaction and reproducibility slices named above, and name every
broader contract gap with its owning extraction task.

Non-Goals: completing the file, recording, or MCP service extractions. A checked slice
here is not evidence that the complete governing feature is implemented.

## Decisions

- The recording follow-up also closes cast-before-sidecar recovery, temporary
  historical-root unavailability, fatal-writer cleanup, and capture-before-first-output at
  the Electron PTY boundary, because those defects sit on the same writer path.
- MCP reproducibility is delivered as an automated suite with an explicit documented
  limitation rather than a manual test claim. The suite validates serialization of the
  synthetic launch contract for both provider formats, launches a test-built stdio entry
  through the official MCP SDK, and exercises two live project scopes. It does not launch
  the synthetic persisted path, a packaged provider entry, or a developer's installed Codex
  or Claude Code binary, and it does not modify real provider configuration.
- Provider configuration replacement is atomic, preserves existing modes, and refuses to
  replace a changed Terminay entry. Full changed/unavailable/error status reporting and a
  separately versioned MCP entry artifact stay with server MCP control.
- The WebRTC status path distinguishes registering, ready, relay loss after readiness,
  pairing-peer loss, relay error, and premature close, and no longer reports a scaffold state.

## Risks / Trade-offs

Remaining authority seams are accepted and explicitly assigned rather than fixed here:

- File access still accepts a renderer-supplied project-root compatibility value rather than
  a canonical server-owned project session; that seam moves to server files and file viewer.
- Renderer destruction still terminates renderer-owned PTYs; renderer-independent lifetime
  moves to server recordings and the server terminal service.
- The MCP control endpoint remains an Electron-main-to-renderer forwarding bridge rather
  than a headless canonical-server operation surface; removing it belongs to server MCP control.

The repository-wide `npm run smoke` remains a release checkpoint for the combined worktree
rather than evidence supplied by this narrow task alone.
