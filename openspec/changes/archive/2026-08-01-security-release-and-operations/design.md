## Context

See proposal.md for why release readiness needed cross-boundary proof rather
than assertions. The evidence boundary for this work is recorded in
`openspec/adr/evidence/task19-20-release-migration-audit.md`.

A recurring theme runs through every slice below: almost all of the evidence
gathered here is *local* — static workflow contracts, deterministic harnesses,
virtual scheduling models, and in-memory doubles. Each item was recorded with an
explicit statement of what it does and does not prove, so that a workflow-contract
proof could never be mistaken for a successful signed release run. That
distinction is the main design decision of this change.

## Goals / Non-Goals

Goals:
- No unresolved critical or high boundary issue at any privileged boundary.
- Deterministic, repeatable evidence for failure, load, and recovery behaviour.
- A release supply chain that fails closed at every handoff.
- Operator documentation sufficient to run, back up, recover, and upgrade a
  standalone server.

Non-Goals:
- Executing a hosted signed and notarized release. That, along with native
  release-runner execution on every supported architecture, sustained
  multi-peer WebRTC and TURN measurement, physical disk exhaustion, physical
  device sleep, and Safari/iOS interoperability, was deliberately kept as an
  operational and release follow-up rather than being classified as incomplete
  repository implementation.
- Replacing the existing product behaviour of any workspace feature.

## Decisions

### Trust boundaries

- **Renderer provenance is checked before payload handling.** Every legacy
  privileged IPC handler — project, window, test, MCP, terminal, filesystem,
  dictation, agent status, quick push, AI metadata, recording, settings, macro,
  secret, remote host, shell, clipboard, remote connection, update, and edit
  window — first requires a trusted top-level Terminay renderer. Subframes,
  foreign origins, and unregistered `BrowserWindow`s are rejected before the
  payload is read, so a malformed or hostile payload never reaches a validator
  belonging to a caller that was not entitled to call at all. The dedicated
  server-UI host is an explicit, stricter bound-window/origin exception, and the
  hidden WebRTC host is deliberately excluded even though it loads an app asset.
- **The signaling boundary validates before parsing meaning.** Inbound relay
  JSON and bounded renderer-to-relay serialization pass a 128 KiB, depth- and
  field-limited boundary that rejects unsafe prototype keys, cycles, invalid
  UTF-8, and malformed message types. Signaling is the one surface reachable by
  an unauthenticated hosted service, so it gets a size and shape gate before any
  interpretation.
- **External URLs are credential-free HTTPS, normalized in one place.** A shared
  normalizer rejects non-HTTPS schemes, userinfo, malformed and control-character
  URLs, and normalizes default HTTPS ports before `shell.openExternal`. Both the
  legacy shell IPC and the newer host bridge use it, because two normalizers
  would eventually disagree.
- **Auxiliary windows are contained explicitly, not by default.** The remote
  connection window uses an ephemeral isolated session with no preload and denies
  webviews, new windows, downloads, and permissions, with frame, navigation, and
  redirect escapes guarded to the pairing origin. The unprivileged project-tab
  drag-preview window — a generated `data:` surface — is explicitly sandboxed,
  context-isolated, Node-free, webview-free, and input-inert. Relying on
  `BrowserWindow` defaults was treated as an open gap.
- **Unauthenticated surfaces carry inert policy on every response.** The static
  web host and the health probe both set CSP, anti-framing, MIME-sniffing,
  referrer, resource-policy, and restrictive `Permissions-Policy` headers on
  success *and* on 404, 405, and 503, since an error page is just as reachable.
  The web CSP still permits user-selected HTTP(S) and WS(S) Terminay Server
  connections while restricting executable and document content to the web image
  origin.
- **No native dialog path exists.** The audit confirmed no source imports or
  accesses Electron's native `dialog` capability, so there is no
  renderer-controlled native dialog path pending a dedicated reviewed boundary.

### Reliability and performance

