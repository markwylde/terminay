## 1. Server options

- [x] 1.1 Add `--public-host` / `TERMINAY_PUBLIC_HOST` to `apps/terminay-server/src/cliOptions.ts`, deriving the direct origin and, for a routable literal, the advertised ICE address; explicit settings win. Verified by unit tests covering literal, name, loopback, and explicit-override cases.
- [x] 1.2 Add `--ice-port` / `TERMINAY_ICE_PORT` and `--ice-port-span` / `TERMINAY_ICE_PORT_SPAN`, and split range pinning from the advertised address in `remote/hostedPeerLifecycle.ts`. Verified by a test that a pinned range with no advertised address offers only gathered addresses on ports inside the range.
- [x] 1.3 Record at startup when a public host derived no advertised candidate, and include public host in the redacted-safe `--status` fields by presence only. Verified by the image smoke test's startup log and the `--status` output of the built image.
- [x] 1.4 Keep the server identity in the data root across container recreation. No code change was needed: a new data root already receives an opaque persisted identity, so the image sets no `TERMINAY_SERVER_ID`. Verified by the image smoke test, which replaces the container on the same volume under a different hostname and requires the same identity.
- [x] 1.5 Report the source revision of the build (`TERMINAY_SERVER_REVISION`) in the readiness record, `--status`, and `daemon status`. A default-branch build keeps version `0.0.0` and is identified by its revision. Verified by a unit test on the option and by the image smoke test reading `daemon status`.

## 2. Pinned range capacity

- [x] 2.1 Measure concurrent peers against a pinned range with the real WebRTC runtime. Result: a pinned range is a budget across every live peer; a second peer under a spent four-port range gathers nothing. Verified by `apps/terminay-server/test/pinned-ice-range-budget.test.mjs` in `npm run test:real-webrtc`, and recorded in `openspec/adr/evidence/container-reachability-without-advertised-address.md`.
- [x] 2.2 Because 2.1 showed a cap: make the span configurable, do not pin in the image unless a public host or ICE port is set, pin sixteen ports when it is, and log `ice-range-exhausted` when a peer gathers nothing under a pinned range. The `container-image` and `remote-access` deltas were updated to match. Verified by the packaging contract test (`scripts/ghcr-image.test.mjs`) and the image smoke test.

## 3. Client-derived direct candidate

- [x] 3.1 In `electron/remote/desktopHostedConnection.ts`, for a direct origin only, add a remote candidate at the origin's host for each UDP host-candidate port the server offers, after its signed description verifies; skip loopback and hosted origins. Verified by `scripts/desktop-direct-origin-candidate.test.mjs`.
- [x] 3.2 Real-peer proof: a server the client cannot route to, with its pinned range forwarded and no advertised address, connects through a direct origin. Verified by the `derived` case of `scripts/container-image-smoke.mjs`, and by its `control` case failing when derivation is switched off.

## 4. CLI foreground mode

- [x] 4.1 Resolve the data root from `TERMINAY_DATA_ROOT` when no install record exists and reach the socket as the invoking account, for `qr-code`, `pairing-url`, `approvals`, `approve`, `deny`. Verified by `apps/terminay-cli/test/foreground.test.mjs`.
- [x] 4.2 Make `daemon status` report from the server when no unit exists, through a read-only `status` operation on the data-root socket. Verified by CLI and approval-socket tests.
- [x] 4.3 Refuse `install`, `upgrade`, `start`, `stop`, `uninstall` when `TERMINAY_MANAGED_BY=container`, naming the container-runtime action. Verified by CLI tests per command.
- [x] 4.4 Add `--public-host` to `daemon install` and `daemon upgrade`, recorded in the install record and environment file, with derived values printed. Verified by CLI tests for the `Public host flag` scenarios.

## 5. Image

