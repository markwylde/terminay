## 1. Prove the approach before building on it

- [x] 1.1 In Chromium, under the real workspace policy and the real proxy headers, record a view in the opaque-origin frame with `rrweb` and redraw it live in a second opaque-origin frame; pick a version. Verified by: `openspec/adr/evidence/app-view-mirror-spike.md` records `rrweb` 2.1.7, that the stock replayer is not used and a replica drawing into its own document is, and the bundle sizes; `e2e/app-view-mirror.spec.ts` passes.
- [x] 1.2 Confirm `public/app-view.html` needs no change to carry a mirror document, so hosted sessions need nothing new from `terminay.com`. Verified by: the mirror in 1.1 runs through the unmodified proxy; recorded in the evidence file.
- [x] 1.3 Confirm recorded script cannot run in the mirror: a recorded `<script>`, a script added later, an inline handler, and a `javascript:` link. Verified by: `e2e/app-view-mirror.spec.ts`, which also shows each one does run in the view.

## 2. Protocol and server relay

- [x] 2.1 Add the capability `app-window-mirror.v1`, advertised only alongside `app-windows.v1`. Verified by: `packages/server-core/test/app-windows-composition.test.mjs`.
- [x] 2.2 Add `app-windows.mirror.watch`, `unwatch`, and `status`, with watchers kept per terminal session and cleared when a connection closes or the session ends, and the `app-windows.mirror.wanted` event to the lease holder. Verified by: the composition tests for watching, unwatching, and a watcher that disconnects.
- [x] 2.3 Add `app-windows.mirror.publish`, accepted only from the session's presentation holder and only for a window that exists, and the `app-windows.mirror.data` event delivered to watchers only. Verified by: composition tests for a non-holder publish, a publish after takeover, and a client that is attached but not watching.
- [x] 2.4 Carry a recording as the binary body of the command and of the event, enforce the size of one message on the server, pass on how many parts a snapshot comes in, and keep nothing after delivery. Verified by: composition tests for bodies at and over each limit, a three-part snapshot delivered as three messages, and a test that the relay holds no reference to a delivered recording.
- [x] 2.5 Add `app-windows.mirror.resync`, coalesced while a snapshot is outstanding. Verified by: a composition test with repeated resync calls producing one event.
- [x] 2.6 Wire the relay through the shared composition and advertise the capability on Desktop's embedded server. The standalone server does not compose app windows yet, so it has nothing to wire. Verified by: `e2e/app-windows.spec.ts` passes on Desktop with the capability advertised.

## 3. Client core

- [x] 3.1 Add watch, unwatch, status, publish, resync, and the two event subscriptions to `AppWindowClient`, with recordings as bytes. Verified by: `packages/client-core/test/app-window-mirror.test.mjs`.

## 4. Recording on the controlling client

- [x] 4.1 Add the pinned `rrweb` and `rrweb-snapshot` dependencies and build the recorder and the replica into a committed generated file. Verified by: `scripts/app-view-mirror-bundles.test.mjs` rebuilds them and fails when the file is stale or built from another version.
- [x] 4.2 Put a loader in every view document from `viewDocument.ts`, and send the recorder, with its fixed options (passwords masked, canvas and cross-origin frames off), only when the view must record. Verified by: `viewDocument.test.ts` and `mirror/mirror.test.ts`.
- [x] 4.3 Validate a batch's envelope and size in `ViewRecorderLink`, pass the recording on unread, and acknowledge only once the server has taken it. Verified by: `mirror/mirror.test.ts`, including malformed and oversize batches; `e2e/app-view-mirror.spec.ts` for one batch in flight.
- [x] 4.4 Start, stop, and re-snapshot recording from `wanted` events and the status query; stream a snapshot in acknowledged parts whatever its size; replace a batch of changes over its limit with a snapshot. Verified by: `mirror/mirror.test.ts` for the hub; `e2e/app-view-mirror.spec.ts` for stop and restart, a batch over its limit becoming a multi-part snapshot, and a view of 1.2 M characters of multi-byte text arriving exact.

## 5. Mirror on observers

- [x] 5.1 Build the mirror document: the replica alone, allowed by nonce, with style, image, and font sources taken from the window's own policy. Verified by: `mirror/mirror.test.ts` for the policy per source.
- [x] 5.2 Apply batches by epoch and sequence; on a gap, a failed replica, or dropped events, show loading and resync once. Verified by: `mirror/mirror.test.ts`.
- [x] 5.3 Present the mirror in `AppWindowHost` for a non-controlling client: no input, scaled to the window width, height from the scaled view, a bar saying what it is with the takeover action, and loading and unavailable states. Verified by: `e2e/app-windows-browser.spec.ts` at desktop and phone width.
- [x] 5.4 Watch only while a window of the terminal is open on a non-controlling client, and unwatch when none is. Verified by: `mirror/mirror.test.ts` for the watch count, and the browser E2E for minimise and reopen.
- [x] 5.5 Say beside the takeover action on a mirror that taking control restarts the window. Verified by: an E2E assertion on the text.

## 6. End to end

- [x] 6.1 Extend the browser harness to pages sharing one in-memory store and relay, one controlling and the rest observing. Verified by: the tests in 6.2 run in the Docker E2E.
- [x] 6.2 Cover: a late-joining observer sees current state; typing and DOM changes appear in the mirror; a password field is masked; input on the mirror reaches nothing; an agent replacing the document; minimise stops the recording and reopening restarts it; takeover swaps the roles; a phone-width mirror is scaled; a 2 MiB view is mirrored whole; a connection that loses parts gives up after four attempts and recovers. Verified by: `npm run test:e2e -- e2e/app-windows-browser.spec.ts` passes.
- [x] 6.3 Prove the relay against the real server with real protocol clients: holder publishes, observer receives, lease moves, former holder is refused. Verified by: `packages/server-core/test/app-windows-composition.test.mjs`.
- [x] 6.4 Confirm a hostile view cannot use mirror traffic to reach the workspace. Verified by: forged mirror messages added to the hostile-view test in `e2e/app-windows.spec.ts`.

## 7. Documentation and delivery

- [x] 7.1 Document the mirror, what is not mirrored, the limits, and the takeover behaviour in `docs/product-overview.md`. Verified by: the paragraph exists and names the limits in the design.
- [x] 7.2 Complete `openspec/adr/evidence/app-view-mirror-spike.md` with what was and was not measured. Verified by: it has a "Not measured" section.
- [x] 7.3 Run `openspec validate --all`, `npm run smoke`, and the app-window E2E suites. Verified by: all pass.
- [x] 7.4 Push to pull request #332 on `origin` (Gitea) and read back every CI status. Verified by: every status is `success` or `skipped`.