- **Bounded admission over unbounded queues.** Per-terminal subscriber admission
  is capped: the pressure probe fills the configured five-client capacity and
  rejects the next authenticated subscriber per PTY with `subscriber_limit`,
  while each detach and resume cycle completes without retaining an excess
  subscriber. Fixed per-lane queue bounds coalesce only data lanes, prioritize
  reconnects, and drain within a fixed four-frame cleanup bound.
- **Fairness is asserted, not assumed.** Every applied latest-value update stays
  inside a fixed four-frame retention-age bound, and a zero-frame profile fails
  closed, so no lane can be starved by sustained pressure in another.
- **Measured envelope.** Six representative load iterations covered 24 real
  server-core PTYs, 120 terminal subscriptions, 12 concurrent projection clients,
  67,392 updates, 679,477,248 logical file-transfer bytes, and 84,934,656 logical
  recording bytes under a 64 MiB heap-growth ceiling and a 30-second latency
  ceiling, with complete accounting, client recovery, and zero live PTYs, data,
  or reconnect queues after cleanup.
- **Failure is exercised as a matrix.** A 20-test focused matrix covers the
  serialized Desktop supervisor, three real standalone child crash and restart
  cycles, interrupted, corrupt, read-only, permission-denied, and
  capacity-constrained SQLite state, provider, signaling, and TURN failures,
  sleep and network transitions, and clock rollback and forward jumps.
- **State mutations are all-or-nothing at the storage boundary.** A read-only,
  permission-denied, or full-disk SQLite state remains safely queryable while a
  complete new workspace revision is rejected without any partial canonical
  mutation, and one fresh complete revision is accepted once capacity or
  permissions return.
- **Leases use monotonic time.** A wall-clock rollback cannot extend a lease,
  monotonic elapsed time expires it, a forward jump fails closed, and a later
  rollback cannot revive it.
- **Untrusted stream payloads stay inert.** At wide and narrow viewports,
  high-frequency untrusted payloads render as text rather than markup, a failing
  background stream is contained without page errors or unsafe DOM injection, and
  a 10,000-message stream is held to an eight-message/16 KiB bounded queue with a
  single inert output node while route navigation stays responsive.

### Release supply chain

- **Least privilege by default.** The release workflow's default token is
  read-only; `contents: write` is granted only to the jobs that create a tag,
  upload release assets, or edit release notes. Every checkout sets
  `persist-credentials: false`, and release mutation uses explicit, step-scoped
  token environment values. The release script supplies the immutable source
  commit as the GitHub Releases API `target_commitish`, so the tag is created
  without relying on a credential persisted by checkout; a direct `git push`
  remains only as the non-Actions fallback.
- **Optional credentials are scoped to their step.** The AI release-notes
  provider credential reaches only its availability probe and generation step;
  the public release path receives a boolean availability output, and the
  credential-free fallback never receives the secret. Release context is streamed
  over stdin rather than a size-limited process argument, and the generator calls
  the provider's HTTP API directly rather than depending on an npm package's
  lifecycle-installed executable. An unavailable or failed generator yields a
  deterministic changelog from the exact bounded release range instead of
  blocking verified artifacts.
- **Every step fails closed.** A workflow-wide `bash -euo pipefail` contract and
  an explicit finite timeout on every job — including the write-capable tag,
  binary, and release-notes jobs — mean a command failure, an unset variable, a
  broken pipeline, or a stalled runner cannot continue into packaging or
  publication or retain release authority.
- **Publication is serialized and uninterruptible.** One stable
  workflow-concurrency group serializes release publication and refuses
  cancellation of an in-flight write-capable release.
- **The tag is the identity.** The release job selects exactly one newly created
  canonical semantic-version tag rather than reusing a prior tag pointing at
  `HEAD`, and proves it still resolves to the source commit captured before
  creation. Every packaging lane checks out that exact tag and proves both its
  `HEAD` and the tag's commit target still equal that captured commit before
  installing dependencies, synchronizing versions, or packaging. A no-op release
  emits `no_release=true`; ambiguous or moved tags fail before packaging.