- [x] 5.1 Rebuild the root `Dockerfile` around the release archive's tree, with exposure `hosted,direct`, HTTP 8443, `TERMINAY_PUBLIC_HOST=localhost`, a sixteen-port span, `TERMINAY_MANAGED_BY=container`, a health check, and the `terminay` CLI on `PATH`. Verified by building the image and by `daemon status` reporting ready in the smoke test.
- [ ] 5.2 Confirm the image runs with `--cap-drop=ALL --read-only --security-opt no-new-privileges` plus a data volume and tmpfs. The smoke test pairs and holds a session under those flags; it does not open a terminal, which the scenario requires. Verified when a terminal is opened under those flags.
- [x] 5.3 Image smoke test, no published port and no address: pair and reconnect with Desktop's pairing code, approve through the bundled CLI, assert the server's device-scope pair is `host`/`host` and the session holds. Verified by `scripts/container-image-smoke.mjs` locally on podman and by the `container-image-smoke` job in `.gitea/workflows/ci.yml`.
- [x] 5.4 Image smoke test, public host: publish the pinned UDP range and connect a device on an isolated network with derivation off. Verified by the same script and job.
- [x] 5.5 Recreate-container test: remove the container, start a new one on the same volume, reconnect the paired device without pairing. Verified by the same script and job.
- [x] 5.6 Publish `markwylde/terminay` on Docker Hub beside GHCR from one build in `.github/workflows/server-image.yml`, on release tags only, with `latest` naming the release; update `scripts/ghcr-image.test.mjs`. Verified by the workflow contract test. The published digests can only be compared after the first release.
- [ ] 5.7 Add the Docker Hub credential (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) as release secrets on the mirror. Documented in `docs/operations/release-credential-bootstrap.md`; the secrets themselves are the owner's to create. Verified by a successful publish from a release tag.

## 6. Checks the measurement did not cover

- [ ] 6.1 Pair the packaged Terminay Desktop app with the image run with no configuration, over a hosted link and a direct link, and open a terminal. Verified by Desktop diagnostics showing `remote.hosted-peer.candidate-pair` succeeded and the server log showing `scope=device` `host`/`host`.
- [ ] 6.2 Repeat 6.1 with the macOS firewall enabled. Verified by recording the outcome in the evidence file; if it fails, the runbook's firewall guidance already names the public-host run line as the remedy.
- [ ] 6.3 Run the no-configuration and public-host cases on Docker Desktop for macOS and on a Linux host with host networking. Linux bridge networking is covered by the CI job. Verified by adding each result to the evidence file.

## 7. Startup noise

- [ ] 7.1 Diagnose `agent source com.terminay.builtin-agents/agents failed to start: extension host stopped`. Narrowed, not root-caused: it is not caused by the image (it appears identically in a systemd archive install), and the message is `ExtensionHost.stop()` rejecting a session-source start that was still pending, so something stops the host deliberately during startup. Verified by a written cause for that stop, handed to `builtin-agents-extension` with the reproduction (`docker run markwylde/terminay`, read the first lines of `docker logs`).

## 8. Documentation

- [x] 8.1 Rewrite the container section of `docs/operations/standalone-server.md` around the image: the three run lines, the exec pairing command, why the cases differ, the range budget, the firewall and stale-address notes, and the overlay-network remedy. Verified by reading each `Documented local-container flow` scenario against the section and by `scripts/advertised-address-documentation.test.mjs`.
- [x] 8.2 Update `docs/operations/docker-image-release.md` for both image names and the release-only `latest` rule, and `apps/terminay-cli/README.md` for the image and `--public-host`. Verified by `scripts/ghcr-image.test.mjs`.
- [x] 8.3 Add the ADR-0034 row to `openspec/adr/README.md`. Verified by the index listing it.
- [ ] 8.4 Update the installation page on `terminay.com` with the image quick start. It lives in another repository. Verified by the published page showing the two-command flow.

## 9. Close out

- [x] 9.1 `openspec validate --all` passes. Verified by its output.
- [ ] 9.2 Open the pull request on `origin` and read back every commit status. Verified by each being `success` or `skipped`.
