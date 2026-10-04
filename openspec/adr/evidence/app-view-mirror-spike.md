# Mirroring an app view from the controlling client: spike and implementation checks

Date: 2026-10-04
Supports: ADR-0039
Code: `e2e/app-view-mirror.spec.ts` with `e2e/fixtures/app-view-mirror-main.ts`
(the spike, kept as a test), `src/workspace/appWindows/mirror/`

## Question

Can a view that runs in the ADR-0038 sandbox on one client be shown live on
another client, without a browser on the server and without weakening the
sandbox, using `rrweb`?

## Method

Chromium in the Docker end-to-end image. A page was served over HTTP with the
exact `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`; `public/app-view.html` was
served from the same listener with the exact proxy headers a Terminay Server
sends. The page framed the proxy twice. One proxy got a view document, the other
a mirror document, and the page handed each recorded batch from the first to the
second.

## Results

**Version.** `rrweb` 2.1.7, the current `latest` on npm, with `rrweb-snapshot`
2.1.7. The 1.x line was not tried: 2.1.7 worked.

**Recording works inside the sandbox.** `rrweb`'s `record` ran in the
opaque-origin view frame and emitted a full snapshot followed by incremental
events for added nodes, text and attribute changes, input values, checkbox and
select state, and scroll.

**The stock replayer is not used.** `rrweb`'s `Replayer` draws into a child
frame it creates with `sandbox="allow-same-origin"` and reaches into that
frame's document. A mirror runs in a frame that is itself sandboxed without
`allow-same-origin`; a nested frame inherits that flag, gets its own opaque
origin, and cannot be reached from its parent. This was reasoned from the
sandbox model, not measured. `rrweb-snapshot` 2.1.7 also refuses to rebuild into
any document that is not such a frame unless told the caller accepts the risk.

**A replica that draws into its own document works.** The mirror document holds
one script (`replicaEntry.ts`, bundled with `rrweb-snapshot`). It rebuilds the
snapshot with `buildNodeWithSN` and replaces its own document element, then
applies mutation, input, scroll, pointer, viewport, and stylesheet-rule events
itself. Measured in the mirror: text, attributes, computed style from a recorded
`<style>`, input value, checkbox, select, and scroll position all matched the
view.

**Nothing recorded can run in a mirror.** The mirror document's policy is
`script-src 'nonce-…'` for the replica alone. Measured: a recorded `<script>`
was rebuilt as `<noscript>` and did not run; a script element added later did
not run; an inline `onclick` and a `javascript:` link did nothing when clicked
in the mirror, and both ran in the view; the mirror's `self.origin` was `null`
and it could not read the workspace document.

**Passwords.** With `maskInputOptions: { password: true }` a value typed into a
password field arrived in the mirror as `*******`.

**The proxy is unchanged.** The mirror document went through the unmodified
`public/app-view.html`. Hosted sessions therefore need nothing beyond what
`terminay.com` pull request 104 already serves.

**Sizes.** The recorder bundle is about 186 KB of script and the replica about
66 KB, both minified. The recorder is not placed in a view up front: every view
carries a loader of a few lines, and the workspace sends the recorder to a view
the first time someone watches it.

**Flow control.** The recorder sends one batch and waits for an acknowledgement.
With acknowledgements held, five changes produced one further batch, and the
rest arrived after release.

**Restarting.** `rrweb` delivers a last event after `record`'s stop function has
been called. The recorder driver ignores events while stopped; without that it
waited forever for an acknowledgement of a batch nobody wanted. Found by the
two-client test and covered there and in the spike.

## What changed from the proposal

- **Limits.** The server's event lane queues at most 1 MiB per subscription, and
  a larger frame is replaced by a resync notice. A 4 MiB snapshot was accepted
  and never delivered. The limits are therefore 768 KiB for a snapshot, 256 KiB
  for a batch of changes, and 1 MiB relayed per window per second.
- **Bytes, not JSON.** The protocol caps a JSON envelope at 64 KiB, so a
  recording travels as the body of the publish command and of the event. The
  connection now sends an event's body for any event that has one, uncoalesced.
- **Targeted delivery.** The relay addresses each watcher by client id, which
  the connection already honours for an event whose payload names a client.

## Implementation checks

- `packages/server-core/test/app-windows-composition.test.mjs`: against the real
  server with real protocol clients, a recording from the controlling client
  reaches watchers and nobody else; a non-holder and a former holder are
  refused; oversize batches are refused; the relay holds no reference to a
  delivered batch; resync requests coalesce; a watcher disconnecting stops the
  recording; a client without the capability cannot start one.
- `e2e/app-windows-browser.spec.ts`: the real window layer on two pages, one
  controlling and one observing, joined by a stand-in relay. An observer that
  attaches late sees the view's current state; typing and DOM changes follow
  live; input on the mirror reaches nothing; a replaced document is followed;
  minimising stops the recording and reopening restarts it; taking control swaps
  the roles and restarts the view; a 440-wide view is scaled into a 390-wide
  phone sheet; a view over the snapshot limit shows as unavailable and keeps
  working where it runs.
- `e2e/app-windows.spec.ts`: on Desktop, a hostile view that forges mirror
  traffic changes nothing.

## Not measured

- Two live clients attached to one real server through the real window layer in
  one test. The relay is proven against the real server, and the window layer
  against a stand-in relay.
- The stock `rrweb` replayer inside the sandbox; see above.
- WebKit and Firefox.
- Canvas, video, and cross-origin frames in a mirror. They are excluded by the
  recorder's options and the mirror's policy; what the placeholder looks like
  was not checked.
- Constructed and adopted stylesheets, and shadow DOM. The replica handles
  inline `<style>` rule insertion; views that style through adopted stylesheets
  may mirror unstyled.
- Performance on a large or fast-changing view, beyond the limits tripping.
- A hosted session end to end.
