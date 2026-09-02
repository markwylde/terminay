## Why

A user installing Terminay gets a privileged headless runtime, native
dependencies, a server-provided UI, device trust, and two independently updating
artifacts. Before that could be released, each of those boundaries needed
adversarial review, bounded failure and load evidence, reproducible signed
artifacts, and operator documentation — none of which existed as executed proof.

## What Changes

- Threat-model and fuzz every privileged boundary: local bootstrap, WebRTC
  authentication, the host bridge, the UI bundle, filesystem scope, MCP tokens,
  the vault, migrations, logs, and updates.
- Validate inbound relay JSON and renderer-to-relay serialization through a
  128 KiB, depth- and field-limited signaling boundary that rejects unsafe
  prototype keys, cycles, invalid UTF-8, and malformed message types.
- **BREAKING** Require trusted top-level Terminay renderer provenance before
  every legacy privileged Electron IPC handler executes. Subframes, foreign
  origins, and unregistered windows are rejected before payload handling; the
  hidden WebRTC host is deliberately excluded even though it loads an app asset.
- Apply a credential-free HTTPS external-URL policy to both the legacy Electron
  shell IPC and the Desktop host bridge, rejecting non-HTTPS schemes, userinfo,
  and malformed or control-character URLs.
- Harden the dedicated remote connection window: ephemeral isolated session, no
  preload, no webviews, no new windows, no downloads, no permissions, and guarded
  frame, navigation, and redirect escape paths.
- Harden every static web-host response and every unauthenticated health-probe
  response — success and error alike — with an inert CSP, anti-framing,
  MIME-sniffing, referrer, resource-policy, and restrictive permissions headers.
- Explicitly sandbox the unprivileged project-tab drag-preview window.
- Verify revocation, lockout, expiry, rate limits, replay protection, and
  redaction under concurrent failure.
- Load-test many PTYs, clients, watches, agent events, file transfers,
  recordings, and reconnects with bounded memory, bounded per-lane queues, a
  per-terminal subscriber admission limit, and complete cleanup accounting.
- Test crash loops, sleep, network changes, disk full, corrupt and read-only
  state, provider failure, signaling outage, TURN outage, and clock jumps.
- Verify desktop and mobile UI responsiveness while background streams run,
  including inert rendering of untrusted stream payloads and bounded queues.
- Add telemetry-free local diagnostics and opt-in support-bundle redaction.
- Make the release supply chain fail closed: read-only default workflow token,
  no persisted checkout credentials, scoped optional AI release-notes credential,
  `bash -euo pipefail` on every step, finite job timeouts, one serialized
  release, immutable tag verification, deterministic asset selection, SHA-256
  sidecars re-verified before and after upload, symlink refusal, macOS signature
  and notarization verification of the exact DMG, and an Ed25519 detached
  signature over the standalone archive.
- Verify clean install, upgrade, rollback, and incompatible-version recovery
  against a file-backed artifact manifest with atomic active-pointer switching.
- Define independent Desktop-host and standalone-server update behaviour that
  never silently replaces a remote server, and keep the direct server-bundled UI
  usable during a host-version mismatch.
- Document data and log paths, configuration precedence, firewall, STUN/TURN,
  service-manager setup, pairing, revocation, vault unlock, backup and restore,
  upgrade, rollback, and incident diagnostics, with example systemd and launch
  service configuration.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `connections-and-client-hosts`: privileged Desktop IPC requires trusted
  renderer provenance, external URLs are credential-free HTTPS, and auxiliary
  windows are explicitly contained.
- `server-runtime-and-protocol`: hardened unauthenticated probe responses,
  bounded resource admission, verified release artifacts, and independent update
  behaviour.
- `remote-access`: a bounded, validating signaling boundary and proven
  revocation, lockout, expiry, rate-limit, and replay behaviour.
- `local-desktop-diagnostics`: telemetry-free diagnostics with opt-in redacted
  support bundles.

## Impact

The privileged Electron main process and its IPC registration modules, the
Desktop host bridge, the remote signaling boundary, the standalone server health
listener, the Docker server and web images, the release workflow and its
supporting scripts, the release artifact and evidence verifiers, and the
operator documentation. Renderer-facing behaviour is unchanged except where a
previously permitted external URL or privileged IPC caller is now refused.
