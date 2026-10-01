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

2. **Commit the sanitized profile immediately after device enrollment.** Once the device key and pinned host key are stored, write the metadata-only profile through the existing Desktop host persistence path. A later reconnect or UI-archive failure leaves the saved profile in an unavailable/retryable state. Do not persist the fragment, complete URL, key material, or ticket. Replacing an existing profile with the same identity retains its previous metadata if the new first load fails.

3. **Keep a connection monitor alive after the setup promise resolves.** The monitor owns peer and required-lane state through the lifetime of the returned peer/transport. It applies the existing ICE grace rule, fails once on terminal failure/closure or grace expiry, closes the affected generation, and emits a host event that the UI can associate with the active connection. It does not treat a transient ICE disconnect with a connected peer as immediate failure.

4. **Log candidate-pair changes as local structured diagnostics.** Use WebRTC stats on both the Desktop peer and server peer. Include state, candidate types, protocol, address, and port so operators can compare the route. Exclude SDP, secrets, device credentials, and application data. These network addresses are operational diagnostic data and remain in local host/server logs.

5. **Invalidate room admission synchronously with enrollment approval.** Connect the server-core successful consume/approval path to the hosted pairing host's room refresh so it retires the consumed signaling registration before approval is returned. Preserve the currently authenticated peer and existing device peers. Map an unavailable pairing room to a typed expired-or-used outcome at the Desktop boundary.

6. **Make pairing UI state reflect the actual sequence.** An attempt starts in submitting, changes to waiting only when the host reports a match code, changes to connecting when the approval push arrives, and ends in connected or failed. A single in-flight guard disables repeated submission. Normalize Electron invocation errors at the connection-host boundary and map known pairing/network failures to short user-facing copy.

7. **Separate browser QR links from direct signaling links.** When both modes exist, render hosted by default; explicit direct mode remains available and is labeled for Desktop. The direct listener returns a static no-secrets HTML explanation at `/v1/` while retaining `/signal` and protocol routes.

8. **Document the existing foreground server as the non-systemd container route.** Do not extend the systemd installer to manage arbitrary container supervisors. The runbook will show how to run the bundled standalone server in the foreground with a durable data root, hosted signaling, and a published UDP range; it will state that a direct localhost URL solves only same-host signaling. Root-run CLI privilege-drop failures distinguish missing `sudo` from an inaccessible helper and recommend the service-account/global-install path.

## Risks / Trade-offs

- [WebRTC stats vary by runtime] → Treat absent stats as unavailable and keep connection setup functional; test the pinned runtime shape used in production.
- [Room refresh races with an approved live peer] → Retire only the consumed room registration; assert that enrollment's authenticated peer and paired-device sessions remain open.
- [Early persistence can expose a failed profile in the list] → Show it as unavailable with Retry; do not delete the credential when bundle loading fails.
- [Candidate IPs are sensitive local-network metadata] → Keep diagnostics local and structured, and exclude all pairing and application secrets.
- [Foreground operation requires an operator-managed container lifecycle] → Document signals, persistent volume, port mapping, and restart policy explicitly; retain systemd guidance for supported hosts.

## Migration Plan

No data migration is required. Existing saved profiles remain valid. New profiles are persisted at successful enrollment; any profile already stored for the same device identity is replaced atomically with sanitized metadata. Room rotation affects only new joins using the consumed link. Rollback is a binary rollback and requires no state conversion.

## Open Questions

- Confirm the production WebRTC runtime exposes selected-pair details in `getStats()` on both peers; if not, use the runtime's selected candidate references without dumping SDP.
- Confirm the packaged standalone artifact includes all files required for the documented foreground container command and that the example works without a service account or `sudo`.
