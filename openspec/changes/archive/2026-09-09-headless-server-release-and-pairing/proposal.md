## Why

A person who runs Terminay Server headless on a Linux box and wants to open it
from Terminay Desktop cannot do so today without hand-assembling the server
from the repository. The `terminay-server-<version>.tgz` on each GitHub
release is an `npm pack` of a private workspace whose dependencies are not on
npm, so it does not install; the self-contained archive builder in
`scripts/build-standalone-server-artifact.mjs` is not wired into any release
job; the server's `--pairing` command mints a token in its own process that
the running server never learns; and a standalone server can only be paired
from Desktop when its remote origin is a `*.terminay.com` session origin,
which nothing provisions for it. The forthcoming `terminay daemon` CLI needs
all four fixed before it can install, pair, or upgrade anything.

## What Changes

- Each tagged release publishes self-contained Linux server archives for x64
  and arm64 that bundle the pinned Node runtime, the compiled server and its
  workspace dependencies, prebuilt `node-pty`, the matching UI bundle, the
  selected WebRTC runtime, and an artifact manifest. Each archive ships with a
  SHA-256 sidecar and an Ed25519 signature made with the existing release
  signing key. The `npm pack` tgz is no longer attached to releases.
- A rolling `main` prerelease is rebuilt on every merge to `main` with the
  same archives, so `main` is installable as a channel. Its manifest carries
  the built commit so an installer can tell whether `main` moved.
- The standalone server mints and persists its own hosted session origin
  under a configurable hosted domain, exactly as Desktop does for its embedded
  server, and exposes on startup when configured to. Desktop's session-origin
  helper moves into the server package so both share one implementation.
- The standalone server gains a **direct** exposure mode: it serves the
  data-blind signaling endpoint itself on its own HTTPS listener with a
  self-signed certificate, and Desktop pairs and reconnects to that origin
  over the same transport-authenticated WebRTC channels used for hosted
  servers. No credential ever crosses the HTTPS origin; TLS is not trusted
  for authentication. Hosted and direct modes can run at the same time.
- The owner-only socket in the data root gains a `pairing` operation that
  returns the running server's live pairing URLs (hosted and direct), minting
  a fresh room on request. The one-shot `--pairing` command that minted an
  unrelated token is replaced by this live lookup.
- Desktop **Add connection** accepts a direct pairing link whose origin is a
  standalone server's own HTTPS origin, in addition to hosted links.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `server-runtime-and-protocol`: release packaging publishes signed per-arch
  self-contained archives and a rolling `main` prerelease; the artifact
  manifest records channel and revision; the standalone pairing command
  reports the running server's live pairing handoff through the data-root
  socket; standalone configuration gains hosted-domain, direct-exposure, and
  expose-on-start settings.
- `remote-access`: exposure may be enabled by standalone configuration at
  startup without an interactive administrator; the standalone server
  provisions its own hosted session origin; a server may expose through a
  self-hosted direct signaling endpoint, and clients authenticate it by the
  signed transport transcript alone.
- `connections-and-client-hosts`: Desktop **Add connection** accepts direct
  standalone pairing links and pairs over the authenticated channel.

## Impact

- `.github/workflows/trigger-release.yml`: replace the `npm pack` job with
  per-arch archive jobs; new workflow for the rolling `main` prerelease.
- `scripts/build-standalone-server-artifact.mjs`, `scripts/standalone-artifact.mjs`,
  `scripts/release-signature.mjs`, `scripts/pty-runtime-platforms.mjs`.
- `apps/terminay-server/src/cli.ts`, `cliOptions.ts`, `remote/approvalSocket.ts`,
  `remote/hostedPairingHost.ts`, `remote/serverExposure.ts`, `localUiServer.ts`;
  new `remote/directSignalingRelay.ts` and `remote/sessionOrigin.ts`.
- `electron/main.ts` (session-origin helper moves out), `electron/remote/desktopPairing.ts`,
  `electron/remote/desktopHostedConnection.ts`, `packages/protocol/src/hostedPairingUrl.ts`.
- `docs/operations/standalone-server.md`, `docs/operations/release-update-policy.md`.
- Dependencies: `selfsigned` (already in the root manifest) is declared by the
  server package for the direct listener's certificate.
