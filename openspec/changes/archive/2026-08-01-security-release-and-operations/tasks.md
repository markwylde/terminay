## 1. Security review

- [x] 1.1 Threat-model local bootstrap, WebRTC authentication, the host bridge,
  the UI bundle, filesystem scope, MCP tokens, the vault, migrations, logs, and
  updates, verified by a recorded model with no unresolved critical or high
  boundary issue
- [x] 1.2 Fuzz protocol validators plus local-control and application framing,
  verified by the fuzz suites terminating on bounded rejections
- [x] 1.3 Validate inbound relay JSON and bounded renderer-to-relay serialization
  through a 128 KiB, depth- and field-limited boundary rejecting unsafe prototype
  keys, cycles, invalid UTF-8, and malformed message types, verified by
  `electron/remote/signalingBoundary.ts` and
  `scripts/task20-signaling-security.test.mjs`
- [x] 1.4 Test privilege escalation across server, device, project, view, and
  session ids, verified by rejection assertions per identity
- [x] 1.5 Audit CSP, permissions policy, sandbox, navigation, deep links,
  clipboard and dialogs, downloads, and external URLs, verified by
  `scripts/task20-desktop-security-audit.test.mjs` and
  `openspec/adr/evidence/task20-desktop-security-audit.md`
- [x] 1.6 Apply the credential-free HTTPS external-link policy to the legacy
  Electron shell IPC as well as the host bridge, verified by `electron/externalUrl.ts`
  rejecting non-HTTPS schemes, userinfo, and malformed or control URLs and
  normalizing default HTTPS ports
- [x] 1.7 Require trusted top-level Terminay renderer provenance before every
  legacy privileged IPC handler executes, including terminal, filesystem,
  dictation, agent-status, quick-push, AI metadata, recording, settings, macro,
  secret, remote-host, shell, clipboard, remote-connection, update, and
  edit-window IPC, verified by `electron/trustedIpcSender.ts` and
  `scripts/trusted-ipc-sender.test.mjs` rejecting subframes, foreign origins, and
  unregistered windows before payload handling
- [x] 1.8 Extend the trusted sender boundary to Remote Access administration,
  native auxiliary-window opening, and secret-vault IPC, keeping the hidden WebRTC
  host excluded, verified by the focused source and behavioural coverage
- [x] 1.9 Audit the dedicated remote connection window for an ephemeral isolated
  session with no preload, denied webviews, new windows, downloads, and
  permissions, and guarded frame, navigation, and redirect escape paths, verified
  by `scripts/task20-desktop-security-audit.test.mjs`
- [x] 1.10 Harden every static web-host response with a local-content CSP,
  anti-framing, MIME-sniffing, referrer, and restricted-capability policy that
  still permits user-selected HTTP(S)/WS(S) server connections, verified by
  `docker/nginx.web.conf` and `scripts/web-image.test.mjs`
- [x] 1.11 Harden every unauthenticated health-probe success and error response
  with inert CSP, anti-framing, MIME-sniffing, no-referrer, same-origin
  resource-policy, and restrictive `Permissions-Policy` headers, verified by
  `apps/terminay-server/src/healthServer.ts` and
  `apps/terminay-server/test/health-server.test.mjs`
- [x] 1.12 Audit the privileged Electron source tree for native-dialog exposure,
  verified by proving no source imports or accesses Electron's `dialog`
- [x] 1.13 Keep the unprivileged project-tab drag-preview window explicitly
  sandboxed, context-isolated, Node-free, webview-free, and input-inert with no
  preload, verified by `electron/main.ts` and the Desktop security audit
- [x] 1.14 Verify revocation, lockout, expiry, rate limits, replay protection,
  and redaction under concurrent failure, verified by
  `apps/terminay-server/test/security-revocation-replay.test.mjs`
- [x] 1.15 Run JavaScript dependency, license, SBOM, and vulnerability checks and
  inventory native-binary provenance, verified by a zero-advisory
  lockfile/license/SPDX/npm-audit gate and the recorded rejection of the
  `node-datachannel` candidate for its unresolved OpenSSL finding

## 2. Release-workflow hardening

- [x] 2.1 Keep the release workflow's default token read-only and grant
  `contents: write` only to jobs that create a tag, upload assets, or edit
  release notes, verified by `scripts/task20-ci-security.test.mjs`
