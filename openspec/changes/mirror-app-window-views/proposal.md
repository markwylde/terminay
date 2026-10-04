## Why

An app window is only alive on the device that controls its terminal. Every other device attached to that terminal sees the window's tab and a notice that it "runs on the device controlling the terminal", so someone watching a terminal from a phone or a second desktop cannot see what the agent put on screen, or what the person in control is doing in it. The terminal itself does not behave like that: an observer sees it live and read-only.

Views should behave as the terminal does. The client in control runs the view; everyone else watches it live.

## What Changes

- The client that controls a terminal keeps running each window's real view, as it does now, and additionally records the view's document and every later change to it (DOM mutations, input values, scroll, pointer position) with **rrweb**.
- The Terminay Server relays that recording to every other client attached to the terminal. It is a relay: it keeps no copy of a view's document.
- A client that does not control the terminal shows a **live, read-only mirror** of the view in the same window frame, in place of today's notice. It is marked as a mirror and still offers the terminal's ordinary takeover to interact.
- Recording runs only while at least one other client is watching. A client that starts watching, or a mirror that falls out of step, gets a fresh full snapshot from the controlling client.
- The mirror is scaled to fit the watching client's window, so a desktop-width view is legible in a phone sheet.
- Password fields are masked in the recording. Canvas, video, and cross-origin frames inside a view are not mirrored and show a placeholder.
- A view of any size is mirrored: a large snapshot is streamed in parts. An observer whose connection cannot deliver a whole snapshot says so, stops asking, and recovers when one arrives.
- A new negotiated capability, `app-window-mirror.v1`. A client or server without it behaves as today.
- New dependency: `rrweb`, pinned to one exact version and shipped in the workspace bundle.

Not changing:

- What happens on takeover. The new controlling client starts the view afresh from the server's record, and state that lived only inside the old view does not transfer. A mirror cannot be promoted to a live view.
- View isolation (ADR-0038). The mirror runs in the same self-sandboxing proxy as a view.
- No browser runs on the server.

Out of scope, and not precluded: a window source that shows a remote X11 display through a VNC client in the same window frame. That source would be shared between clients by VNC itself and would not use this mirror.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-app-windows`: the requirement that only the controlling client shows a view changes, so that other clients show a live read-only mirror; requirements are added for the recording, the relay, late joiners, masking, limits, and the capability.

## Impact

- **Builds on** the `terminal-app-windows` change and ships in the same pull request (#332). That change must be archived before this one, because this delta modifies a requirement it introduces.
- `packages/server-core/src/appWindows/mirror.ts`: mirror relay operations and events, watcher bookkeeping per terminal session, size limits. No view content is stored.
- `packages/server-core/src/connection.ts`: an event that carries bytes is now sent with them, uncoalesced. Before, only terminal output kept its body.
- `packages/protocol`: capability `app-window-mirror.v1`.
- `packages/client-core/src/appWindows.ts`: publish, subscribe, and snapshot-request calls.
- `src/workspace/appWindows/`: recorder injected into the view document, the mirror document and its bridge, the read-only mirror presentation in `AppWindowHost`.
- `public/app-view.html`: unchanged; the proxy frames whatever document the workspace gives it, so `terminay.com` needs no further change.
- `package.json`: `rrweb` and its `rrweb-snapshot` (MIT), pinned. The recorder (about 186 KB) is sent to a view only when someone watches it; the replica (about 66 KB) is part of each mirror document. Both are built by `scripts/build-app-view-mirror.mjs` into a committed generated file.
- Security: recorded events are untrusted data from an untrusted view. They are replayed only inside the sandbox, never interpreted by the workspace or the server.
- Privacy: whatever is visible in a view becomes visible to every client attached to that terminal, which already see everything in the terminal itself.
