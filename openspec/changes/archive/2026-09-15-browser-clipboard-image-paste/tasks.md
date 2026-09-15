## 1. Server scratch write

- [x] 1.1 Add `terminal.materialize-clipboard-image` as a `commandWithBody`
      operation: authenticate against the focused terminal's project, accept
      only `image/png|jpeg|webp|gif`, cap the body at 8 MiB, write
      `clipboard-<uuid>.<ext>` under `join(os.tmpdir(), 'terminay-clipboard')`,
      and return the absolute path. Reject a client-supplied destination.
      Verified by server-core tests covering happy path, oversize, bad MIME,
      missing auth, and a smuggled path that is ignored.
- [x] 1.2 Wire the operation through the existing binary command envelope (same
      family as dictation / extension upload), not `files.create` and not
      base64 JSON. Verified by the handler receiving a raw `Uint8Array` body
      and by `files.create` tests still rejecting paths outside the project.

## 2. Client clipboard read

- [x] 2.1 Extend terminal paste interaction so a user-gesture read prefers
      non-empty text, then an accepted image blob, using
      `navigator.clipboard.read()` as the first clipboard call in the handler
      (no Desktop-bridge await first). Verified by unit tests with fake
      `ClipboardItem`s for text-only, image-only, both, denial, and empty.
- [x] 2.2 Extract image files from a trusted `paste` event
      (`clipboardData.files` / `items`) with the same preference order.
      Verified by unit tests feeding a `DataTransfer` with a PNG file, with
      text, and with both.
- [x] 2.3 Add a client-core helper that uploads the blob through
      `commandWithBody` and returns the server path. Verified by a transport
      fake that records the operation name, MIME, body length, and returned
      path.

## 3. Terminal surfaces

- [x] 3.1 Drive the mobile accessory Paste control and the context-menu paste
      through the new read-then-materialise helper, then insert the
      shell-escaped path via the existing panel input queue. Verified by the
      paste helper tests and by typecheck.
- [x] 3.2 On a browser terminal, claim a `paste` event that contains an image,
      upload it, and insert the path; leave text-only paste to the existing
      exact-origin path. Desktop's Electron image path stays first when the
      Desktop clipboard bridge is present. Verified by unit tests of the
      intercept decision, and by a Playwright paste-event upload inserting a
      `/tmp/terminay-clipboard/` path.
- [x] 3.3 On upload failure, write the same class of inline error the browser
      drop path uses; on clipboard denial, insert nothing and refocus.
      Verified by the failure-path unit tests.
- [x] 3.4 Issue the pointer-activated read from the event that carries user
      activation for its pointer type (`pointerup` on touch, per HTML's
      activation triggering input events), and fall back to the text-only
      clipboard route where a host exposes no item route. Verified by
      activation-latch and text-route unit tests.
- [x] 3.5 When the browser refuses the read, offer a focused editable field
      rather than terminal output, and carry its native paste event through the
      same preference order and server materialisation. Verified by unit tests
      covering the refusal route and an image paste event through upload.

## 4. Verification

- [x] 4.1 Run `npx openspec validate browser-clipboard-image-paste --strict`
      and `npx openspec validate --all`. Verified by both commands exiting
      zero.
- [x] 4.2 Run `npm run lint`, `npm run typecheck`, and the new unit suites.
      Verified by all commands exiting zero.
- [x] 4.3 Confirm on a real iPhone in Safari: copy a screenshot, tap Paste,
      dismiss or accept the paste callout, and see a `/tmp/terminay-clipboard/`
      path appear in the terminal that `ls` can open on the server. Also
      confirm long-press Paste on the terminal with an image on the clipboard.
      Verified on device; Docker E2E cannot drive the iOS callout.
