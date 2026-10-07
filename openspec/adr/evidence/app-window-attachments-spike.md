# Moving file bytes out of an app view: what was measured

Date: 2026-10-07
Supports: ADR-0046
Code: `e2e/app-windows.spec.ts`, `e2e/app-windows-browser.spec.ts`,
`src/workspace/appWindows/viewDocument.ts`, `public/app-view.html`

## Question

A view runs in an opaque-origin frame inside the self-sandboxing proxy
(ADR-0038). Can the bytes of a file a person picked in that view reach the
workspace in bounded parts, and does the proxy, which `terminay.com` also
serves, have to change for it?

## Method

The Docker end-to-end image, in both hosts:

- **Browser.** Chromium, the page served over HTTP under the exact
  `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`, the proxy served with the exact
  headers a Terminay Server sends. A view built a `File` in script and sent it
  with `window.terminay.sendMessage(text, { files })`.
- **Desktop.** The packaged-layout Electron app against its embedded server,
  with the view opened through a terminal's own control socket as an agent
  would. The file was 3 MiB.

In each, the workspace asked the view for the file 256 KiB at a time
(`terminay/attachment-part`); the view answered with `Blob.slice().arrayBuffer()`
and posted the `ArrayBuffer` to the proxy with a transfer list.

## Results

**The proxy needs no change.** It already relays every message with
`postMessage(message, '*')`, which structured-clones whatever the message holds,
an `ArrayBuffer` included. The view transfers its buffer to the proxy; the proxy
copies it to the workspace. That is one copy of at most 256 KiB per part, and no
copy of a whole file anywhere. `public/app-view.html` is unchanged, so the
hosted surface needs nothing either.

**The bytes arrive intact in both hosts.**

- Browser: 300 KiB, 700 KiB, and 9 MiB files arrived with the expected size and
  checksum, and the largest part the workspace received was 256 KiB
  (`a photo attached to an answer is read from the view in parts…`, `large
  attachments are sent only when the person confirms…`).
- Desktop: the 3 MiB file was written by the server under
  `terminay-attachments`, its path was typed into the terminal, and the file
  read back from that path matched byte for byte at the sampled offsets
  (`a file attached to a window message is saved by the server…`).

**The gesture rule holds for a message with files without a new rule.** The
files ride on `ui/message`, which the proxy already passes on only while the
person has just used the view. A view that sent one as it loaded was told "The
user is not using this window" and nothing was uploaded, in both hosts.

**`instanceof ArrayBuffer` is true on arrival.** A structured clone is created in
the receiving realm, so the workspace's check on what a view returns for a part
does not need to be realm-agnostic.

## Not measured

- A file larger than 9 MiB through a real browser. The server path was tested
  with a 5 MiB file in 21 parts (`packages/server-core/test/app-window-attachments.test.mjs`);
  nothing in the design scales with file size except time and disk.
- Upload time over a real remote (WebRTC) connection. The parts use the same
  binary-bodied command path a view's own requests already use.
- Safari and Firefox. The mechanism is `Blob.slice`, `arrayBuffer`, and
  structured clone, which all three implement.
- A phone's own photo picker. The phone test used a file built in script at
  phone width with touch; what a picker returns is the same `File` type.
