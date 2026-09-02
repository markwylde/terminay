## 1. Direct network listener

- [x] 1.1 Bind the explicit direct network listener to the embedded Local
  `ServerCore` using the configured interface, port, and TLS policy, and verify
  no second server authority is constructed
- [x] 1.2 Serve the framed application stream plus one-time pairing, PIN
  validation, device enrollment, reconnect challenge/completion, and bounded
  credential handling from that listener
- [x] 1.3 Make listener start, stop, and rotation atomic and fail closed, and
  verify a bind, TLS, or protocol startup failure publishes no usable pairing URL
- [x] 1.4 Verify direct-network pairing boots the exact verified browser
  workspace bundle without a navigation-time Bearer header, that the complete
  fragment-bearing pairing link is visible and copyable, and that another
  Desktop accepts it through **Add connection…**
- [x] 1.5 Persist only the permitted embedded device and reconnect records
  beneath the Desktop data root and verify restoration against the exact server
  identity and origin

## 2. Exposure presentation

- [x] 2.1 Add explicit per-mode availability to the Desktop status/host contract
  and verify the menu disables start and QR actions with **Unavailable in this
  build** when a mode lacks its privileged composition
- [x] 2.2 Keep the private hosted-service compatibility gate explicit about its
  boundary, and verify it does not claim canonical application traffic before
  the full WebRTC composition exists
- [x] 2.3 Replace the QR-type selector with one primary WebRTC **Expose this
  server…** lifecycle and an independently labelled advanced **Direct network
  listener** lifecycle
- [x] 2.4 Verify the private Local transport stays connected and visually
  separate, and that neither exposure route can rebind or replace the Local window
- [x] 2.5 Label the non-secret **Server/session origin** and the consumable
  **Pairing link**, and verify copy and QR actions carry the complete
  short-lived fragment credential and expiry
- [x] 2.6 Verify the direct listener never starts as an implicit fallback when
  WebRTC is unavailable, and that the missing runtime or registrar is shown
  before the user acts

## 3. Privileged WebRTC composition

- [x] 3.1 Compose the integrity-pinned Werift runtime in packaged and
  development Desktop builds only when one authenticated hosted registrar
  supplies both room registration and per-peer SDP/ICE signaling
- [x] 3.2 Restore the deployed `v1` hosted bootstrap as an in-process privileged
  Werift peer over the selected runtime, authenticated room signaling, PIN and
  device enrollment, the embedded authority's live terminal sessions, and the
  embedded server's verified UI bundle, and verify it creates no hidden Electron
  renderer and exposes no renderer preload capability
- [x] 3.3 Update `npm run dev` to build shared workspace dependencies and the
  server-owned UI from a clean checkout before deterministically staging and
  explicitly selecting the approved runtime, and verify packaged builds resolve
  only `resources/webrtc-runtime`
- [x] 3.4 Replace the bootstrap peer's `api`/`asset`/`terminal` channels with the
  canonical `control`/`application`/`terminal`/`assets` session after device
  authentication, and verify the authenticated ticket is consumed exactly once
  before the embedded `ServerCore` accepts the application lane
