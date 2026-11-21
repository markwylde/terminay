## Context

On 21 November, macOS entered clamshell sleep, the standalone server saw ICE disconnect, and the server's hosted application connection timed out while the Mac slept. After wake, the server kept responding and saw no replacement peer during the observed retry window. The installed Desktop build already contains the main-frame guard for document reload. The logs do not reveal why Desktop main missed the transport failure.

The renderer's heartbeat can detect missing application replies even when WebRTC still reports open. Today its recovery loop calls `replaceEndpoint()`, which asks main for a new document MessagePort. The remote handler can put that port on the same transport without asking the remote server to negotiate a fresh authenticated connection. If main is already reconnecting, preload waits for a new port. The renderer's 20-second deadline can expire while the hosted connection setup is still inside its separate budget. Retry shares the renderer's attempt gate and leaves the previous error displayed while a new attempt runs. The scoped shell's primary button rule sets a dark label, and the global hover rule paints a dark background.

## Goals / Non-Goals

**Goals**

Recover the affected remote connection in place, acknowledge each Retry activation, and make the outcome visible and diagnosable. Preserve the existing window binding, terminal sessions, and device authentication.

**Non-Goals**

The application protocol, signaling routing policy, and browser and Local recovery stay outside this fix.

## Decisions

1. **Use the application heartbeat to check a remote connection after wake.** Route a one-shot resume hint through Desktop's existing scoped host event delivery to the remote workspace. Reuse the registry's immediate liveness probe, coalescing native wake and document visibility signals. The renderer owns the application probe and its suspend-aware deadline. Desktop main stays protocol-blind. If the window is already recovering, resume its existing recovery operation. Unconditionally rotating peers on wake would interrupt connections that still answer, and relying on visibility events alone misses a window that remained visible.

2. **Give remote recovery an explicit operation at the document byte boundary.** The renderer requests recovery through a narrow preload capability bound to the current sender, document and endpoint generation. Main resolves the profile and window from its binding, uses the existing saved-device authentication path, and hands back only an opaque endpoint and typed attempt status. A request for the current stale generation starts the existing main-process reconnect operation or joins it. During backoff it starts immediately. A request for an older generation can receive the fresh unclaimed endpoint or the in-flight outcome without rotating the peer again. Share the same operation with transport-ended, transport-failed and document-reload handling, preserving the main-frame guard. Reattaching the same stale transport just repeats the application timeout. Moving the reconnect into the renderer would expose the privileged connection owner and credentials.

3. **Give connection setup, endpoint transfer and workspace hydration coordinated deadlines.** Main bounds authenticated setup and reports progress, success or a classified failure; the renderer uses a bounded wait consistent with that setup window and starts the application handshake deadline when it receives the endpoint. Every abandoned generation releases its waiters and resources. Late closes and completions, document reload, explicit server switches and window close cannot replace a newer binding. Keep one paced recovery loop per binding, stop it on pairing or identity refusal, and preserve the established pairing action where needed. An independent retry loop for each layer would keep the UI disconnected from the work main is actually doing.

4. **Render the state of the actual attempt.** The recovery control shows immediate pending feedback on activation, including a join, keeps keyboard focus visible, and replaces the previous timeout with the current attempt's progress and eventual outcome. Style the recovery button's foreground and background together in its default, hover and focus states. Reuse the local diagnostic sink for request, start or join, result and endpoint delivery events. Correlate them with process-local window and attempt identifiers and bounded outcome classes.

5. **Authenticate a revoked device before disclosing the refusal.** An opted-in Desktop join carries the existing device-key proof. The server verifies it with the saved public key before reading out a revocation decision. It returns an Ed25519 signature over a domain-specific payload containing the session ID, device ID and this join's fresh nonce in the existing device-offer route. Desktop verifies that payload with its pinned host key before stopping automatic recovery. Old servers remain usable, and old clients can omit the opt-in. A relay error or silence cannot prove revocation.

## Risks / Trade-offs

- Repeated wake, close and Retry signals can race. Verify one authenticated attempt and one fresh handoff with a controllable fake transport and an in-flight attempt.
- A stale document can wake or close while a replacement is arriving. Verify generation checks, cancellation, and the behavior of a second window, including one bound to the same server.
- An unavailable server can still take time to fail. Show progress as soon as Retry is activated and report the failed stage when the deadline expires.

## Migration Plan

Ship the main process, preload bridge, and packaged renderer together in a Desktop release. Existing remembered profiles and compatible server installations work with the release as installed. Verify with the standalone-server fixture and a packaged macOS clamshell sleep and wake run.

## Open Questions

The live diagnostics did not identify why the old application lane failed to raise a usable edge in Electron. The regression fixture must model a silent stall with an open channel so recovery is verified even when no close event arrives.
