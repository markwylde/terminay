## 1. Release archives and channels

- [x] 1.1 Extend `scripts/build-standalone-server-artifact.mjs` and `scripts/standalone-artifact.mjs` so `artifact-manifest.json` records `channel`, `revision`, and `architecture`, and verification rejects a manifest missing any of them; verified by `scripts/standalone-artifact.test.mjs` cases for present, missing, and mismatched fields
- [x] 1.2 Add a `--channel` and `--revision` input to the archive builder and make the ELF architecture checks the authoritative arch gate (keeping the native-runner assertion behind a flag) so arm64 can be staged on whichever runner is available; verified by running the builder against both PTY runtime platforms in `scripts/artifact-determinism.test.mjs`
- [x] 1.3 Replace the `npm pack` step in `.github/workflows/trigger-release.yml` with a matrix job (`ubuntu-latest` for x64, `ubuntu-24.04-arm` for arm64) that builds `terminay-server-<version>-linux-{x64,arm64}.tar.gz`, writes the `.sha256` sidecar, signs with `scripts/release-signature.mjs`, verifies, and attaches all six files; verified by `scripts/release-artifact-build-contract.test.mjs` and `scripts/task20-release-artifact.test.mjs` asserting the new asset names and absence of the tgz
- [x] 1.4 Add `.github/workflows/main-prerelease.yml` that runs on push to `main`, builds and signs both archives with `channel=main`, uploads under temporary names, then renames over the `main` prerelease's existing assets; verified by a dry-run job on a branch and by `scripts/hosted-deployment-order.test.mjs` extended to cover the rename sequence
- [x] 1.5 Update `scripts/release-readiness.mjs` and `docs/operations/release-update-policy.md` to name the archives, sidecars, signatures, and channels as the install and upgrade unit; verified by `scripts/release-readiness.test.mjs`

## 2. Session origin and exposure at startup

- [x] 2.1 Move `loadOrCreateEmbeddedSessionOrigin` from `electron/main.ts` into `apps/terminay-server/src/remote/sessionOrigin.ts` with identical file name, schema, and reuse rule, and import it from Desktop; verified by a new `sessionOrigin.test.mjs` covering fresh, reused, and domain-changed roots plus the existing desktop exposure tests passing unchanged
- [x] 2.2 Add `--hosted-domain`, `--expose`, and `--direct-origin` (and `TERMINAY_HOSTED_DOMAIN`, `TERMINAY_EXPOSE`, `TERMINAY_DIRECT_ORIGIN`) to `cliOptions.ts`, defaulting to `terminay.com`, `off`, and unset, rejecting `direct` without an origin; verified by `cliOptions` unit tests for each value, precedence, and the failure case
- [x] 2.3 When `--expose` includes `hosted`, derive the remote origin from the persisted session origin, select `hosted-compact`, and start the hosted pairing host before readiness; verified by `apps/terminay-server/test/hosted-pairing-approval-flow.test.mjs` extended to start the CLI with `--expose hosted` against the loopback relay
- [x] 2.4 Report enabled exposure modes in `--status` and one pairing handoff per mode in the readiness record; verified by `scripts/standalone-server-cli.test.mjs` asserting the redacted status shape and readiness keys

## 3. Direct signaling exposure

- [x] 3.1 Implement `apps/terminay-server/src/remote/directSignalingRelay.ts`: a type-only router with one registered host per session, `acceptSessionSignalingUpgrade` at upgrade, handshake cap of four per room and 60 s, frame size cap, and no parsing of payloads; verified by unit tests for routing, caps, oversized frames, and a second host registration being refused
- [x] 3.2 Generate and persist a self-signed certificate at `<data-root>/direct-tls.v1.json` (owner-only) with `selfsigned` declared by the server package, and serve `/signal` on the authenticated HTTP server when direct exposure is enabled; verified by a test that the listener answers over TLS and that the file mode is 0600
- [x] 3.3 Connect the server's own hosted pairing host to the direct relay over loopback with the direct origin as session origin, sharing one `ServerRemoteExposure` with hosted mode; verified by a test that a device paired via direct reconnects via the loopback hosted relay without re-pairing, and the reverse
- [x] 3.4 Emit a direct pairing URL of the form `https://<direct-origin>/v1/?hostName=…#<secret>` in readiness and the pairing lookup; verified by `scripts/docker-pairing-smoke.mjs` extended to assert the URL grammar

## 4. Live pairing lookup

- [x] 4.1 Add `{ op: 'pairing', rotate?: boolean }` to `approvalSocket.ts` returning `{ ok, exposure, handoffs: [{ mode, pairingUrl, pairingExpiresAt, serverId }] }` and rejecting unknown fields; verified by parser and handler unit tests including the `exposure: 'off'` reply
- [x] 4.2 Wire the op in `cli.ts` to the live exposure's current handoff and `rotate()`; verified by an integration test that `rotate` returns a new room while an existing peer's terminal stream keeps flowing
- [x] 4.3 Reimplement the `--pairing` subcommand as a socket client that prints one line per handoff and exits non-zero with a clear message when no socket exists; verified by `scripts/standalone-server-cli.test.mjs` for both cases and by a grep gate that the old in-process `remote.start()` path is gone

## 5. Desktop direct links

- [x] 5.1 Extend `parseHostedPairingUrl` in `packages/protocol` with a `direct` class for `https` origins not under a known hosted domain, keeping the literal origin and `/v1/` path grammar; verified by parser tests for direct, hosted, manager, loopback, and malformed inputs
- [x] 5.2 Map the `direct` class to `kind: 'direct'` in `resolveDesktopPairingTarget` and pair through `pairDesktopHostedDevice` against the literal origin, disabling certificate verification only for that socket; verified by `scripts/desktop-hosted-pairing-url.test.mjs` and a test that no HTTPS request carries pairing material
- [x] 5.3 Persist direct profiles with the literal origin and reconnect through the direct `/signal`; verified by `scripts/desktop-hosted-connection.test.mjs` covering pair, reconnect, and revoke against the direct relay
- [x] 5.4 Add a security-boundary test that a direct origin never appears as a fetch target for `/api/devices/*`; verified in `scripts/security-privilege-boundary.test.mjs`

## 6. Documentation and validation

- [x] 6.1 Update `docs/operations/standalone-server.md` for archives, `--expose`, `--hosted-domain`, `--direct-origin`, the socket-backed pairing command, and the note that direct mode is authenticated by the host key, not TLS; verified by review against the spec deltas
- [x] 6.2 Run `openspec validate --all`, `npm run smoke:workspaces`, `npm run test:standalone-server`, and `npm run test:security-boundaries`; verified by all passing in CI
