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

## Dependencies

- [Migration and compatibility cleanup](./19-migration-and-compatibility-cleanup.md)

## Work slices

### Security review

- [x] Threat-model local bootstrap, WebRTC auth, host bridge, UI bundle,
  filesystem scope, MCP tokens, vault, migrations, logs, and updates.
- [x] Fuzz protocol validators plus local-control/application framing.
- [ ] Fuzz Electron WebRTC signaling message handling and relay framing.
- [x] Test privilege escalation across server/device/project/view/session ids.
- [ ] Audit CSP, permissions policy, sandbox, navigation, deep links,
  clipboard/dialogs, downloads, and external URLs.
  Current evidence covers the server UI host's CSP/permissions policy,
  sandbox, same-origin navigation, and download denial. Deep-link, dialog,
  clipboard, external-URL, and primary-window platform review remains open.
- [x] Verify revocation, lockout, expiry, rate limits, replay protection, and
  redaction under concurrent failure with deterministic local-control, pairing,
  reconnect, remote-transport, and vault evidence
  (`apps/terminay-server/test/security-revocation-replay.test.mjs`). This does
  not claim fuzzing or sustained load coverage.
- [ ] Run dependency, license, native-binary provenance, SBOM, and vulnerability
  checks.

### Reliability and performance

- [ ] Load-test many PTYs, clients, watches, agent events, file transfers,
  recordings, and reconnects with bounded memory and queues.
- [ ] Measure the selected WebRTC runtime under sustained real multi-peer
  direct and TURN traffic, slow consumers, relay loss, peer crashes, and
  admission-limit exhaustion on supported release architectures.
- [ ] Test Desktop/server crash loops, sleep, network changes, disk full,
  corrupt/read-only state, provider failure, signaling outage, and TURN outage.
- [ ] Verify desktop and mobile UI responsiveness while background streams run.
- [x] Add telemetry-free local diagnostics and opt-in support-bundle redaction.

### Artifacts and updates

- [ ] Publish signed/notarized Desktop artifacts containing the exact matched
  server and UI.
- [ ] Publish verified standalone artifacts for supported platforms with
  checksums, signatures, version output, and supply-chain metadata.
- [ ] Run the complete PTY and server probes on native Linux x64/arm64 release
  runners, the packaged Linux x64 AppImage, and macOS arm64 at the supported
  macOS 12 floor; do not substitute emulation or configured-but-unrun CI.
- [ ] Produce deterministic WebRTC runtime artifacts with license notices,
  source correspondence, locked dependencies, SBOM, provenance attestation,
  vulnerability-response ownership, and browser interoperability evidence.
- [ ] Test clean install, upgrade, rollback, and incompatible-version recovery.
- [ ] Define independent Desktop-host and standalone-server update behaviour
  without silently replacing a remote server.
- [ ] Confirm the direct server-bundled UI remains usable during host-version
  mismatch.

### Operations and documentation

- [x] Document data/log paths, configuration precedence, firewall, STUN/TURN,
  service-manager setup, pairing, revocation, vault unlock, backup/restore,
  upgrade, rollback, and incident diagnostics.
- [x] Provide example systemd/launch service configuration without hiding
  foreground server behaviour.
- [x] Add release smoke tests on clean supported machines and hosted deployment
  ordering checks.
- [ ] Decide from release evidence whether separate repositories improve
  ownership or cadence; keep the workspace if they do not.
- [ ] Move completed task files to `tasks_completed/`.

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
