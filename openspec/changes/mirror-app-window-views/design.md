## Context

`terminal-app-windows` (PR #332) gives each terminal session a set of server-owned windows. The server holds a window's HTML, tool input, and tool result. Only the client that holds the terminal's interactive presentation lease runs the view; other clients show a notice. A view runs in an opaque-origin `srcdoc` frame nested in a self-sandboxing proxy document (ADR-0038), and talks to the workspace through a validated `postMessage` contract (`AppViewBridge`).

A view's live state exists in one browser only. The alternatives for showing it elsewhere were weighed with the owner before this proposal:

- **Run the view on every client.** Cheap, but each copy has its own state, so observers do not see what the person in control is doing.
- **Run the view on the server and stream pixels (VNC).** Needs a headless browser and a display per window on every server, has no equivalent on macOS Desktop, moves untrusted HTML from a client sandbox onto the server machine, and gives blurry, unselectable output.
- **Mirror the DOM from the controlling client.** Chosen. `rrweb` records a document as a snapshot plus incremental events and replays them live elsewhere.

In-force ADRs that bind this design: 0005 and 0011 (untrusted renderer content), 0018 (one bundle, negotiated capabilities), 0028 (no polling), 0031 (MCP authority; unaffected, no MCP surface is added), 0036 (CI budget), 0037 (windows belong to the calling terminal session and are server-process state), 0038 (view isolation).

## Goals / Non-Goals

**Goals:**

- An observer sees a view as the controlling client shows it, live, read-only.
- No browser on the server and no view content stored on the server.
- Isolation exactly as ADR-0038: recorded data is untrusted and is only ever replayed inside the sandbox.
- No cost when nobody is watching.
- Works on Desktop, direct browser sessions, and hosted sessions without a further `terminay.com` change.

**Non-Goals:**

- Transferring a view's in-page state on takeover.
- Observers interacting with a view.
- Mirroring canvas, video, audio, or cross-origin frames.
- X11 or VNC window sources.

## Decisions

### 1. The workspace sends the recorder to a view only when someone watches

`viewDocument.ts` builds each view document. Every view, from either source, now carries a loader of a few lines. It does nothing until the workspace posts it the recorder: the `rrweb` record bundle plus a small driver, about 186 KB. The driver starts and stops on a message from the workspace and posts events to its parent in batches.

- The recorder must run in the view's own document; a parent cannot observe an opaque-origin child.
- Inline script is already permitted by every view's policy, so no policy changes.
- A view nobody watches never receives the recorder.
- The driver gathers events for 40 ms after the first one and sends at most one batch at a time; the next waits for the workspace's acknowledgement. This is flow control without polling (ADR-0028).

*Alternative:* inline the recorder into every view document. Rejected: it adds 186 KB to every view for a feature most views never use. *Alternative:* have views opt in by loading a script. Rejected: third-party MCP Apps would never be mirrored.

### 2. Recording is transported on the existing view channel, as opaque data

Batches travel view → proxy → workspace on the existing `postMessage` path. Mirror messages are not JSON-RPC: they are objects with one `terminayMirror` key, so a view's own MCP Apps transport ignores them. `ViewRecorderLink` validates a batch's envelope (kind, epoch, sequence number, byte size) and treats the recording as an opaque string. The workspace never walks or interprets it, and acknowledges a batch only once the server has taken it.

**Boundary:** this is the ADR-0011 boundary between untrusted view content and the workspace. A hostile view can forge any recording it likes; the worst outcome is a misleading picture inside an observer's sandbox, which the view could already draw in its own document.

### 3. The server is a stateless, lease-checked relay

New operations on the app-windows service (`appWindows/mirror.ts`):

- `app-windows.mirror.watch` / `unwatch` (read scope): a connection declares it is watching a terminal session's windows. Refused for a client that did not negotiate the capability.
- `app-windows.mirror.status` (read scope): whether anyone other than the holder is watching. The controlling client asks this when it starts a view, because it may have taken control after the watchers arrived.
- `app-windows.mirror.publish` (write scope): accepted only from the client that is `presentationHolder` for the session, checked per call. The envelope carries window id, epoch, sequence number, and kind; the recording is the command's binary body.
- `app-windows.mirror.resync` (read scope): a watcher asks for a fresh snapshot. Coalesced while one is outstanding.

New events, both transient and addressed to one client by `clientId`, which the connection already honours: `app-windows.mirror.data` (to each watcher, with the recording as the event's body) and `app-windows.mirror.wanted` (to the holder: record, send a fresh snapshot, or stop).

The protocol caps a JSON envelope at 64 KiB, so a recording cannot ride in a payload. `connection.ts` previously dropped the body of every event except terminal output; it now sends an event's body when it has one, and never coalesces such an event with another.

The server holds no recording. A late joiner or a resync causes the holder to take a new full snapshot, which starts a new epoch delivered to all watchers.

*Alternative:* cache the last snapshot and following events on the server so joins need no round trip. Rejected: it stores view content on the server, needs eviction and a memory budget per window, and saves only one round trip on a rare event.

**Boundary:** publish is authorised by the presentation lease, the same authority that decides who may type into the terminal. Delivery is by client id to connections that asked to watch.

The standalone Terminay Server does not compose app windows at all yet, so the relay is live on Desktop's embedded server only; it is part of the shared composition and comes with app windows wherever they are composed.

### 4. The mirror is a Terminay-authored document in the same proxy

An observer's window loads the same `app-view.html` proxy and gives it a *mirror document* instead of a view: a policy and one script, the replica.

- `rrweb`'s own replayer draws into a same-origin child frame and reaches into it. A mirror's frame is sandboxed without `allow-same-origin`, a nested frame inherits that, and a document cannot reach into an opaque-origin child. The replica therefore rebuilds the snapshot with `rrweb-snapshot` into **its own document**, replacing its document element, and applies mutation, input, scroll, pointer, viewport, and stylesheet-rule events itself.
- What keeps recorded content inert is the mirror document's policy: `script-src 'nonce-…'` for the replica and nothing else. A recorded script element, inline handler, or `javascript:` link cannot run. `rrweb-snapshot` also rebuilds `script` as `noscript`.
- The policy takes `style-src`, `img-src`, and `font-src` from the mirrored window's own policy and closes everything else (`connect-src`, `frame-src`, `media-src`, `form-action`).
- The mirror document has no `window.terminay`; the workspace accepts from it only "ready", its size, and "failed".

### 5. Epochs and sequence numbers make a mirror either correct or loading

Every snapshot starts a new epoch with sequence 0. An observer applies a batch of changes only if it has that epoch's snapshot and the batch's sequence is the next one. Anything else: discard state, show loading, call `resync`. A snapshot is always accepted as the new truth, whatever its epoch number, because a replaced document or a new controlling client starts counting from one again. The connection reporting dropped events is treated as a gap on every mirror.

### 6. A snapshot is streamed; nothing caps the size of a view

A snapshot of any size is sent as a run of parts of at most 128 Ki characters, each its own message, each acknowledged before the next is sent. The first part says how many there are; a watching client joins them and draws the snapshot once it has them all, and keeps showing what it had until then. Changes are numbered after the parts and apply only to a whole snapshot.

One message cannot carry a large snapshot: the server queues at most 1 MiB of events per subscription and replaces a larger frame with a resync notice. The first build sent a snapshot as one message and so had a 768 KiB cap on a view; streaming removes it.

| Bound | Value | What happens |
| - | - | - |
| One part of a snapshot | 128 Ki characters, at most 512 KiB | The unit of streaming, not a limit on the view |
| Parts in one snapshot | 128 (about 16 M characters) | A runaway guard; beyond it the view is reported as not mirrorable |
| One batch of changes | 256 KiB | The recorder drops it and streams a snapshot instead |
| Snapshot requests in a row with none arriving whole | 4 | The mirror says it cannot be shown and stops asking; the next whole snapshot brings it back |

There is no rate limit. One message is in flight at a time, so a busy view is paced by the connection, as terminal output is.

The last row is the only limit that is not a guard. Acknowledgement paces the controlling client against the server, not against each observer, so an observer on a much slower link can be sent parts faster than it drains them, lose one, and ask again. It gives up after four attempts instead of asking forever.

### 7. What is recorded

`rrweb` options are fixed by Terminay, not by the view: password inputs masked, canvas recording off, cross-origin iframe recording off, media interaction off, pointer movement sampled, inline stylesheets and same-policy images captured by reference (the mirror loads them itself under its own policy).

### 8. Observer presentation

The window frame, placement, tab, and badge are unchanged. The body shows the mirror with pointer events disabled, scaled by `observerWidth / recordedWidth` with a CSS transform, and the window's height follows the scaled height. A one-line bar reads "Mirror · Take control to use this window" with the existing takeover action. Loading and unavailable states reuse the existing notice.

### 9. Capability

`FEATURE_CAPABILITIES.appWindowMirror = 'app-window-mirror.v1'`, advertised only with `app-windows.v1`. A client without it never calls `watch`, so it never starts a recording.

### 10. Dependency

`rrweb` and `rrweb-snapshot`, one exact version, MIT. `scripts/build-app-view-mirror.mjs` bundles the recorder and the replica into strings in `src/workspace/appWindows/mirror/bundles.generated.ts`, which is committed; a smoke test rebuilds them and fails if the committed file is out of date or was built from another version. Nothing is fetched at run time.

The scripts cannot be ordinary bundle chunks: they run inside sandboxed documents the workspace assembles as text, which cannot load a script by URL from `file://` on Desktop or without a further `terminay.com` route on hosted sessions.

### 11. Other window sources stay possible

Mirroring is a property of the *view* presentation, selected in `AppWindowHost`. A future source whose content is shared by its own protocol (for example a VNC client showing a remote X11 display) declares that it is shared, runs on every client, and takes no part in recording, watching, or the lease check on publish.

## Risks / Trade-offs

- **[The replica reads `rrweb`'s event format itself]** → the format is pinned with the version, and `e2e/app-view-mirror.spec.ts` exercises it in the real sandbox. Event kinds the replica does not handle (adopted and constructed stylesheets, canvas, media, selection) are ignored, so such a view mirrors incompletely, not incorrectly ordered.
- **[A busy view floods the connection]** → one message in flight at a time, acknowledged before the next, so the view is paced by the connection.
- **[An observer on a much slower link than the controlling client]** Acknowledgement paces the controlling client against the server, not against each observer. Such an observer can lose part of a large snapshot and ask again; it gives up after four attempts and says so. Pacing against the slowest observer would need per-observer acknowledgement through the server and is not in this change.
- **[Mirror fidelity]** Styles that depend on viewport width render at the holder's width and are scaled, so a phone observer sees a small desktop layout, not a phone layout. Accepted: the mirror shows what the person in control sees.
- **[A view detects or interferes with the recorder]** A hostile view can break its own mirror. It gains nothing: recording data is untrusted and sandboxed on arrival.
- **[Password masking relies on `type=password`]** A view that draws its own secret field in a plain text input is mirrored in clear. Observers already see everything typed into the terminal.
- **[Takeover still resets the view]** Unchanged and stated in the spec, but a mirror makes the loss visible: an observer watches a half-filled form, takes control, and gets an empty one. The mirror's bar says so next to the Take control button.
- **[Two live clients on one real server are not exercised together in one test]** → the relay is tested against the real server with real protocol clients, and the window layer on two pages against a stand-in relay.

## Migration Plan

1. Ship in the same pull request as `terminal-app-windows`. Archive that change first, so its capability spec exists in `openspec/specs/` when this delta is folded in.
2. Land this change behind the negotiated capability. Old clients and servers keep the notice.
3. Rollback: stop advertising the capability; no stored state exists to clean up.

## Open Questions

- Resolved: `rrweb` 2.1.7, the current release, works inside the sandbox for recording; see the evidence file.
- Safari and Firefox remain unmeasured for the proxy itself (ADR-0038) and so for the mirror.
- No in-force ADR needs revisiting.