- [x] 2.2 Set `persist-credentials: false` on every checkout and use only
  explicit step-scoped tokens, supplying the immutable source commit as the
  GitHub Releases API `target_commitish`, verified by the CI security and release
  config tests
- [x] 2.3 Scope the optional AI release-notes credential to its availability probe
  and generation step, stream release context over stdin, and select a
  deterministic changelog when the generator is unavailable or fails, verified by
  `scripts/generate-release-notes.mjs` and `scripts/release-config.test.mjs`
- [x] 2.4 Require a workflow-wide `bash -euo pipefail` contract and an explicit
  finite timeout on every job, verified by the CI security test
- [x] 2.5 Serialize release publication behind one stable concurrency group and
  refuse cancellation of an in-flight write-capable release, verified by the CI
  security test
- [x] 2.6 Require the release job to select exactly one newly created canonical
  semantic-version tag that still resolves to the captured source commit, emit
  `no_release=true` for a no-op, and fail on ambiguous or moved tags, verified by
  the CI security test
- [x] 2.7 Require every packaging lane to check out that exact tag and prove both
  `HEAD` and the tag target still equal the captured commit before dependency
  installation, version synchronization, or packaging, verified by the CI
  security test
- [x] 2.8 Synchronize root and standalone-server package versions and lockfile
  entries through one JSON-aware script, forbidding inline shell-embedded JSON
  rewrites, verified by `scripts/sync-package-version.mjs` and
  `scripts/release-config.test.mjs`
- [x] 2.9 Exclude hidden files from every release workflow-artifact upload,
  verified by the CI security test

## 3. Artifact integrity and publication handoffs

- [x] 3.1 Reject a local release candidate unless its artifact, embedded server,
  and embedded UI semantic versions match exactly, verified by
  `scripts/task20-release-lifecycle.test.mjs`
- [x] 3.2 Generate SHA-256 sidecars naming only the payload basename for every
  Desktop and standalone asset, verify them from the payload directory before
  both upload handoffs, and refuse an existing GitHub Release asset name rather
  than replacing bytes, verified by the CI security test
- [x] 3.3 Require deterministic tag-derived selection of exactly one artifact per
  lane before checksumming or upload, verified by stale, duplicate, and
  wrongly-versioned candidates failing closed
- [x] 3.4 Refuse symlinked Desktop and standalone payloads, sidecars, and detached
  signatures at selection, checksum creation and verification, and final upload,
  verified by the CI security test
- [x] 3.5 Mount the exact tag-derived macOS candidate DMG read-only, require
  exactly one real `Terminay.app` with a real expected executable, and verify
  strict code signature, Apple team identity, Gatekeeper assessment, and
  notarization staple before checksumming or upload, verified by the CI security
  test
- [x] 3.6 Submit the final DMG container to Apple's notary service, wait for
  acceptance, and staple its ticket before validating the publishable image,
  verified by the CI security test
- [x] 3.7 Prove the built macOS application's microphone entitlement is enabled and
  its usage disclosure non-empty before accepting the DMG candidate, verified by
  the CI security test
- [x] 3.8 Require release-note publication to reject any stale or substituted
  attachment, download the exact published macOS and Linux assets, and validate
  their bytes against the published sidecars before presenting links, verified by
  the CI security test
- [x] 3.9 Check out the immutable release tag without persisted credentials in the
  final publication job and use that reviewed source's verifier for detached
  standalone signatures, verified by the CI security test
- [x] 3.10 Build the standalone server from the exact release tag, pack exactly one
  version-derived archive, exercise the extracted CLI's version output, verify its
  sidecar, and attach both immutable names before release notes advertise them,
  verified by `scripts/standalone-artifact.mjs` and the CI security test
- [x] 3.11 Verify a real packed standalone archive has no duplicate, traversal,
  link, device, special-file, or group/world-writable entries, contains only
  `package/` paths, and binds its CLI, MCP, and integrity payloads to matching
  exact-size SHA-256 manifest declarations, verified by
  `scripts/task20-standalone-release-archive.test.mjs`
- [x] 3.12 Create an Ed25519 detached signature for the exact checksummed
  standalone archive, verify it before both upload handoffs, publish it beside the
  archive, and re-verify the downloaded pair, verified by
  `scripts/release-signature.mjs` and `scripts/release-signature.test.mjs`
