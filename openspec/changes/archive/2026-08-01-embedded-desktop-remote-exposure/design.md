## Context

See proposal.md. Two exposure routes existed with one presentation, and the
completed record of the earlier WebRTC task described production activation as
an external follow-up. Read as a working exposure path, that record was
misleading. Separately, the stable host contracts and launching the selected
server's verified UI bundle after connection are owned elsewhere; this change
owns only the exposure presentation, the privileged WebRTC runtime, the
registrar, signaling, and real network evidence.

## Goals / Non-Goals

Goals:
- One primary WebRTC exposure lifecycle for the canonical embedded Local server.
- An independently controllable advanced direct network listener.
- Honest availability reporting before a user starts exposure.
- The private Local connection stays connected and separate throughout.

Non-Goals:
- Maintaining a second reconnect controller or a weaker recovery harness. The
  mounted WebRTC failure, recovery, and Retry matrix is consumed from the
  WebRTC transport recovery acceptance work, not duplicated here.
- Making the hosted compatibility gate a repository-verifiable acceptance step.

## Decisions

- **One server authority.** The direct listener binds to the embedded Local
  `ServerCore` using the configured interface, port, and TLS policy rather than
  constructing a second server. Both exposure routes and the private Local
  transport therefore share one workspace, one set of PTYs, and one identity.
- **Fail closed on start.** Listener start, stop, and rotation are atomic; a
  bind, TLS, or protocol startup failure leaves exposure stopped and publishes
  no pairing URL. Stopping one route never stops the other or Local.
- **Never fall back.** The primary **Expose this server…** action does not
  start the direct listener when WebRTC is unavailable. The missing runtime or
  registrar is shown before the user acts, because an implicit fallback would
  silently open a network socket the user did not choose.
- **Availability is part of the host contract.** Per-mode availability is
  explicit in the Desktop status/host contract, and the menu disables start and
  QR actions with **Unavailable in this build** when a mode's privileged
  composition is incomplete. A build that cannot prove runtime and registrar
  composition never allocates a hosted room.
- **Naming separates the secret from the address.** The non-secret value is
  labelled **Server/session origin**; the consumable secret is the **Pairing
  link**. Copy and QR actions always carry the complete short-lived fragment
  credential and its expiry, because a partial link cannot pair.
- **Navigation-time credentials use the fragment.** Direct-network pairing
  boots the exact verified browser workspace bundle without requiring a Bearer
  header that a navigation cannot carry, and the complete fragment-bearing link
  stays visible and copyable so a second Desktop can accept it through **Add
  connection…**.
- **The privileged peer runs in-process.** The restored hosted `v1` bootstrap
  is an in-process privileged Werift peer using the selected runtime,
  authenticated room signaling, PIN/device enrollment, the embedded authority's
  live terminal sessions, and the embedded server's verified UI bundle. It does
  not create a hidden Electron renderer and exposes no renderer preload
  capability.
- **Bootstrap lanes stay narrow.** After device authentication the peer moves to
  the canonical `control`/`application`/`terminal`/`assets` session. The legacy
  `api` and `asset` lanes remain scoped to enrollment and verified UI
  installation, and the authenticated ticket is consumed exactly once before
  the embedded `ServerCore` accepts the application lane.

## Risks / Trade-offs

- Running the privileged peer in the main process keeps it out of a renderer
  sandbox, which is why it must never expose a preload capability; the trust
  boundary is enforced by composition rather than by process isolation.
- Requiring one registrar to supply both room registration and per-peer
  signaling narrows the deployments that can expose over WebRTC, in exchange
  for not shipping a half-composed path that fails after the user clicks.
- The hosted compatibility gate remains an operational assurance step for a
  deployment that supplies credentials. Stopping at the enrollment dialog is
  only a bootstrap asset and signaling check and does not satisfy the gate.

## Migration Plan

`npm run dev` builds the shared workspace dependencies and server-owned UI from
a clean checkout, then deterministically stages and explicitly selects the
approved runtime. Packaged builds continue to resolve only the staged
`resources/webrtc-runtime` directory.
