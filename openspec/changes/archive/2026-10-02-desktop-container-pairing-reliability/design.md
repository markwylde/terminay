## Context

The existing contract already allows Desktop to pair with hosted and direct HTTPS links and expects failed connections to remain retryable. The URL parser currently treats loopback as a hosted session before checking the direct `/v1/` path. Desktop saves the profile only after the first remote bundle mounts. WebRTC connection completion is currently a one-shot promise, so later peer state changes do not reach the action UI. Pairing-room consumption lives in server core while signaling admission is managed by the standalone host, which leaves a gap between approval and room rotation.

The related accepted decisions are ADR 0013 (device-bound host approval and channel-only credentials) and ADR 0015 (self-hosted direct signaling). Both remain in force: pairing material remains in the URL fragment and authenticated data channels; direct signaling remains data-blind and the server host key authenticates the transport.

## Goals / Non-Goals

**Goals:**

- Make all links printed by Terminay parse in Desktop, including direct loopback links, and keep their exact origin on reconnect.
- Persist a profile immediately after successful enrollment and leave it retryable if the first remote load fails.
- Retire consumed pairing rooms before approval returns, and report useful liveness and candidate-pair diagnostics.
- Give the pairing surface accurate, non-overlapping progress and actionable errors.
- Make the CLI QR default browser-compatible, explain direct links in a browser, and document workable systemd and foreground-container paths.

**Non-Goals:**

- Do not change pairing cryptography, trust prompts, data-channel enrollment, or the one-time nature of pairing links.
- Do not infer UDP reachability from the signaling origin or promise that a host-published UDP port is reachable through every NAT.
- Do not add a container image or make the systemd installer run without systemd.
- Do not log SDP, secret material, application payloads, or device identifiers as part of ICE diagnostics.

## Decisions

1. **Resolve direct `/v1/` URLs before treating loopback as a hosted session.** `https://localhost:port/v1/` remains direct, and `classifyPairingOrigin` uses the same distinction for reconnect. Keep HTTP loopback embedded-server links on their existing local enrollment path. This preserves the boundary in ADR 0015: the direct origin is a signaling address, not a credential endpoint.

2. **Commit the sanitized profile immediately after device enrollment.** Once the device key and pinned host key are stored, write the metadata-only profile through the existing Desktop host persistence path. A later reconnect or UI-archive failure leaves the saved profile in an unavailable/retryable state. Do not persist the fragment, complete URL, key material, or ticket. Re-pairing an origin that already has a profile keeps that profile's id and label but replaces its device identity, so the new metadata is kept even if the first load fails: the old device key no longer exists to fall back to.

3. **Keep a connection monitor alive after the setup promise resolves.** The monitor owns peer and required-lane state through the lifetime of the returned peer/transport. It applies the existing ICE grace rule, fails once on terminal failure/closure or grace expiry, closes the affected generation, and emits a host event that the UI can associate with the active connection. It does not treat a transient ICE disconnect with a connected peer as immediate failure, but the runtime keeps such a peer `connected` indefinitely, so Desktop adds its own bound: ICE that stays `disconnected` for 15 seconds ends the peer. On failure every request and approval wait on that peer is released at once. Desktop closes a peer's data lanes before the peer itself, because a bare peer close is invisible to the server until its own timeout, leaving a pending approval for a device that has gone.

4. **Log candidate-pair changes as local structured diagnostics.** Use WebRTC stats on both the Desktop peer and server peer. Include state, candidate types, and protocol so operators can compare route classes. Exclude candidate addresses and ports as well as SDP, secrets, device credentials, and application data, consistent with the existing metadata-only diagnostics contract.

5. **Invalidate room admission synchronously with enrollment approval.** Connect the server-core successful consume/approval path to the hosted pairing host's room refresh so it retires the consumed signaling registration before approval is returned. Preserve the currently authenticated peer and existing device peers. Map an unavailable pairing room to a typed expired-or-used outcome at the Desktop boundary.

