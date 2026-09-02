## 1. Workspace shape

- [x] 1.1 Convert the repository into one workspace with independently buildable `terminay-desktop`, `terminay-server`, and `terminay-web` applications and verify each builds on its own from the workspace root
- [x] 1.2 Add shared protocol, client-core, responsive-UI, and server-core packages with explicit public entry points and verify deep imports of package internals or generated output are rejected
- [x] 1.3 Keep all shared source in this workspace while the three applications remain independently packageable and deployable, verified by the independent application build gate
- [x] 1.4 Preserve existing Desktop builds, packaging, and tests during the move, verified by the existing smoke, focused, packaging, and E2E suites staying green

## 2. Dependency boundaries

- [x] 2.1 Prevent server-core from importing Electron and verify with a forbidden-import fixture in the boundary checker tests
- [x] 2.2 Prevent protocol, client-core, and responsive UI from importing Node, Electron, WebRTC, WebSocket, or a concrete local transport, verified by forbidden fixtures for each syntax form
- [x] 2.3 Prevent Desktop host code from becoming a second copy of application services, verified by the legacy-quarantine surface test that rejects file and import growth
- [x] 2.4 Add boundary checks to normal CI and verify the smoke path runs boundary validation, package type checking, deterministic shared builds, and all three application builds before packaging or E2E

## 3. Protocol

- [x] 3.1 Define handshake, capability, command, response, event, stream, binary-transfer, cancellation, and structured-error envelopes and verify each against its closed schema
- [x] 3.2 Add runtime validators, deterministic encoding, version negotiation, and resource limits and verify canonical encoding is byte-stable across repeated encodes
- [x] 3.3 Define expected revisions, idempotent command ids, deadlines, backpressure, and reconnect/resync semantics and verify a repeated completed command id returns its recorded result without re-executing
- [x] 3.4 Keep Electron window ids, browser ids, titles, and transport-specific authorization out of the contract, verified by schema review and the closed-schema rejection of unknown fields

## 4. Client and transports

- [x] 4.1 Define the `TerminayClient` queries, commands, subscriptions, connection state, and error surface and verify against the conformance suite
- [x] 4.2 Define the framed transport lifecycle and backpressure interface and verify the opening/open/closing/closed/failed states and bounded queue accounting
- [x] 4.3 Implement in-memory and compatibility Electron-IPC adapters and verify the Electron adapter moves framed bytes over one bounded bridge rather than a per-feature IPC method
- [x] 4.4 Add a conformance harness reusable by Local and WebRTC transports and verify the same suite passes over both in-memory and framed Electron transports

## 5. Tooling and versions

- [x] 5.1 Define supported Node, Electron, browser, and platform versions and verify the declared matrix gates the build
- [x] 5.2 Produce deterministic protocol/client artifacts for server and UI builds and verify by building twice and comparing sorted hashes
- [x] 5.3 Add compatibility fixtures for one prior protocol version and verify an unsupported version negotiation returns a closed `incompatible_version` error carrying the supported minimum and maximum before closing

## 6. Acceptance

- [x] 6.1 Verify existing Desktop smoke and focused feature tests remain green
- [x] 6.2 Verify package-boundary tests reject representative forbidden imports
- [x] 6.3 Verify duplicate, stale, malformed, cancelled, oversized, slow-consumer, and incompatible cases have deterministic test outcomes