- **Bytes are bound to names at every handoff.** Each Desktop and standalone
  asset gets a SHA-256 sidecar naming only its payload basename, verified from
  the payload directory before workflow-artifact upload, again before GitHub
  Release upload, and again after download by the release-notes job. Existing
  asset names are refused rather than silently replaced. Deterministic
  tag-derived selection precedes checksumming, so a stale, duplicate, or
  wrongly-versioned artifact fails closed instead of being swept up by a glob.
  Symlinked payloads and sidecars are refused at selection, checksum creation and
  verification, and final upload. Hidden files are excluded from every
  workflow-artifact upload.
- **macOS verification targets the exact publishable image.** The workflow mounts
  the tag-derived candidate DMG read-only, requires it to contain exactly one
  real `Terminay.app` with a real expected executable, and verifies strict code
  signature, configured Apple team identity, Gatekeeper assessment, and
  notarization staple before checksumming or upload. The final DMG container is
  itself submitted to Apple's notary service and stapled, because app
  notarization during packaging does not create a ticket for a subsequently built
  DMG. The packaging lane also proves the built application's microphone
  entitlement is enabled and its usage disclosure non-empty.
- **Version synchronization is JSON-aware.** Root and standalone-server package
  versions and their lockfile entries are synchronized by one JSON-aware script;
  inline shell-embedded JSON rewrites are forbidden because escaped newline text
  can corrupt the manifest.
- **Standalone artifacts are signed and structurally checked.** A real packed
  archive is verified to contain only `package/` paths with no duplicate,
  traversal, link, device, special-file, or group/world-writable entries, and to
  bind its CLI, MCP, and integrity payloads to matching exact-size SHA-256
  manifest declarations. An Ed25519 detached signature covers the exact
  checksummed archive, is verified before both upload handoffs, published beside
  the archive, and re-verified after download; the private signing material is
  scoped to the signing step.
- **Signature verification is root-authenticated and recomputes digests.**
  Detached artifact verification resolves its signer through a root-authenticated
  Ed25519 key distribution rather than trusting artifact-bundled keys, fails
  closed for substituted, tampered, revoked, expired, or algorithm-confused keys
  (a key merely labelled Ed25519 whose parsed SPKI type differs), and recomputes
  the supplied artifact bytes' SHA-256 instead of echoing a claimed digest.
- **Published-artifact evidence cannot be relabelled.** An immutable publication
  URI whose digest differs from the verified bytes is rejected, a publication
  instant predating the completed native-runner record for the same artifact is
  rejected, and the external publication gate must receive the exact release
  manifest bytes and verify their SHA-256 against the evidence record before
  accepting a signature.
- **Native-runner evidence is bound to a clean commit.** Separate non-container
  Linux x64 and arm64 lanes prove runner, kernel, and Node architecture before
  building and probing, then write a machine-readable record binding target,
  architectures, Node version, exact Git commit, and the produced archive's byte
  length and SHA-256, refusing to record from a worktree with tracked changes or
  non-ignored untracked files. A fail-closed verifier rejects substituted
  archives, symlinked records, and cross-target or cross-commit evidence.
- **Staged artifact IDs are immutable.** An existing staged artifact directory is
  rejected before any payload write, and the verifier `lstat`s each
  security-relevant path so matching bytes outside the immutable artifact
  directory cannot satisfy a manifest.
- **Install, upgrade, and rollback preserve identity.** Activation validates the
  staged artifact before changing the active pointer, rollback validates the
  exact prior artifact before switching back, selected entrypoints must match the
  verified manifest, and the server identity and data root survive both. An
  incompatible candidate leaves the active pointer unchanged, and a
  protocol, schema, migration, or non-newer incompatibility recovers the same
  active installation without mutation.
- **Desktop and standalone update independently.** The update policy preserves
  local server identity and data roots and rejects replacing a remote server.
  The direct server-bundled UI stays usable during a host-version mismatch while
  the compatibility matrix rejects an incompatible Desktop host.

### WebRTC runtime candidacy

