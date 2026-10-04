# ADR-0039: An app view is mirrored to observers from the controlling client; the server relays and keeps nothing

Status: accepted
Date: 2026-10-04

## Context

ADR-0037 makes an app window server-owned state of one terminal session, and
ADR-0038 runs its view in an opaque-origin sandbox on a client. The view's live
state therefore exists in one browser: the client that holds the terminal's
interactive presentation lease. Other clients attached to the terminal could not
see it.

Three ways to show a view on more than one client were considered:

- Run an independent copy on every client. Each copy has its own state, so
  observers do not see what the person in control does.
- Run the view in a browser on the server and stream pixels. This needs a
  headless browser and a display per window on every server, has no equivalent
  on macOS Desktop, and moves untrusted HTML out of a client sandbox onto the
  server machine, undoing ADR-0038.
- Record the view's DOM on the controlling client and replay it on the others.

## Decision

1. **The controlling client is the only place a view runs.** It is also the
   source of truth for what the view looks like.
2. **Observers get a live, read-only mirror**, produced by recording the view's
   document and its changes on the controlling client and redrawing them. The
   recorder is `rrweb`, pinned to one exact version and shipped in the bundle.
   The mirror is drawn by a Terminay-authored replica built on `rrweb-snapshot`,
   because `rrweb`'s own replayer needs a same-origin child frame that the
   sandbox does not allow
   ([evidence](./evidence/app-view-mirror-spike.md)).
3. **The server is a relay.** It authorises a recording by the presentation
   lease, delivers it only to the clients watching that terminal, enforces size
   limits, and stores nothing. It never parses a recording and no browser runs
   on it.
4. **A recording is untrusted data.** It is redrawn only inside the ADR-0038
   sandbox, in a document whose content security policy allows the replica's
   script by nonce and no other script.
5. **A mirror is never promoted to a view.** When control moves, the new holder
   starts the view from the server's record (ADR-0037); in-page state does not
   transfer.
6. **Recording happens only while someone is watching**, and recovery is always
   a fresh snapshot from the controlling client, requested on demand, never on a
   timer (ADR-0028).
7. **Mirroring belongs to the view presentation, not to windows.** A window
   source whose content is shared between clients by its own protocol, such as a
   remote display, runs on every client and does not use the mirror.

## Consequences

- No server gains a browser dependency, and Desktop on macOS needs no display
  server.
- View contents never rest on the server.
- Canvas, video, audio, and cross-origin frames inside a view are not mirrored.
- A mirror shows the controlling client's layout scaled to fit, not a layout
  native to the observer's screen.
- State loss on takeover remains, and is now visible to the person taking over.
- A view that needs several people to interact at once must keep its state on
  its own server and be driven through tools; the mirror does not provide it.
- `rrweb` becomes a pinned runtime dependency whose behaviour inside an
  opaque-origin sandbox must be re-measured when its version changes. The
  replica reads `rrweb`'s event format directly, so a version change can break
  it; the sandbox test in `e2e/app-view-mirror.spec.ts` is the check.
- One message must fit the server's event delivery budget, so a snapshot is
  streamed in parts and a view's size does not limit whether it is mirrored.
  The controlling client is paced against the server, not against each
  observer; an observer on a much slower link can fail to receive a large
  snapshot whole, and then says so instead of asking forever.
