## Context

Terminay Server already runs headless: `apps/terminay-server` is a foreground
process supervised by a service manager, its data root is the trust boundary,
and `approval.sock` inside that root is the operator's channel to the live
process. What is missing is everything around it. Releases attach an
uninstallable `npm pack` tgz while the self-contained archive builder sits
unused. The server can only be paired from Desktop when its remote origin is
a `*.terminay.com` session origin, and only Desktop knows how to mint one
(`loadOrCreateEmbeddedSessionOrigin` in `electron/main.ts`). The `--pairing`
subcommand constructs a throwaway `ServerRemoteExposure` and prints a token
the running server never registered. And there is no way to reach a server
that is not registered with the hosted relay, because the signaling server
lives outside this repository.

In-force ADRs that constrain this design: ADR-0001 (pinned Node baseline,
platform artifacts carry their own runtime), ADR-0004 (node-pty and the
Debian 12 / glibc 2.36 matrix), ADR-0006 (Terminay-owned Werift runtime),
ADR-0008 (server-bundled clients, protocol-blind hosts; supersedes 0007),
ADR-0011 (trust-boundary table: signaling is untrusted for confidentiality
and integrity, compromise is bounded denial of service), ADR-0012 (PWA framed
session host), ADR-0013 (credentials only on transport-authenticated data
channels; HTTP device endpoints exist solely for the loopback local-UI server;
host approval of a device-bound match code). ADR-0002, 0003, 0005, 0009, 0010,
0014 are in force but do not bear on this change.

## Goals / Non-Goals

**Goals:**
- Every release, and every merge to `main`, publishes a verified, signed,
  self-contained server archive per Linux architecture that an installer can
  fetch, verify, and run without Node or a compiler on the target.
- A headless server can be exposed at startup, provisions its own hosted
  session origin, and reports its live pairing URL to a local operator.
- A headless server can be reached by Desktop without the hosted relay,
  with the same trust model as hosted exposure.
- Desktop pairs with a direct link in the same closed host action it uses for
  hosted links.

**Non-Goals:**
- The `terminay` CLI itself, the systemd unit, and install/upgrade logic
  (change `terminay-daemon-cli`).
- Browser or PWA access to a direct origin. Browsers cannot accept the
  self-signed listener; operators who want browser access keep a reverse
  proxy with a real certificate, as today.
- Vault unlock for unattended servers.
- Windows, macOS, or musl standalone servers.

## Decisions

### D1. Self-contained per-arch archives replace the npm pack tgz

Wire `scripts/build-standalone-server-artifact.mjs` into the release
workflow for `linux-x64` and `linux-arm64` and stop attaching the
`npm pack` tgz. The archive already stages the pinned Node binary, compiled
server and workspace packages, the production dependency closure with the
native `pty.node`, the UI bundle, the WebRTC runtime, and a wrapper at
`bin/terminay-server`. This is the artifact ADR-0001 and the "Supported
runtime matrix" requirement already describe; the tgz was never installable
because `@terminay/server-core`, `@terminay/protocol`, and `@terminay/ui-bundle`
are private.

Alternatives: publishing the workspace packages to npm (exposes internal
package contracts, still needs a native build on the target); a single-file
executable via Node SEA or similar (does not carry a native addon, a 16 MB
extensions tree, and worker entrypoints cleanly). Both rejected.

Runners: the builder asserts Linux and a native `process.arch`. The
repository is public, so the arm64 job runs on GitHub's free
`ubuntu-24.04-arm` runner, alongside `ubuntu-latest` for x64; the
server-image workflow already builds `linux/arm64` on GitHub. The macOS
Gitea runner is not used: the builder cannot run on macOS, and a Linux
container on that Mac would have to push assets to a GitHub release with a
second token. That container path is the documented fallback only.

### D2. Manifest carries channel and revision; `main` is a rolling prerelease

`artifact-manifest.json` gains `channel` (`tag` | `main`), `revision` (the
built commit), and `architecture`. A new workflow on push to `main` builds
both archives, signs them, and updates a single prerelease named `main`:
upload the new assets under temporary names, then rename over the old ones,
so a reader never observes a half-replaced set. Installers compare
`revision`, not `version`, on the `main` channel.

Alternative: building from source on the target for `main`. Rejected as the
primary path (needs git, python3, make, g++, and a full workspace install on
a production box); the CLI change keeps it as a fallback for refs with no
prebuilt asset.

### D3. Session-origin provisioning moves into the server package

`loadOrCreateEmbeddedSessionOrigin` leaves `electron/main.ts` for
`apps/terminay-server/src/remote/sessionOrigin.ts`, keeping its file format
(`remote-session-origin.v1.json`, schema 1) and its rule that a persisted
origin is reused only when it still sits under the configured hosted domain.
Desktop and the standalone CLI both call it. The CLI gains `--hosted-domain`
(default `terminay.com`) and, when hosted exposure is on, derives its remote
origin from the persisted session origin instead of the
`https://<id>.remote.terminay.local` placeholder. Boundary crossed: the
data root now owns the session origin for standalone servers too, which is
where the device registry and host key already live.

### D4. Exposure at startup is configuration, not a toggle

