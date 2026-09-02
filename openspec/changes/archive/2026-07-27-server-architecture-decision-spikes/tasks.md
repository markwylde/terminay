## 1. Headless WebRTC

- [x] 1.1 Run the production signaling flow from a displayless Node process with the selected architecture-neutral runtime and exercise that same artifact in clean Linux x64 and arm64 environments, verified by clean runs recorded in the production headless WebRTC Linux evidence
- [x] 1.2 Compare maintained Node WebRTC runtimes for data-channel behaviour, ICE/STUN/TURN, native distribution, Electron compatibility, shutdown, resource use, and security maintenance, verified by the recorded comparison and npm advisory audit
- [x] 1.3 Prove first pairing, reconnect, signed signaling, isolated channels, and bounded asset transfer through the existing hosted service, verified by the production headless integration spikes
- [x] 1.4 Prove reconnect requires both the origin-bound device private key and its grant, that the relay cannot derive signaling keys, that signatures bind the complete closed envelope, that invalid signatures cannot consume a nonce, and that exact valid replays are rejected, verified by the production spike assertions
- [x] 1.5 Force direct/STUN and authenticated TURN-only routes with structured ICE credentials and prove bounded application-channel pressure, revocation, and cleanup, verified by `scripts/production-webrtc-turn-routes.test.mjs` and `scripts/webrtc-headless-resource-limits.test.mjs`
- [x] 1.6 Select one runtime and record exact fallback/blocking evidence, verified by the recorded decision and evidence documents

## 2. Native PTY distribution

- [x] 2.1 Run the existing PTY host from plain Node and from an Electron-supervised child using the same module, verified by `scripts/pty-host-runtime.test.mjs` and `scripts/pty-electron-main-supervisor.test.mjs`
- [x] 2.2 Record the initial platform matrix and minimum GNU/Linux ABI, verified by the declared distribution matrix in the decision record
- [x] 2.3 Produce compiler-free standalone PTY candidates for Linux x64/arm64 and packaged Desktop candidates, then execute the complete behaviour probe on representative native and architecture-emulated targets, verified by `scripts/pty-runtime-artifact-probe.mjs`, `scripts/pty-packaged-macos.test.mjs`, and `scripts/pty-packaged-linux.test.mjs`
- [x] 2.4 Verify signals, process trees, cwd, UTF-8, foreground-process inspection, and bounded shutdown, verified by the shared PTY behaviour contract applied in every probe
- [x] 2.5 Select the standalone artifact format that supports the requested `./terminay-server` experience, verified by the recorded selection

## 3. Persistence and vault

- [x] 3.1 Compare storage backends against atomic multi-object commits, revision lookup, migrations, corruption recovery, backup, and concurrent clients, verified by the recorded comparison
- [x] 3.2 Prove the chosen candidate with an interrupted-write recovery test, verified by `scripts/server-state-sqlite-crash.test.mjs`
- [x] 3.3 Define one vault interface with embedded and headless implementations, verified by `scripts/vault-reference.test.mjs`
- [x] 3.4 Prove Electron safe-storage import without plaintext migration files, verified by `scripts/safe-storage-import.test.mjs` and its plaintext scan of the isolated profile, temp, log, trace, and crash tree
- [x] 3.5 Select and document headless unlock/key management and reject a design that stores the encryption key beside its ciphertext, verified by the recorded decision
- [x] 3.6 Prove the versioned envelope, exact bounded KDF parameters, wrong-key and tamper behaviour, lock/rewrap/recovery, inherited key-FD lifecycle, and plaintext-free failure paths, verified by `scripts/vault-reference.test.mjs`

## 4. Client-host composition

- [x] 4.1 Prove a sandboxed Electron view loading server-provided UI with Node disabled and only a narrow validated host bridge, verified by `e2e/server-ui-sandbox.spec.ts`
- [x] 4.2 Prove a parent connection shell around an exact-origin session view, or select a simpler model with the same origin and credential isolation, verified by `e2e/web-client-host.spec.ts`
- [x] 4.3 Verify xterm keyboard focus, clipboard permission, resizing, CSP, navigation blocking, mobile viewport/virtual keyboard, and `frame-ancestors`, verified by `e2e/web-client-host.spec.ts` and the iOS Safari mobile-viewport evidence
- [x] 4.4 Prove the host cannot read session-origin IndexedDB, cookies, device keys, reconnect grants, or workspace data, verified by the distinct parent, session, and attacker origins in `e2e/web-client-host.spec.ts`

## 5. Decision records

- [x] 5.1 Record one selected approach, evidence, supported platforms, constraints, and fallback for every spike, verified by ADR-0001 through ADR-0006 and the evidence documents they cite
- [x] 5.2 Update the governing feature contracts where a selected constraint changes product behaviour, verified by the updated runtime, workspace-state, and client-host contracts
- [x] 5.3 Stop before foundation implementation if a required headless or security property has no viable path, verified by the strict follow-up audit that kept affected items open until the production gates passed together