6. **Make pairing UI state reflect the actual sequence.** The sequence lives in one module (`electron/remote/desktopPairingAttempt.ts`) and one reducer (`src/shared/pairingAttemptState.ts`), both tested by behaviour, so main and the renderer cannot drift from it. A failure before enrollment is reported only as the rejected attempt, never as `connection-lost`, because nothing has been saved yet. A cancel action carries the attempt ID to the privileged host and aborts it there. An attempt starts in submitting, changes to waiting only when the host reports a match code, changes to connecting when the approval push arrives, and ends in connected or failed. Carry an opaque attempt ID through the privileged action and its approval/progress events so delayed events from an older attempt cannot overwrite the current attempt. A single in-flight guard disables repeated submission. Keep connection-loss recovery visible if the pairing panel is closed. Normalize Electron invocation errors at the connection-host boundary and map known pairing/network failures to short user-facing copy.

7. **Separate browser QR links from direct signaling links.** When both modes exist, render hosted by default; explicit direct mode remains available and is labeled for Desktop. The direct listener returns a static no-secrets HTML explanation at `/v1/` while retaining `/signal` and protocol routes.

8. **Document the existing foreground server as the non-systemd container route.** Do not extend the systemd installer to manage arbitrary container supervisors. The runbook will show how to run the bundled standalone server in the foreground with a durable data root, hosted signaling, and a published UDP range; it will state that a direct localhost URL solves only same-host signaling. The root-run CLI hands its socket client to the service account as inline source, so it no longer depends on that account being able to read the CLI install (an `npx` cache under `/root`); privilege-drop failures name a missing `sudo` or an unexecutable Node.js binary.

## Risks / Trade-offs

- [WebRTC stats vary by runtime] → Treat absent stats as unavailable and keep connection setup functional; test the pinned runtime shape used in production.
- [Room refresh races with an approved live peer] → Retire only the consumed room registration; assert that enrollment's authenticated peer and paired-device sessions remain open.
- [Early persistence can expose a failed profile in the list] → Show it as unavailable with Retry; do not delete the credential when bundle loading fails.
- [Candidate IPs are sensitive local-network metadata] → Exclude addresses and ports entirely; retain only candidate types, protocol, and pair state.
- [Foreground operation requires an operator-managed container lifecycle] → Document signals, persistent volume, port mapping, and restart policy explicitly; retain systemd guidance for supported hosts.

## Migration Plan

No data migration is required. Existing saved profiles remain valid. New profiles are persisted at successful enrollment; any profile already stored for the same device identity is replaced atomically with sanitized metadata. Room rotation affects only new joins using the consumed link. Rollback is a binary rollback and requires no state conversion.

## Findings During Implementation

- The selected runtime exposes the selected pair in `getStats()` (a `transport` entry naming the nominated `candidate-pair`, with `candidateType` and `protocol` on each candidate). The real-WebRTC pairing test asserts the projected fields.
- The reported "ICE connects, then `iceState=disconnected` about five seconds later" is reproduced exactly by a client closing a peer: the server keeps `peerState=connected` and reports ICE `disconnected` after its consent checks lapse. In the original report each such line follows an approval or a repeated join by about five seconds, so it most likely described retired pairing peers rather than a failing UDP route. The container guidance on UDP reachability is still correct, but that log line alone is not evidence of it; the runbook now says so.
- A peer whose other end has gone away is never reported failed by the runtime: it stays `connected` with ICE `disconnected`. That is why Desktop needed its own bound and why closing lanes before the peer matters.

## Open Questions

- The standalone server still treats ICE `disconnected` on a `connected` peer as transient with no bound, so a browser pairing peer that vanishes is held until the handshake timeout. Bounding that on the server is left for a separate change because it affects live sessions.
- The documented foreground container command follows from the distribution's launcher, which supplies the UI bundle and WebRTC runtime, but has not been exercised end to end in a stock container.
