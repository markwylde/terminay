# Security, release, and operations

## Goal

Harden, package, document, and release Terminay Desktop with its matched
embedded server plus independently runnable Terminay Server artifacts.

## Governing specifications

- [Terminay core](../CORE.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Why this is active

The finished topology adds a privileged headless runtime, native dependencies,
protocol/version coordination, server-provided UI, device trust, and independent
Desktop/server update paths. Release readiness needs cross-boundary security,
failure, performance, and operational proof.

The current evidence boundary is recorded in
[`task19-20-release-migration-audit.md`](../decisions/evidence/task19-20-release-migration-audit.md).

## Dependencies

- [Migration and compatibility cleanup](../tasks/19-migration-and-compatibility-cleanup.md)

## Work slices

### Security review

- [x] Threat-model local bootstrap, WebRTC auth, host bridge, UI bundle,
  filesystem scope, MCP tokens, vault, migrations, logs, and updates.
- [x] Fuzz protocol validators plus local-control/application framing.
- [x] Fuzz Electron WebRTC signaling message handling and relay framing.
  The privileged service now validates inbound relay JSON and bounded
  renderer-to-relay serialization through a 128 KiB, depth/field-limited
  boundary that rejects unsafe prototype keys, cycles, invalid UTF-8, and
  malformed message types (`electron/remote/signalingBoundary.ts`,
  `scripts/task20-signaling-security.test.mjs`).
- [x] Test privilege escalation across server/device/project/view/session ids.
- [x] Audit CSP, permissions policy, sandbox, navigation, deep links,
  clipboard/dialogs, downloads, and external URLs.
  The focused Desktop audit verifies the server UI CSP/permissions policy,
  isolated/sandboxed primary and server-host windows, same-origin navigation,
  deep-link and external-URL sanitization, gesture-gated clipboard access,
  native-dialog absence, and download denial
  (`scripts/task20-desktop-security-audit.test.mjs`). This is a static local
  policy audit, not native-platform release execution.
  - [x] Verify the existing Desktop host boundary for CSP/permissions,
    same-origin navigation, deep-link sanitization, clipboard capability and
    gesture gates, and credential-free external HTTPS URLs.
    Evidence: `scripts/task20-desktop-security-audit.test.mjs` and
    `specs/decisions/evidence/task20-desktop-security-audit.md`.
  - [x] Apply the credential-free HTTPS external-link policy to the legacy
    Electron shell IPC as well as the newer Desktop host bridge. The shared
    normalizer rejects non-HTTPS schemes, userinfo, malformed/control URLs,
    and normalizes default HTTPS ports before `shell.openExternal`; covered by
    `electron/externalUrl.ts` and
    `scripts/task20-desktop-security-audit.test.mjs`.
  - [x] Require trusted top-level Terminay renderer provenance before every
    legacy privileged IPC handler executes.
    Direct `main.ts` project/window/test/MCP handlers and every registration
    module now check provenance first; the dedicated server-UI host remains an
    explicit stricter bound-window/origin exception. Evidence:
    `electron/trustedIpcSender.ts` and
    `scripts/trusted-ipc-sender.test.mjs`.
  - [x] Require trusted top-level Terminay renderer provenance before the
    registered legacy terminal, filesystem, dictation, agent-status,
    quick-push, AI metadata, recording, settings, macro, secret, remote-host,
    shell, clipboard, remote-connection, update, and edit-window IPC executes.
    Subframes, foreign origins, and unregistered BrowserWindows are rejected
    before payload handling. Evidence: `electron/trustedIpcSender.ts`,
    `scripts/trusted-ipc-sender.test.mjs`, and
    `scripts/task20-desktop-security-audit.test.mjs`.
  - [x] Extend the trusted sender boundary to Remote Access administration,
    native auxiliary-window opening, and secret-vault IPC. Only the registered
    primary/auxiliary Terminay windows are eligible; the hidden WebRTC host is
    deliberately excluded even when it loads an app asset. Focused source and
    behavioural coverage lives in `scripts/task20-desktop-security-audit.test.mjs`
    and `scripts/trusted-ipc-sender.test.mjs`.
  - [x] Audit the dedicated remote connection window: use an ephemeral
    isolated session with no preload, deny webviews/new windows/downloads/
    permissions, and guard frame/navigation/redirect escape paths to the
    pairing origin. Evidence: `scripts/task20-desktop-security-audit.test.mjs`
    and `specs/decisions/evidence/task20-desktop-security-audit.md`.
  - [x] Harden every static web-host response with a local-content CSP,
    anti-framing, MIME-sniffing, referrer, and restricted-browser-capability
    policy. The CSP keeps user-selected HTTP(S)/WS(S) Terminay Server
    connections possible while restricting executable and document content to
    the web image origin. Evidence: `docker/nginx.web.conf` and
    `scripts/web-image.test.mjs`.
  - [x] Harden the unauthenticated health-probe surface on every success and
    error response with inert CSP, anti-framing, MIME-sniffing, no-referrer,
    and same-origin resource-policy headers. Evidence:
    `apps/terminay-server/src/healthServer.ts` and
    `apps/terminay-server/test/health-server.test.mjs`. This covers only the
    probe listener; the broader primary-window and dialog/platform audit
    remains open.
  - [x] Keep the release workflow's default token read-only and grant
    `contents: write` only to the jobs that create a tag, upload release
    assets, or edit release notes. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Ensure every GitHub Actions checkout removes its token from the runner
    Git configuration (`persist-credentials: false`); release mutation uses
    only explicit, step-scoped `GITHUB_TOKEN`/`GH_TOKEN` environment values.
    The release script supplies the immutable source commit as the GitHub
    Releases API `target_commitish`, so GitHub creates the release tag without
    relying on a credential persisted by checkout; a direct `git push` remains
    only as the non-Actions fallback when no API token/repository is present.
    Evidence: all `.github/workflows/*.yml` checkout steps and
    `scripts/task20-ci-security.test.mjs` plus
    `scripts/release-config.test.mjs`.
  - [x] Scope the optional AI release-notes provider credential to its
    availability probe and generation step rather than exposing it to the
    complete release job. The public release path receives only a boolean
    availability output; the credential-free fallback never receives the
    secret. Large release context is streamed to the generator over stdin
    instead of a size-limited process argument, and an unavailable or failed
    optional generator selects the fallback without blocking verified release
    artifacts. Evidence: `.github/workflows/trigger-release.yml`,
    `scripts/generate-release-notes.mjs`, `scripts/release-config.test.mjs`,
    and `scripts/task20-ci-security.test.mjs`.
  - [x] Require every release-workflow shell step to run under a workflow-wide
    fail-closed `bash -euo pipefail` contract, so command, unset-variable, and
    pipeline failures cannot silently continue into packaging or publication.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`. This is a local workflow-contract
    proof only; it does not prove a successful release-runner execution.
  - [x] Bound every release job with an explicit finite timeout, including the
    write-capable tag, binary, and release-notes jobs, so a stalled runner
    cannot retain release authority or block the serialized release indefinitely.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`. This is a local workflow-contract
    proof only; it does not prove a successful release-runner execution.
  - [x] Deny browser capability access on every unauthenticated health-probe
    response, including 404/405/503 error paths, with an explicit restrictive
    `Permissions-Policy`. Evidence:
    `apps/terminay-server/src/healthServer.ts` and
    `apps/terminay-server/test/health-server.test.mjs`.
  - [x] Audit the current privileged Electron source tree for native-dialog
    exposure: no source imports or accesses Electron's native `dialog`
    capability, so no renderer-controlled native dialog path exists pending a
    dedicated reviewed boundary. Evidence:
    `scripts/task20-desktop-security-audit.test.mjs`.
  - [x] Keep the unprivileged project-tab drag-preview window explicitly
    sandboxed, context-isolated, Node-free, webview-free, and input-inert with
    no preload. This closes the otherwise implicit BrowserWindow-defaults gap
    for the generated `data:` preview surface. Evidence:
    `electron/main.ts` and `scripts/task20-desktop-security-audit.test.mjs`.
- [x] Verify revocation, lockout, expiry, rate limits, replay protection, and
  redaction under concurrent failure with deterministic local-control, pairing,
  reconnect, remote-transport, and vault evidence
  (`apps/terminay-server/test/security-revocation-replay.test.mjs`). This does
  not claim fuzzing or sustained load coverage.
- [x] Run JavaScript dependency/license/SBOM/vulnerability checks and inventory
  native-binary provenance.
  The local lockfile/license/SPDX/npm-audit gate passes with zero JavaScript
  advisories; native inventory evidence records the `node-datachannel`
  candidate's binary/source provenance and rejects that candidate for its
  unresolved OpenSSL finding. Secure-Werift selection and release approval
  remain under the unchecked runtime-artifact gate below
  (`specs/decisions/evidence/task20-supply-chain-audit.md`).

### Reliability and performance

- [x] Load-test many PTYs, clients, watches, agent events, file transfers,
  recordings, and reconnects with bounded memory and queues.
  Six representative iterations cover 24 real server-core PTYs, 120 terminal
  subscriptions, 12 concurrent projection clients, 67,392 updates, 679,477,248
  logical file-transfer bytes, and 84,934,656 logical recording bytes with a
  64 MiB heap-growth ceiling, a 30-second latency ceiling, fixed replay/queue
  bounds, complete accounting, client recovery, and zero live PTYs/data/
  reconnect queues after cleanup (`scripts/task20-multi-resource-load.test.mjs`;
  evidence:
  `specs/decisions/evidence/task20-multi-resource-load.md`). This is local
  server-core and deterministic scheduling evidence, not native
  multi-platform, browser-memory, or selected-WebRTC-runtime/TURN evidence.
  - [x] Prove a bounded deterministic PTY/client/event pressure probe with
    in-memory test doubles, fixed replay and queue bounds, and repeatable
    cleanup metrics. This does not claim native multi-platform execution or
    signed artifacts (`scripts/task20-bounded-load.test.mjs`; evidence:
    `specs/decisions/evidence/task20-bounded-load.md`).
  - [x] Prove per-terminal subscriber admission is bounded: the deterministic
    pressure probe fills the configured five-client capacity, rejects one
    additional authenticated subscriber per PTY with `subscriber_limit`, and
    still completes each detach/resume cycle without retaining an excess
    subscriber (`scripts/task20-bounded-load.test.mjs`; evidence:
    `specs/decisions/evidence/task20-bounded-load.md`).
  - [x] Prove a deterministic concurrent matrix of terminal, file-watch,
    agent, file-viewer, recording, and reconnect pressure retains fixed
    per-lane queue bounds, coalesces only data lanes, prioritizes reconnects,
    recovers every client, and has exact repeatable metrics
    (`scripts/task20-matrix-load.test.mjs`). This is virtual scheduling
    evidence, not native multi-platform throughput evidence.
  - [x] Prove the deterministic matrix drains every retained terminal,
    file-watch, agent, file-viewer, and recording update within a fixed
    four-frame cleanup bound after producers stop, leaves both data and
    reconnect queues empty, and accounts for every produced update as either
    applied or explicitly coalesced (`scripts/task20-matrix-load.test.mjs`).
    This is virtual cleanup/retention evidence, not native memory profiling.
  - [x] Prove sustained matrix pressure cannot starve a terminal, file-watch,
    agent, file-viewer, or recording lane: every applied latest-value update
    remains inside a fixed four-frame retention-age bound, and a zero-frame
    profile fails closed (`scripts/task20-matrix-load.test.mjs`). This is
    virtual scheduling fairness evidence, not native throughput measurement.
- Operational/release follow-up: measure the selected WebRTC runtime under sustained real multi-peer
  direct and TURN traffic, slow consumers, relay loss, peer crashes, and
  admission-limit exhaustion on supported release architectures.
  - [x] Expose aggregate-only server-host setup measurements (peak active and
    pending peers, completed setups, total and maximum setup duration) and
    prove a concurrent three-peer direct/TURN-configured probe is bounded and
    fully cleaned up without retaining device, peer, pairing, signaling, or
    payload identifiers (`apps/terminay-server/test/node-datachannel-host.test.mjs`).
    This is a local host-measurement seam, not sustained native multi-peer or
    TURN infrastructure evidence.
  - Operational/release follow-up: run the selected-artifact sustained load harness in direct and relay-only
    coturn modes on every supported release architecture, and compose its real
    peer/channel, slow-consumer, peer-crash, CPU, RSS, queue, and UDP-resource
    cleanup measurements with the admission-exhaustion proof
    (`scripts/task20-secure-werift-multi-peer-load.test.mjs`; harness contract:
    `specs/decisions/evidence/task20-selected-webrtc-load-harness.md`). The
    native Linux x64/arm64 production-WebRTC matrix now stages and verifies the
    exact candidate selection and governed patch, runs both direct and
    ephemeral-coturn relay-only profiles, cleans coturn on success or failure,
    fail-closed verifies the runner/commit, direct and relay routes, queue
    rejection count, one mid-run peer crash followed by a replacement peer on
    the required route, and the post-close resource set, then uploads aggregate
    per-architecture evidence (`.github/workflows/ci.yml`,
    `scripts/verify-native-webrtc-load-evidence.mjs`,
    `scripts/verify-native-webrtc-load-evidence.test.mjs`,
    `scripts/task20-ci-security.test.mjs`). This
    item and its parent remain open until both hosted architecture lanes have
    recorded passing direct and relay-only evidence.
- [x] Test Desktop/server crash loops, sleep, network changes, disk full,
  corrupt/read-only state, provider failure, signaling outage, and TURN outage.
  The 20-test focused matrix covers the serialized Desktop supervisor, three
  real standalone child crash/restart cycles, interrupted/corrupt/read-only/
  permission/capacity-constrained SQLite state, provider/signaling/TURN
  failures, sleep/network transitions, and clock rollback/forward jumps with
  bounded recovery and cleanup (`scripts/server-state-sqlite-crash.test.mjs`;
  evidence:
  `specs/decisions/evidence/task20-crash-failure-matrix.md`). Physical disk
  exhaustion, external provider/hosted-infrastructure incidents, and physical
  device sleep remain outside this deterministic local evidence boundary.
  - [x] Prove a read-only recovered SQLite state remains safely queryable while
    a complete new workspace revision is rejected without any partial canonical
    state mutation (`scripts/server-state-sqlite-crash.test.mjs`). This is a
    deterministic local state-store boundary; it does not claim Desktop,
    filesystem-permission, provider, signaling, or TURN outage coverage.
  - [x] Prove POSIX filesystem permissions reject SQLite mutation while the
    canonical state remains unchanged after permissions are restored
    (`scripts/server-state-sqlite-crash.test.mjs`).
  - [x] Prove a deterministic SQLite full-disk boundary rolls back a complete
    workspace revision without partial canonical mutation, then accepts one
    fresh complete revision after capacity returns
    (`scripts/server-state-sqlite-crash.test.mjs`). This is a local SQLite
    capacity simulation, not a physical-disk, Desktop, provider, signaling,
    or TURN outage exercise.
  - [x] Prove the bounded Desktop Local supervisor crash/restart boundary:
    concurrent starts coalesce, crashed authorities require explicit recovery,
    recovery is serialized without overlapping authorities, and shutdown is
    idempotent (`scripts/task20-crash-restart.test.mjs`; evidence:
    `specs/decisions/evidence/task20-crash-restart.md`).
  - [x] Prove three real standalone-server crash/restart cycles release each
    health listener and recover the same data root: each foreground child
    reaches authenticated runtime readiness, is killed, becomes unreachable,
    and the next child starts cleanly (`scripts/task20-crash-restart.test.mjs`).
    This is local child-process lifecycle evidence, not Desktop sleep/network
    transition, physical disk-full, provider, signaling, or TURN-outage proof.
  - [x] Prove a deterministic provider-outage model caps retries, allocates a
    fresh recovery resource only after each failed resource is closed, and
    closes both failed and recovered resources exactly once
    (`scripts/task20-provider-outage.test.mjs`). This is virtual provider
    lifecycle evidence, not a live provider outage exercise.
  - [x] Prove that a transient authenticated signaling outage fails closed
    without native-peer/session retention, records the failed attempt, and
    permits a later fresh authenticated connection to recover and close its
    relay subscription normally (`scripts/task20-outage-signaling.test.mjs`).
    This is a deterministic server-side signaling boundary and does not claim
    a hosted TURN or Desktop network-transition exercise.
  - [x] Prove a deterministic TURN-allocation outage closes every failed
    allocation before retry, allocates signaling and a peer only after one
    fresh recovered allocation, and closes the recovered allocation on
    shutdown (`scripts/task20-turn-outage.test.mjs`). This is a local virtual
    allocation boundary, not hosted TURN infrastructure or Desktop
    network-transition evidence.
  - [x] Prove a deterministic sleep/network transition model coalesces offline
    reconnect demand to one bounded request, allocates no connection while
    offline or asleep, closes an interrupted attempt, recovers with exactly one
    fresh generation after wake, and rejects the stale completion
    (`scripts/task20-sleep-network.test.mjs`; evidence:
    `specs/decisions/evidence/task20-sleep-network.md`). This is a virtual
    lifecycle boundary, not native Electron power/network integration or
    physical sleep/wake execution.
  - [x] Prove wall-clock rollback cannot extend a lease, monotonic elapsed time
    expires it, a forward jump fails closed, and a later rollback cannot revive
    it (`scripts/task20-clock-failure.test.mjs`).
- [x] Verify desktop and mobile UI responsiveness while background streams run.
  The fresh production artifact passes the real Electron Desktop renderer,
  touch-enabled mobile Chromium, and wide/narrow browser-shell matrix with
  fixed interaction, animation-frame, queue, inert-content, failure-containment,
  and cleanup bounds (`e2e/task20-desktop-stream-responsiveness.spec.ts`;
  evidence:
  `specs/decisions/evidence/task20-desktop-mobile-responsiveness.md`). This is
  Desktop and mobile browser-emulation evidence, not physical mobile-device
  certification.
  - [x] Exercise the real shared browser shell at wide and narrow viewports
    while bounded, coalesced terminal-output, agent-event, file-watch, and
    transfer-progress pressure runs. Route changes and responsive-input updates
    complete while animation frames continue; this is browser-shell evidence,
    not a claim of native Desktop or physical mobile certification
    (`e2e/task20-browser-responsiveness.spec.ts`).
  - [x] Prove a deterministic shared-UI scheduler budget for terminal output,
    agent events, file-watch updates, and transfer progress: fixed 60 Hz
    frames prioritize input, coalesce background updates, stay inside the
    frame budget, and drain all queues. This is platform-neutral local model
    evidence and does not claim native Desktop/mobile responsiveness
    (`scripts/task20-responsiveness.test.mjs`; evidence:
    `specs/decisions/evidence/task20-responsiveness.md`).
  - [x] Prove at wide and narrow browser viewports that high-frequency
    untrusted stream payloads remain inert text (rather than injected markup)
    while route interaction remains responsive
    (`e2e/task20-untrusted-stream-responsiveness.spec.ts`). This is shared
    browser-shell evidence, not a claim of native Desktop/mobile certification.
  - [x] Prove at wide and narrow browser viewports that a failing high-frequency
    background stream is contained without page errors or unsafe DOM injection
    while route navigation remains responsive
    (`e2e/task20-background-stream-failure.spec.ts`). This is shared
    browser-shell resilience evidence, not native Desktop/mobile certification.
  - [x] Prove at wide and narrow browser viewports that a 10,000-message
    background stream has an eight-message/16 KiB bounded queue, one inert
    output node, coalesced excess messages, and responsive route navigation
    (`e2e/task20-queue-bounds.spec.ts`). This is browser-shell queue-model
    evidence, not production memory profiling or native certification.
- [x] Add telemetry-free local diagnostics and opt-in support-bundle redaction.

### Artifacts and updates

- Operational/release follow-up: publish signed/notarized Desktop artifacts containing the exact matched
  server and UI.
  The release workflow wires Apple signing/notarization inputs and artifact
  ordering, but no signed/notarized artifact has been executed and verified in
  this workspace.
  - [x] Reject a local release candidate unless its artifact, embedded server,
    and embedded UI semantic versions match exactly. This closes the local
    manifest/evidence mismatch path before candidate installation or upgrade;
    it does not prove a signed or notarized release-runner execution.
    Evidence: `scripts/task20-release-lifecycle.mjs` and
    `scripts/task20-release-lifecycle.test.mjs`.
  - [x] Require the release workflow to generate SHA-256 sidecars for every
    Desktop asset and refuse an existing GitHub Release asset name rather than
    silently replacing bytes on retry. Evidence:
    `.github/workflows/trigger-release.yml` plus the focused local static
    workflow assertion run for this change. This does not prove signing,
    notarization, or publication.
  - [x] Require the release workflow to re-verify every Desktop asset against
    its generated SHA-256 sidecar before either workflow-artifact or GitHub
    Release upload. This protects the runner-local handoff between packaging
    and publication; it does not prove signed publication or a successful
    release-runner execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require the macOS release workflow to mount the exact candidate DMG
    read-only and verify its embedded app's strict code signature, configured
    Apple team identity, Gatekeeper assessment, and notarization staple before
    checksumming or uploading it. This is a local workflow-contract proof;
    it does not prove a successful signed/notarized release-runner execution.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require the mounted macOS candidate DMG to contain exactly one real
    `Terminay.app` with a real expected executable before code-signing,
    Gatekeeper, or notarization checks. This prevents an ambiguous, missing,
    or symlinked bundle from standing in for the exact publishable payload;
    it is a local workflow-contract proof only, not a signed release-runner
    execution. Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require deterministic release-asset selection to complete before the
    macOS signing/notarization verifier runs, and derive that verifier's DMG
    path directly from the release-created tag. This prevents a stale or
    unrelated first-discovered DMG from being verified while a different DMG is
    checksummed or uploaded. This is a local workflow-contract proof only; it
    does not prove a successful signed/notarized release-runner execution.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require the macOS packaging lane to inspect the built application and
    prove its microphone entitlement is enabled and its platform usage
    disclosure is non-empty before accepting the DMG candidate or checksumming
    it. This is a local workflow-contract proof only; it does not prove a
    signed release-runner execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require every Desktop binary packaging lane to check out the exact
    immutable release tag created by the release job before synchronizing
    package metadata or building artifacts. This prevents a later branch
    advance from changing the bytes attributed to that tag; it is a local
    workflow-contract proof, not a successful release-runner execution.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require every Desktop binary packaging lane to prove both its checked
    out `HEAD` and the release tag's commit target still equal the exact source
    commit captured by the release job before dependency installation, version
    synchronization, or packaging. This fails closed if a tag is moved or a
    checkout resolves incorrectly; it is a local workflow-contract proof, not
    a successful release-runner execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require the release job itself to select exactly one newly created
    canonical semantic-version tag, rather than reusing any prior tag that
    happens to point at `HEAD`, and prove that new tag still resolves to the
    source commit captured before creation. A no-op release emits
    `no_release=true`; ambiguous or moved tags fail before any packaging job.
    This is a local workflow-contract proof only; it does not prove a
    successful signed/notarized release-runner execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require every Desktop binary packaging lane to select exactly one
    tag-derived artifact at the deterministic release output path before
    checksumming or upload. Stale, duplicate, or wrongly-versioned DMG/AppImage
    files now fail closed instead of being accepted by a broad upload glob.
    This is a local workflow-contract proof only; it does not prove a
    successful release-runner execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require release-note publication to verify the actual GitHub Release
    contains each exact tag-derived Desktop artifact and its SHA-256 sidecar
    before presenting download links. This is a local workflow-contract proof;
    it does not prove a successful release-runner execution or signed
    publication. Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require release-note publication to download the exact published macOS
    and Linux Desktop assets and validate their downloaded bytes against the
    published SHA-256 sidecars before presenting download links. This closes
    the GitHub-Release handoff between attachment and release-note publication;
    it is a local workflow-contract proof, not a successful release-runner
    execution or signed publication. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Explicitly exclude hidden files from every release workflow-artifact
    upload, so runner-local dotfiles cannot enter release-notes, Desktop-binary,
    or standalone-server handoffs through a future path expansion. This is a
    local workflow-contract proof only; it does not prove a successful
    release-runner execution or signed publication. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Write Desktop and standalone SHA-256 sidecars with only the payload
    basename, then verify them from the payload directory before upload. This
    makes the published sidecar independently usable after download instead of
    binding it to a runner-local `release/<version>/` path. This is a local
    workflow-contract proof only; it does not prove signed publication.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Serialize release publication behind one stable workflow-concurrency
    group and refuse cancellation of an in-flight write-capable release. This
    prevents a later dispatch from interrupting a tag/artifact publication
    halfway through; it is a local workflow-contract proof only, not a hosted
    signed/notarized release execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Require release-note publication to reject any stale or substituted
    attachment: the selected GitHub Release asset list must exactly equal the
    reviewed Desktop, checksum, standalone archive, and standalone-signature
    names before any payload is downloaded or linked. This is a local
    workflow-contract proof only; it does not prove a hosted release run.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Refuse symlinked Desktop payloads or SHA-256 sidecars at candidate
    selection, checksum creation/verification, and the final GitHub Release
    upload; re-verify the exact regular payload beside its regular sidecar
    immediately before publication. This is a local workflow-contract proof
    only; it does not prove a hosted signed/notarized release execution.
    Evidence: `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
- Operational/release follow-up: publish verified standalone artifacts for supported platforms with
  checksums, signatures, version output, and supply-chain metadata.
  The standalone manifest verifier and deterministic SBOM checks pass locally;
  publication signatures and supported-platform artifact execution remain
  unproven.
  - [x] Verify the local Desktop/standalone artifact manifest contract records
    exact named entrypoint paths, sizes, and SHA-256 bytes, and release
    evidence records a zero-violation workspace import-boundary digest
  (`scripts/task20-release-artifact.test.mjs`,
  `scripts/release-readiness.test.mjs`,
  `specs/decisions/evidence/task20-artifact-contract.md`). This is
  platform-neutral local evidence only; signing, publication, and native
  release-runner execution remain open.
  - [x] Reconcile the packaged embedded-server topology with the workspace
    import gate: only Desktop `main` may import the public `@terminay/server`
    application entrypoint, while preload, renderer, web, and every other
    cross-application dependency remain rejected
    (`scripts/check-workspace-boundaries.mjs`,
    `scripts/workspace-boundaries.test.mjs`,
    `scripts/task20-release-artifact.test.mjs`). This is a local static
    boundary proof, not signed-artifact execution evidence.
  - [x] Verify staging treats an artifact ID as immutable: an existing staged
    artifact directory is rejected before any payload write, so a second
    candidate cannot replace previously verified bytes under the same ID
    (`scripts/task20-release-artifact.test.mjs`; evidence:
    `specs/decisions/evidence/task20-artifact-contract.md`). This is local
    staging-integrity evidence only; it does not prove signed publication.
  - [x] Refuse a substituted symlink artifact root, manifest, or payload before
    trusting it for activation or installed-state recovery. The verifier uses
    `lstat` for each security-relevant path, so matching bytes outside the
    immutable artifact directory cannot satisfy a manifest; the active pointer
    remains unchanged (`scripts/task20-release-artifact.mjs`,
    `scripts/task20-release-artifact.test.mjs`). This is local staging-integrity
    evidence only; it does not prove signed publication.
  - [x] Verify the local Docker server/web images, non-root server entrypoint,
    read-only-root server Compose profile, unauthenticated liveness/readiness
    contract, and authenticated web-proxied local protocol with a real local
    image build and server-restart smoke. This proves local Compose
    lifecycle/health/protocol packaging only; it does not claim public hosted
    deployment, WebRTC/TURN routing, or full shared UI parity
    (`docker-compose.yaml`, `Dockerfile`, `Dockerfile.web`,
    `apps/terminay-server/test/docker-contract.test.mjs`,
    `scripts/docker-compose-web-server-smoke.test.mjs`,
    `scripts/docker-compose-web-server-smoke.mjs`, evidence:
    `specs/decisions/evidence/task20-docker-server.md`,
    `specs/decisions/evidence/docker-compose-web-server-smoke.md`).
  - [x] Run the static web Compose service with a read-only root filesystem,
    no Linux capabilities, `no-new-privileges`, bounded in-memory nginx cache/
    run directories, and its own `/healthz` health gate. The compose smoke
    inspects the actual container `HostConfig` before exercising the proxy
    (`docker-compose.yaml`, `scripts/docker-compose-web-server-smoke.test.mjs`,
    `scripts/docker-compose-web-server-smoke.mjs`). This is local Compose
    containment evidence only; it does not claim a public hosted deployment.
  - [x] Verify the GHCR server and static-web image workflow contract keeps
    version, commit, and default-branch tags; Linux amd64/arm64 manifests;
    SBOM/provenance; and no pull-request publication. Operator digest and tag
    selection is documented in
    [`docker-image-release.md`](../operations/docker-image-release.md), with
    regression coverage in `scripts/ghcr-image.test.mjs`. This is workflow
    contract evidence only: it does not claim an image was published, signed,
    or deployed.
  - [x] Require the release workflow to build the standalone server from the
    exact immutable release tag, pack exactly one version-derived archive,
    exercise the extracted CLI's version output, verify its SHA-256 sidecar,
    and attach both immutable names before release notes advertise them.
    This is local workflow-contract evidence only; it does not prove a hosted
    release run, signatures, or supported-platform execution. Evidence:
    `.github/workflows/trigger-release.yml` and
    `scripts/task20-ci-security.test.mjs`.
  - [x] Verify a real packed standalone archive has no duplicate,
    traversal, link, device, special-file, or group/world-writable entries;
    contains only `package/` paths; and binds its CLI/MCP/integrity payloads
    to matching exact-size SHA-256 manifest declarations
    (`scripts/task20-standalone-release-archive.test.mjs`). This is local
    archive-integrity evidence, not supported-platform publication proof.
  - [x] Require the release workflow to create an Ed25519 detached signature
    for the exact checksummed standalone archive, verify it before both upload
    handoffs, publish it beside the archive, and re-verify the downloaded
    archive/signature pair before release notes. The private signing material
    is scoped to the signing step; this is a local workflow-contract proof,
    not a hosted signed-publication execution (`scripts/release-signature.mjs`,
    `scripts/release-signature.test.mjs`, `.github/workflows/trigger-release.yml`,
    `scripts/task20-ci-security.test.mjs`).
  - [x] Require standalone archive checksum sidecars to be created and
    verified through a bounded regular-file verifier that rejects substituted
    symlink payloads and sidecars, malformed names, and replacement sidecars
    before either upload handoff (`scripts/release-checksum.mjs`,
    `scripts/release-checksum.test.mjs`, `.github/workflows/trigger-release.yml`,
    `scripts/task20-ci-security.test.mjs`). This is a local release-handoff
    integrity proof only; it does not prove hosted publication.
  - [x] Require the final standalone GitHub Release upload to reject symlinked
    archive, checksum, and detached-signature inputs immediately before
    re-verification, and omit replacement semantics for all three immutable
    asset names (`.github/workflows/trigger-release.yml`,
    `scripts/task20-ci-security.test.mjs`). This is a local workflow-contract
    proof only; it does not prove hosted publication.
- [x] Verify a detached Ed25519 signature covers the exact file-backed
    artifact manifest and fails closed after payload tampering
    (`scripts/task20-release-artifact.test.mjs`). This proves local signature
    verification only; trusted key distribution and publication remain open.
  - [x] Bind published-artifact release evidence to the exact recorded
    artifact SHA-256: an immutable publication URI whose digest differs from
    the verified artifact bytes is rejected before it can satisfy an external
    publication gate (`scripts/task20-release-evidence.mjs`,
    `scripts/task20-release-evidence.test.mjs`). This is local
    evidence-classification hardening only; it does not prove hosted
    publication.
  - [x] Reject published-artifact evidence whose claimed publication instant
    predates the completed native-runner record for the same artifact. This
    prevents a historical publication from being relabelled as the output of
    a later verified run (`scripts/task20-release-evidence.mjs`,
    `scripts/task20-release-evidence.test.mjs`). This is local
    evidence-classification hardening only; it does not prove hosted
    publication.
  - [x] Prove a root-authenticated Ed25519 release-key distribution verifies
    detached artifacts without trusting artifact-bundled keys and fails closed
    for substituted/tampered keyrings, revoked keys, and expired keys
    (`scripts/task20-signature-key-distribution.test.mjs`). This is local
    key-distribution logic evidence; root-key publication and hosted release
    delivery remain unproven.
  - [x] Fail closed when a distributed key is merely labelled Ed25519 but its
    parsed SPKI key type is different, and require detached-signature
    verification to recompute the supplied artifact bytes' SHA-256 rather than
    echoing an unverified claimed digest
    (`scripts/task20-signature-key-distribution.mjs`,
    `scripts/task20-signature-key-distribution.test.mjs`). This is local
    algorithm-confusion and artifact-binding hardening only; root-key
    publication and hosted release delivery remain unproven.
  - [x] Require published-artifact evidence to resolve its signer key through
    a verified root-authenticated key distribution and reject absent, revoked,
    or publication-time-invalid keys. This is local evidence-classification
    hardening only; it does not prove hosted publication or root-key delivery
    (`scripts/task20-release-evidence.test.mjs`).
  - [x] Require an external publication gate to verify supplied exact artifact
    bytes and its detached Ed25519 signature through the root-authenticated
    signing-key distribution, rejecting substituted bytes or signatures even
    when a record names a trusted signer and matching URI digest
    (`scripts/task20-release-evidence.test.mjs`). This is local
    evidence-classification hardening only; it does not prove hosted
    publication or root-key delivery.
  - [x] Require the same external publication gate to receive the exact
    release-manifest bytes and verify their SHA-256 against the evidence
    record, rejecting an omitted or substituted manifest before signature
    acceptance (`scripts/task20-release-evidence.mjs`,
    `scripts/task20-release-evidence.test.mjs`). This closes a local
    artifact/manifest substitution gap only; it does not prove hosted
    publication, signing, notarization, or root-key delivery.
- Operational/release follow-up: run the complete PTY and server probes on native Linux x64/arm64 release
  runners, the packaged Linux x64 AppImage, and macOS arm64 at the supported
  macOS 12 floor; do not substitute emulation or configured-but-unrun CI.
  The workflow contains the native lanes, while local evidence includes
  native arm64 and architecture-emulated x64 records; the required native
  release-runner executions remain open.
  - [x] Require separate non-container Linux x64 and arm64 CI runner lanes to
    prove their runner, kernel, and Node architectures before building the
    server and running packed standalone/node-pty probes
    (`.github/workflows/ci.yml`, `scripts/task20-native-runner-contract.test.mjs`).
    This is a static workflow contract and does not substitute for those
    release-runner executions.
  - [x] Verify the reviewed Desktop release matrix maps macOS only to DMG and
    Linux only to AppImage, agrees with the package/builder commands and
    artifact naming, and performs exact native-lane selection before
    checksumming (`scripts/task20-release-platform-contract.test.mjs`). This is
    static release-workflow evidence, not a native runner execution.
  - [x] Require each native Linux runner lane to write and upload a
    machine-readable evidence record only after its packed standalone and PTY
    probes pass. The record binds the target, runner/Node/kernel architecture,
    Node version, and exact Git commit, so later release evidence cannot be
    mistaken for a log from a different runner or revision
    (`scripts/record-native-runner-evidence.mjs`,
    `scripts/task20-native-runner-contract.test.mjs`,
    `.github/workflows/ci.yml`). This is a static workflow-contract proof, not
    an executed native runner result.
  - [x] Bind each native Linux runner record to the exact regular standalone
    archive produced after the PTY probes, recording its byte length and
    SHA-256 while rejecting symlink substitution
    (`scripts/record-native-runner-evidence.mjs`,
    `scripts/record-native-runner-evidence.test.mjs`,
    `scripts/task20-native-runner-contract.test.mjs`,
    `.github/workflows/ci.yml`). This is a local workflow-contract and
    evidence-integrity proof only; it does not substitute for executed native
    release runners.
  - [x] Refuse to record native-runner evidence from a worktree with tracked
    changes or non-ignored untracked files, and require acquired evidence to
    carry that clean-worktree assertion. This prevents exact artifact bytes
    built from uncommitted tracked changes from being attributed to an
    otherwise matching immutable commit
    (`scripts/record-native-runner-evidence.mjs`,
    `scripts/record-native-runner-evidence.test.mjs`). This is local
    provenance hardening only; it does not substitute for executed native
    release runners.
  - [x] Provide a fail-closed verifier for an acquired native Linux runner
    record against the exact regular standalone archive, expected target, and
    immutable release commit. Substituted archives, symlinked records, and
    cross-target/cross-commit evidence fail closed
    (`scripts/record-native-runner-evidence.mjs`,
    `scripts/record-native-runner-evidence.test.mjs`). This validates a local
    evidence input only; it does not substitute for an executed native runner.
- Operational/release follow-up: produce deterministic WebRTC runtime artifacts with license notices,
  source correspondence, locked dependencies, SBOM, provenance attestation,
  vulnerability-response ownership, and browser interoperability evidence.
  Secure-Werift candidate evidence covers a locked graph, notices, SBOM,
  source correspondence, and the disposable hosted-relay/browser legacy
  bootstrap/terminal compatibility proof; the sibling peer owner's
  ticket-bound canonical application bridge is an external integration
  follow-up;
  formal candidate selection, packaging, trusted attestations, and complete
  supported-architecture/browser evidence remain release gates.
  - [x] Require the native Linux production-WebRTC evidence matrix to reject a
    movable hosted-signaling ref and verify its clean checkout resolves to the
    configured full commit SHA before dependencies or the runtime proof run.
    This pins the cross-repository evidence to one reviewed hosted-service
    revision; it does not select a runtime or prove a release-runner result
    (`.github/workflows/ci.yml`, `scripts/task20-ci-security.test.mjs`).
  - [x] Pack two independently generated secure-Werift runtime candidates and
    require their distributable npm archives to be byte-identical, in addition
    to their pinned graph, notices, source correspondence, SBOM, and file
    hashes. This is local reproducibility evidence only; runtime selection,
    attestations, supported-architecture execution, browser interoperability,
    and release publication remain open
    (`scripts/build-secure-werift-candidate.mjs`,
    `scripts/production-headless-webrtc-secure-werift.test.mjs`).
  - [x] Bind every secure-Werift candidate payload to a deterministic,
    file-hash-verified in-toto/SLSA provenance statement with pinned npm and
    upstream-git materials, then include that statement in the candidate's
    checksum manifest (`scripts/build-secure-werift-candidate.mjs`,
    `scripts/production-headless-webrtc-secure-werift.test.mjs`). This is a
    local provenance-artifact proof only; a trusted hosted attestation,
    candidate selection, and release publication remain open.
  - [x] Require every locally built secure-Werift candidate to pass a
    fail-closed verifier before it can become runtime or release evidence: it
    rejects symlinks, malformed or duplicate checksum paths, uncovered or
    extra payload files, checksum tampering, and provenance that differs from
    the exact reviewed payload/materials
    (`scripts/build-secure-werift-candidate.mjs`,
    `scripts/production-headless-webrtc-secure-werift.test.mjs`). This is
    local candidate-integrity evidence only; it does not select a runtime,
    establish trusted hosted attestation, or publish a release.
  - [x] Record a bounded, owner-led vulnerability response policy for the
    pinned Secure-Werift candidate, including private intake, critical/high
    acknowledgement and disposition limits, immutable candidate/source
    recording, and a release-selection block for unresolved critical/high
    issues (`specs/decisions/evidence/task20-secure-werift-vulnerability-response.md`,
    `scripts/task20-secure-werift-vulnerability-response.test.mjs`). This is
    local policy-contract evidence only; it does not prove a selected runtime,
    hosted advisory handling, or release publication.
  - [x] Prove the locked Secure-Werift candidate interoperates with Chromium's
    native `RTCPeerConnection`: the browser pairs, opens the legacy
    compatibility data channels, reconnects, and is denied after revocation
    through a disposable local hosted relay. The proof rejects a browser
    WebRTC shim before pairing
    (`e2e/webrtc-headless-node-host.spec.ts`,
    `scripts/production-headless-webrtc-secure-werift.test.mjs`). This is
    Chromium-only local compatibility evidence; it does not install or prove
    the sibling peer owner's ticket-bound canonical four-channel application
    bridge. Safari/iOS and supported release-architecture execution remain
    open.
- [x] Test clean install, upgrade, rollback, and incompatible-version recovery.
  The file-backed release harness stages real artifact directories, verifies
  manifest/file hashes and complete file sets, atomically switches the active
  release pointer, preserves the server identity/data root across upgrade and
  rollback, and leaves the active pointer unchanged for an incompatible
  candidate (`scripts/task20-release-artifact.test.mjs`). This is unsigned,
  platform-neutral local evidence; packaged signed installer/archive
  execution remains an explicit release gate.
  - [x] Verify activation validates the staged artifact before changing the
    active pointer, rollback validates the exact prior artifact before
    switching back, and selected entrypoints match the verified manifest
    (`scripts/task20-release-artifact.test.mjs`; evidence:
    `specs/decisions/evidence/task20-artifact-contract.md`). This is
    deterministic local lifecycle evidence only.
  - [x] Prove a compatibility decision preserves the exact server identity for
    forward-compatible upgrades and recovers the same active installation
    without mutation on protocol/schema/migration/non-newer incompatibility
    (`scripts/task20-upgrade-compatibility.test.mjs`). This is deterministic
    update-policy logic, not an installed signed-artifact execution.
- [x] Define independent Desktop-host and standalone-server update behaviour
  without silently replacing a remote server.
  The update policy and deterministic boundary harness preserve local server
  identity/data roots and reject remote-server replacement
  (`specs/operations/release-update-policy.md`,
  `scripts/task20-release-lifecycle.test.mjs`).
- [x] Confirm the direct server-bundled UI remains usable during host-version
  mismatch.
  A direct server-origin smoke test serves the verified bundle while the
  compatibility matrix rejects an incompatible Desktop host
  (`scripts/task20-direct-ui-mismatch.test.mjs`).

### Operations and documentation

- [x] Document data/log paths, configuration precedence, firewall, STUN/TURN,
  service-manager setup, pairing, revocation, vault unlock, backup/restore,
  upgrade, rollback, and incident diagnostics
  (`specs/operations/standalone-server.md`,
  `specs/operations/release-update-policy.md`).
- [x] Provide example systemd/launch service configuration without hiding
  foreground server behaviour (`specs/operations/standalone-server.md`).
- [x] Add release-smoke definitions and hosted deployment-order contract checks
  (`scripts/standalone-server-artifact-ci.test.mjs`,
  `scripts/hosted-deployment-order.test.mjs`). Executed clean-machine and
  supported-platform release evidence remains a separate release gate.
- [x] Decide from release evidence whether separate repositories improve
  ownership or cadence; keep the workspace if they do not.
  Release evidence keeps the matched Desktop/server/UI/protocol workspace
  together and retains the hosted signaling service as the separate deployment
  boundary (`specs/decisions/evidence/repository-ownership-release.md`).
- [x] Move completed task files to `tasks_completed/`. Tasks 9, 12–16, and 20 now
  live in the archive with zero unchecked items; active-task dependency links
  point to their archived canonical records
  (`scripts/task19-20-audit.test.mjs`).

## Operational and release follow-ups

The non-checkbox follow-ups above require hosted publication systems, trusted
release runners, supported native hardware, notarization services, or formal
release-governance decisions. They preserve the outstanding operational
evidence gates without classifying externally executed release work as
incomplete repository implementation.

## Acceptance checks

- Security review has no unresolved critical or high boundary issue.
- Clean Desktop starts Local offline; clean standalone startup prints the secure
  pairing flow and serves its matching UI.
- Supported signed artifacts pass clean-install and upgrade tests.
- Failure/load tests stay inside declared resource and recovery limits.
- Backup, restore, revoke, update, rollback, and headless service operation are
  documented and exercised.

## Definition of done

Desktop and standalone server artifacts are secure, reproducible,
operationally supportable, and released with tested recovery and matching
protocol/UI versions.