- [x] 3.13 Verify a detached Ed25519 signature covers the exact file-backed
  artifact manifest and fails closed after payload tampering, verified by
  `scripts/task20-release-artifact.test.mjs`
- [x] 3.14 Prove a root-authenticated Ed25519 key distribution verifies detached
  artifacts without trusting artifact-bundled keys and fails closed for
  substituted, tampered, revoked, expired, and algorithm-confused keys, and
  recomputes the artifact bytes' SHA-256, verified by
  `scripts/task20-signature-key-distribution.test.mjs`
- [x] 3.15 Bind published-artifact evidence to the recorded artifact SHA-256,
  reject a publication instant predating the native-runner record, resolve the
  signer through the root-authenticated distribution, and require the exact
  release-manifest bytes at the external publication gate, verified by
  `scripts/task20-release-evidence.test.mjs`
- [x] 3.16 Verify the local Desktop/standalone artifact manifest records exact
  named entrypoint paths, sizes, and SHA-256 bytes with a zero-violation
  workspace import-boundary digest, verified by
  `scripts/task20-release-artifact.test.mjs` and `scripts/release-readiness.test.mjs`
- [x] 3.17 Reconcile the packaged embedded-server topology with the workspace
  import gate so only Desktop `main` may import the public `@terminay/server`
  entrypoint, verified by `scripts/check-workspace-boundaries.mjs`
- [x] 3.18 Treat a staged artifact ID as immutable and refuse a substituted symlink
  artifact root, manifest, or payload using `lstat` on each security-relevant
  path, verified by `scripts/task20-release-artifact.test.mjs`

## 4. Native runner and WebRTC candidate evidence

- [x] 4.1 Require separate non-container Linux x64 and arm64 CI lanes to prove
  runner, kernel, and Node architecture before building the server and running
  packed standalone and node-pty probes, verified by
  `scripts/task20-native-runner-contract.test.mjs`
- [x] 4.2 Verify the reviewed Desktop release matrix maps macOS only to DMG and
  Linux only to AppImage and agrees with the package and builder commands and
  artifact naming, verified by `scripts/task20-release-platform-contract.test.mjs`
- [x] 4.3 Write and upload a machine-readable native-runner evidence record only
  after the probes pass, binding target, runner/Node/kernel architecture, Node
  version, exact commit, and the produced archive's byte length and SHA-256, and
  refuse to record from a dirty worktree, verified by
  `scripts/record-native-runner-evidence.test.mjs`
- [x] 4.4 Provide a fail-closed verifier for an acquired native-runner record
  against the exact regular archive, expected target, and immutable commit,
  verified by substituted-archive, symlinked-record, and cross-target rejections
- [x] 4.5 Require the native production-WebRTC evidence matrix to reject a movable
  hosted-signaling ref and verify its clean checkout resolves to the configured
  full commit SHA, verified by the CI security test
- [x] 4.6 Pack two independently generated secure-Werift candidates and require
  byte-identical distributable archives alongside a pinned graph, notices, source
  correspondence, SBOM, and file hashes, verified by
  `scripts/production-headless-webrtc-secure-werift.test.mjs`
- [x] 4.7 Bind every candidate payload to a deterministic, file-hash-verified
  in-toto/SLSA provenance statement with pinned npm and upstream-git materials
  included in the checksum manifest, verified by the same suite
- [x] 4.8 Require a fail-closed candidate verifier rejecting symlinks, malformed or
  duplicate checksum paths, uncovered or extra payload files, checksum tampering,
  and mismatched provenance, verified by the same suite
- [x] 4.9 Record a bounded owner-led vulnerability response policy for the pinned
  candidate with a release-selection block for unresolved critical or high issues,
  verified by `scripts/task20-secure-werift-vulnerability-response.test.mjs`
- [x] 4.10 Prove the locked candidate interoperates with Chromium's native
  `RTCPeerConnection` through a disposable local hosted relay, pairing, opening
  the legacy compatibility channels, reconnecting, and being denied after
  revocation while rejecting a browser WebRTC shim, verified by
  `e2e/webrtc-headless-node-host.spec.ts`
