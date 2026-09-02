## 1. Audit

- [x] 1.1 Audit file-viewer, recording, and mcp-server against current code and tests, and verify by recording the exact implementation gaps before any code changes.

## 2. File viewer

- [x] 2.1 Implement the large-file text/diff/hex interaction slice with virtualized unified and side-by-side diff rows, selection, shared Text/HEX drafts, explicit Performant-to-Monaco transitions, bounded incremental indexing, and privileged structured-diff normalization, and verify with `scripts/file-viewer-diff.test.mjs`, `scripts/file-viewer-draft.test.mjs`, and `scripts/file-viewer-performant.test.mjs`.
- [x] 2.2 Keep canonical server-session ownership and path authorization explicit for the file-service extraction, and verify by stale and path-replacement rejection coverage.

## 3. Recording

- [x] 3.1 Implement bounded recording replay, opaque-id recording actions, active-recording reveal, and the shared privileged input-capture boundary, and verify with `scripts/recording-service.test.mjs`, `scripts/recording-replay.test.mjs`, and `e2e/recordings.spec.ts`.
- [x] 3.2 Prove authenticated remote input reaches the single privileged input boundary exactly once, verified by `scripts/webrtc-service-runtime.test.mjs`.

## 4. MCP

- [x] 4.1 Replace the historical unchecked manual-test statement with reproducible automated coverage and a documented limitation, verified by `scripts/mcp-stdio.test.mjs`, `scripts/mcp-install-providers.test.mjs`, and `e2e/mcp-server.spec.ts`.

## 5. Remote access

- [x] 5.1 Replace the obsolete WebRTC scaffold messaging with an accurate recoverable-state explanation, verified by `scripts/webrtc-service-runtime.test.mjs` covering registering, ready, relay loss after readiness, pairing-peer loss, relay error, and premature close.