- **Candidates are reproducible and attested locally.** Two independently
  generated secure-Werift candidates must pack to byte-identical distributable
  npm archives, on top of a pinned dependency graph, notices, source
  correspondence, SBOM, and file hashes. Each payload is bound to a
  deterministic, file-hash-verified in-toto/SLSA provenance statement with pinned
  npm and upstream-git materials, included in the candidate's checksum manifest,
  and gated by a fail-closed verifier that rejects symlinks, malformed or
  duplicate checksum paths, uncovered or extra payload files, checksum tampering,
  and provenance differing from the reviewed payload.
- **The cross-repository evidence ref is pinned.** The native Linux
  production-WebRTC evidence matrix rejects a movable hosted-signaling ref and
  verifies its clean checkout resolves to the configured full commit SHA.
- **`node-datachannel` was rejected as a candidate** for an unresolved OpenSSL
  finding recorded in the native-binary provenance inventory. The JavaScript
  lockfile, license, SPDX, and npm-audit gate passes with zero advisories.
- **A bounded owner-led vulnerability response policy** covers private intake,
  critical and high acknowledgement and disposition limits, immutable candidate
  and source recording, and a release-selection block for unresolved critical or
  high issues.
- **Browser interoperability is proven for Chromium only.** The locked candidate
  pairs with Chromium's native `RTCPeerConnection` through a disposable local
  hosted relay, opens the legacy compatibility data channels, reconnects, and is
  denied after revocation; the proof rejects a browser WebRTC shim before
  pairing.

### Repository ownership

- **Keep the workspace together.** Release evidence showed that separate
  repositories did not improve ownership or cadence for the matched
  Desktop/server/UI/protocol set, so it stays one workspace; the hosted signaling
  service remains the separate deployment boundary.

## Risks / Trade-offs

- Requiring trusted renderer provenance on every legacy IPC handler risks
  breaking a legitimate caller that was previously implicit. This was accepted
  and mitigated by enumerating the eligible windows explicitly and covering the
  exclusions (server-UI host, hidden WebRTC host) with focused source and
  behavioural tests.
- Most evidence here is local and deterministic rather than executed on native
  release hardware. This is a real limitation, deliberately made visible: every
  item states what it does not prove, and the unproven executions are carried as
  operational and release follow-ups rather than silently implied.
- Deterministic and virtual harnesses can drift from native behaviour. The
  mitigation is that native lanes exist in CI and bind their evidence to an exact
  clean commit, so an executed run can later be attributed unambiguously.
- The release workflow is now long and highly constrained; a legitimate release
  can fail for a supply-chain-integrity reason rather than a build reason. That
  is the intended failure direction.

## Migration Plan

Clean install, upgrade, rollback, and incompatible-version recovery were
exercised against a file-backed release harness that stages real artifact
directories, verifies manifest and file hashes and complete file sets, switches
the active release pointer atomically, and preserves server identity and data
root across upgrade and rollback. An incompatible candidate leaves the active
pointer unchanged.

## Open Questions

The following were recorded as operational and release follow-ups, not as
incomplete repository implementation. They require hosted publication systems,
trusted release runners, supported native hardware, notarization services, or
formal release governance:

- Publish signed and notarized Desktop artifacts containing the exact matched
  server and UI, and verified standalone artifacts for supported platforms with
  checksums, signatures, version output, and supply-chain metadata.
- Run the complete PTY and server probes on native Linux x64 and arm64 release
  runners, the packaged Linux x64 AppImage, and macOS arm64 at the supported
  macOS 12 floor, without substituting emulation or configured-but-unrun CI.
- Measure the selected WebRTC runtime under sustained real multi-peer direct and
  TURN traffic, slow consumers, relay loss, peer crashes, and admission-limit
  exhaustion on supported release architectures; both hosted architecture lanes
  must record passing direct and relay-only evidence.
- Produce deterministic WebRTC runtime artifacts with trusted hosted
  attestations, formal candidate selection, and complete supported-architecture
  and browser evidence, including Safari/iOS. The sibling peer owner's
  ticket-bound canonical application bridge remains an external integration
  follow-up.