- [x] 4.11 Expose aggregate-only server-host setup measurements and prove a
  concurrent three-peer direct/TURN-configured probe is bounded and fully cleaned
  up without retaining device, peer, pairing, signaling, or payload identifiers,
  verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`
- [x] 4.12 Stage and verify the exact candidate selection and governed patch in the
  native Linux x64/arm64 production-WebRTC matrix, running direct and
  ephemeral-coturn relay-only profiles with fail-closed runner/commit, route,
  queue-rejection, peer-crash, and post-close resource verification, verified by
  `scripts/verify-native-webrtc-load-evidence.test.mjs`

## 5. Reliability, load, and responsiveness

- [x] 5.1 Load-test many PTYs, clients, watches, agent events, file transfers,
  recordings, and reconnects with bounded memory and queues, verified by
  `scripts/task20-multi-resource-load.test.mjs` staying inside a 64 MiB
  heap-growth ceiling and a 30-second latency ceiling with zero live PTYs, data,
  or reconnect queues after cleanup
- [x] 5.2 Prove a bounded deterministic PTY/client/event pressure probe with fixed
  replay and queue bounds and repeatable cleanup metrics, verified by
  `scripts/task20-bounded-load.test.mjs`
- [x] 5.3 Prove per-terminal subscriber admission is bounded: the probe fills the
  five-client capacity, rejects one additional authenticated subscriber per PTY
  with `subscriber_limit`, and completes each detach/resume cycle without
  retaining an excess subscriber, verified by the same suite
- [x] 5.4 Prove a deterministic concurrent matrix of terminal, file-watch, agent,
  file-viewer, recording, and reconnect pressure retains fixed per-lane queue
  bounds, coalesces only data lanes, prioritizes reconnects, and recovers every
  client, verified by `scripts/task20-matrix-load.test.mjs`
- [x] 5.5 Prove the matrix drains every retained update within a fixed four-frame
  cleanup bound, empties both data and reconnect queues, and accounts for every
  produced update as applied or explicitly coalesced, verified by the same suite
- [x] 5.6 Prove no lane can be starved: every applied latest-value update stays
  inside a fixed four-frame retention-age bound and a zero-frame profile fails
  closed, verified by the same suite
- [x] 5.7 Test Desktop and server crash loops, sleep, network changes, disk full,
  corrupt and read-only state, provider failure, signaling outage, and TURN
  outage, verified by the 20-test matrix in
  `scripts/server-state-sqlite-crash.test.mjs`
- [x] 5.8 Prove read-only, permission-denied, and full-disk SQLite states stay
  queryable while a complete new workspace revision is rejected without partial
  canonical mutation, and one fresh complete revision is accepted after recovery,
  verified by the same suite
- [x] 5.9 Prove the bounded Desktop Local supervisor crash/restart boundary:
  concurrent starts coalesce, crashed authorities require explicit recovery,
  recovery is serialized, and shutdown is idempotent, verified by
  `scripts/task20-crash-restart.test.mjs`
- [x] 5.10 Prove three real standalone-server crash/restart cycles release each
  health listener and recover the same data root, verified by the same suite
- [x] 5.11 Prove deterministic provider, signaling, and TURN outage models cap
  retries, close every failed resource before retry, allocate only after a fresh
  recovered resource, and close recovered resources exactly once on shutdown,
  verified by `scripts/task20-provider-outage.test.mjs`,
  `scripts/task20-outage-signaling.test.mjs`, and
  `scripts/task20-turn-outage.test.mjs`
- [x] 5.12 Prove a deterministic sleep/network transition model coalesces offline
  reconnect demand to one bounded request, allocates nothing while offline or
  asleep, recovers with exactly one fresh generation after wake, and rejects the
  stale completion, verified by `scripts/task20-sleep-network.test.mjs`
- [x] 5.13 Prove wall-clock rollback cannot extend a lease, monotonic elapsed time
  expires it, a forward jump fails closed, and a later rollback cannot revive it,
  verified by `scripts/task20-clock-failure.test.mjs`
- [x] 5.14 Verify desktop and mobile UI responsiveness while background streams
  run, verified by `e2e/task20-desktop-stream-responsiveness.spec.ts` across the
  real Electron renderer, touch-enabled mobile Chromium, and the wide/narrow
  browser-shell matrix with fixed interaction, animation-frame, queue,
  inert-content, failure-containment, and cleanup bounds
- [x] 5.15 Prove a deterministic shared-UI scheduler budget at fixed 60 Hz frames
  prioritizes input, coalesces background updates, stays inside the frame budget,
  and drains all queues, verified by `scripts/task20-responsiveness.test.mjs`
- [x] 5.16 Prove high-frequency untrusted stream payloads remain inert text and a
  failing background stream is contained without page errors or unsafe DOM
  injection at wide and narrow viewports, verified by
  `e2e/task20-untrusted-stream-responsiveness.spec.ts` and
  `e2e/task20-background-stream-failure.spec.ts`
- [x] 5.17 Prove a 10,000-message background stream has an eight-message/16 KiB
  bounded queue, one inert output node, coalesced excess messages, and responsive
  route navigation, verified by `e2e/task20-queue-bounds.spec.ts`
- [x] 5.18 Add telemetry-free local diagnostics and opt-in support-bundle
  redaction, verified by the diagnostics suites asserting no network egress and
  redacted bundle contents

## 6. Install, upgrade, and update behaviour

- [x] 6.1 Test clean install, upgrade, rollback, and incompatible-version recovery
  against the file-backed release harness, verified by
  `scripts/task20-release-artifact.test.mjs` preserving server identity and data
  root and leaving the active pointer unchanged for an incompatible candidate
- [x] 6.2 Verify activation validates the staged artifact before changing the
  active pointer, rollback validates the exact prior artifact before switching
  back, and selected entrypoints match the verified manifest, verified by the same
  suite
- [x] 6.3 Prove a compatibility decision preserves the exact server identity for
  forward-compatible upgrades and recovers the same active installation without
  mutation on protocol, schema, migration, or non-newer incompatibility, verified
  by `scripts/task20-upgrade-compatibility.test.mjs`
- [x] 6.4 Define independent Desktop-host and standalone-server update behaviour
  that never silently replaces a remote server, verified by
  `docs/operations/release-update-policy.md` and
  `scripts/task20-release-lifecycle.test.mjs`
- [x] 6.5 Confirm the direct server-bundled UI remains usable during a host-version
  mismatch while the compatibility matrix rejects an incompatible Desktop host,
  verified by `scripts/task20-direct-ui-mismatch.test.mjs`

## 7. Container and image packaging

- [x] 7.1 Verify the local Docker server and web images, non-root server
  entrypoint, read-only-root server Compose profile, unauthenticated
  liveness/readiness contract, and authenticated web-proxied local protocol with a
  real local image build and server-restart smoke, verified by
  `apps/terminay-server/test/docker-contract.test.mjs` and
  `scripts/docker-compose-web-server-smoke.test.mjs`
- [x] 7.2 Run the static web Compose service with a read-only root filesystem, no
  Linux capabilities, `no-new-privileges`, bounded in-memory nginx cache and run
  directories, and its own `/healthz` gate, verified by the smoke inspecting the
  actual container `HostConfig` before exercising the proxy
- [x] 7.3 Verify the GHCR server and static-web image workflow keeps version,
  commit, and default-branch tags, Linux amd64/arm64 manifests, SBOM and
  provenance, and no pull-request publication, verified by
  `scripts/ghcr-image.test.mjs`

## 8. Operations and documentation

- [x] 8.1 Document data and log paths, configuration precedence, firewall,
  STUN/TURN, service-manager setup, pairing, revocation, vault unlock, backup and
  restore, upgrade, rollback, and incident diagnostics, verified by
  `docs/operations/standalone-server.md` and
  `docs/operations/release-update-policy.md`
- [x] 8.2 Provide example systemd and launch service configuration without hiding
  foreground server behaviour, verified by the standalone server runbook
- [x] 8.3 Add release-smoke definitions and hosted deployment-order contract
  checks, verified by `scripts/standalone-server-artifact-ci.test.mjs` and
  `scripts/hosted-deployment-order.test.mjs`
- [x] 8.4 Decide from release evidence whether separate repositories improve
  ownership or cadence, verified by
  `openspec/adr/evidence/repository-ownership-release.md` recording that the
  matched Desktop/server/UI/protocol workspace stays together with the hosted
  signaling service as the separate deployment boundary
- [x] 8.5 Move completed task files to the archive with zero unchecked items and
  repoint active-task dependency links to their archived records, verified by
  `scripts/task19-20-audit.test.mjs`