`--expose hosted|direct|hosted,direct|off` (default `off`) is the
administrator's standing decision for that data root. When set, the CLI
starts the hosted pairing host and/or the direct relay before readiness
prints a pairing URL, exactly as the Desktop toggle does. This modifies the
"Exposure is explicit and administrator-controlled" requirement to name a
second explicit source; it does not weaken the invariant that a server is
unreachable until someone with authority over the data root chose otherwise.

### D5. Direct exposure is a self-hosted, data-blind signaling endpoint

The server serves `/signal` on its own HTTPS listener and routes the same
frame vocabulary the hosted relay routes (`host-ready`, `device-host-ready`,
`client-join`, `device-join`, offers, answers, ICE, `peer-closed`) by type,
retaining only routing state. `scripts/support/hostedLoopbackRelay.mjs`
already proves that a 66-line type-only router satisfies both ends of the
production protocol; the production relay is that router plus the
`acceptSessionSignalingUpgrade` boundary, per-room handshake caps, and frame
size limits. The host side of the server connects to its own relay over the
loopback interface, so `hostedPairingHost` runs unchanged with a second
session origin.

Authentication is unchanged from hosted exposure: the client verifies the
host-key signature over the transport transcript and the DTLS fingerprints
before any credential crosses. The listener presents a self-signed
certificate generated into the data root (`direct-tls.v1.json`, owner-only)
because the hosted pairing URL grammar and Electron's WebSocket client both
require `https`/`wss`; the certificate is not part of the trust model, which
is why ADR-0011's "signaling is untrusted" row and ADR-0013's channel-only
rule are satisfied without a certificate distribution problem. Desktop
disables certificate verification only for a socket it opened to a `direct`
class origin taken from a pairing link or saved profile, never globally.

Alternative: Desktop enrolling over HTTPS device endpoints as it does for
loopback. Rejected: ADR-0013 forbids HTTPS as a credential path off the
loopback interface, and it would need a real certificate-pinning scheme.

Direct pairing links use the session-origin form `https://<host>[:port]/v1/#…`
with the origin taken literally. `parseHostedPairingUrl` today derives a
session id from the hostname; it gains a `direct` branch when the hostname
is not under a known hosted domain, and `resolveDesktopPairingTarget` maps
that branch to `kind: 'direct'`, which pairs with `pairDesktopHostedDevice`
against the literal origin. Direct and hosted modes share one
`ServerRemoteExposure`, so one host key, one device registry, one approval
queue, and a device paired one way reconnects the other.

### D6. Live pairing lookup on the data-root socket

`approval.sock` gains `{ op: 'pairing', rotate?: boolean }`. The reply lists
`{ mode, pairingUrl, pairingExpiresAt, serverId }` per enabled mode, or an
explicit `exposure: 'off'`. `rotate: true` calls the existing
`rotate()` path, which already keeps live peers and reconnect registration.
The `--pairing` subcommand becomes a client of this op and errors when the
socket is absent. The socket stays owner-only inside the data root and is
never bound to a network address; anyone who can call it already owns the
device registry, so no new authority is created.

### D7. Direct listener placement

The direct relay listens on the existing authenticated HTTP server
(`localUiServer.ts`) when `--http-port` is set and `--direct-origin` names
that listener, so one port serves the UI archive, health, and signaling. It
is TLS-terminated by the server itself with the self-signed certificate; a
reverse proxy in front is allowed but not required.

## Risks / Trade-offs

- [Self-signed certificate confuses operators who expect TLS to mean trust] →
  the readiness record and runbook state that direct mode is authenticated by
  the server host key, and `--status` reports the certificate fingerprint for
  diagnostics only.
- [Direct relay becomes a new denial-of-service surface] → reuse the hosted
  host's handshake cap (four concurrent, 60 s), cap frame size at the relay,
  admit only frames whose room or session the host registered.
- [Rolling `main` prerelease replaced mid-download] → temporary asset names
  renamed over the old set; installer downloads the manifest last and
  re-verifies sha256 and signature of what it fetched.
- [`ubuntu-24.04-arm` runner unavailable or flaky] → fall back to a
  linux/arm64 container on the macOS Gitea runner uploading with a scoped
  GitHub token, and record which path produced the artifact in evidence.
- [Moving the session-origin helper changes Desktop's embedded exposure] →
  keep file name, schema, and reuse rule byte-identical; cover with the
  existing desktop exposure tests plus a new shared unit test.

## Migration Plan

1. Land the archive jobs and rolling `main` workflow first; they are
   independent of server code. Existing releases keep their tgz; new ones
   carry archives only.
2. Land the server changes (session origin, `--expose`, direct relay,
   `pairing` op) behind defaults that preserve today's behaviour
   (`--expose off`, `--hosted-domain terminay.com`).
3. Land the Desktop and protocol changes for direct links.
4. Update the runbook and the update policy to reference archives, channels,
   and direct mode. Rollback is per step; nothing here rewrites data-root
   schemas.

## Open Questions

- Whether ADR-0011's boundary table should gain an explicit row for the
  self-hosted signaling endpoint; recorded as a new ADR rather than an edit.
