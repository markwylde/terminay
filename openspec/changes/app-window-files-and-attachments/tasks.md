## 1. Spike

- [x] 1.1 Measure how a 256 KiB `ArrayBuffer` gets from an opaque-origin view through `public/app-view.html` to the workspace on Desktop and in a browser: transferred, copied, or refused, and whether the proxy needs a change. Verified by: results in `openspec/adr/evidence/app-window-attachments-spike.md` naming the mechanism per host, and a statement of whether `terminay.com` must change.

## 2. Document from a file, and data

- [x] 2.1 Add `html_file` and `data` to the `show_window` schema in `apps/terminay-server/src/mcp/stdio.ts`: exactly one of `html` and `html_file`, an absolute path, and `data` at most 64 KiB serialised. Verified by: `apps/terminay-server/test/stdio-app-windows.test.mjs` cases for both given, neither given, a relative path, and oversized data.
- [x] 2.2 Read the file in the adapter (`windowDocument.ts`): regular file only, checked on the open file, at most 512 KiB, valid UTF-8, with bounded errors that carry no file contents. Verified by: `stdio-app-windows.test.mjs` cases for missing, directory, device, named pipe, oversized, empty, and invalid UTF-8, each asserting nothing reaches the server and the error text holds none of the file.
- [x] 2.3 Prove the path never leaves the adapter. Verified by: the `stdio-app-windows.test.mjs` case capturing the control request for an `html_file` call and asserting it carries the document and no path.
- [x] 2.4 Store `data` on the window record in `packages/server-core/src/appWindows`, replaced with the content and cleared when a replacement gives none. Verified by: `packages/server-core/test/app-windows.test.mjs` for create, replace with data, replace without, and the 64 KiB bound; `apps/terminay-server/test/app-window-tools.test.mjs` through the tool.
- [x] 2.5 Carry `data` to the controlling client with the window's content in `packages/client-core/src/appWindows.ts`. Verified by: `packages/client-core/test/app-windows.test.mjs`.
- [x] 2.6 Embed `data` in the view document ahead of the author's markup, as a string literal that is parsed, and expose it as a frozen `window.terminay.data`. Verified by: `viewDocument.test.ts` for a value containing `</script>`, U+2028, `&`, and a `__proto__` key, and for no data; the browser test in `e2e/app-windows-browser.spec.ts` where the document's first inline script reads `data`.
- [x] 2.7 Rewrite the `show_window` description to explain `html_file`, `data`, `window.terminay.data`, and attachments. Verified by: the `stdio-app-windows.test.mjs` assertions on the description.

## 3. Attachment protocol and server

- [x] 3.1 Add capability `app-window-attachments.v1` to `packages/protocol`. Verified by: `app-windows-composition.test.mjs`, where a server with app windows advertises it and one composed without them does not.
- [x] 3.2 Add the scratch writer in `packages/server-core/src/appWindows/attachments.ts`: directory `terminay-attachments` under `os.tmpdir()` at mode `0700`, files at `0600`, name `<random>-<sanitised offered name>`, append by part, remove on abandon, and refuse a directory that is a link or another user's. Verified by: `packages/server-core/test/app-window-attachments.test.mjs` for a traversal name, a 300-character name, a name of only disallowed characters, file modes, a linked directory, and removal of a partial file.
- [x] 3.3 Add the upload operations: begin a message with attachment names and sizes, send a part of at most 256 KiB, finish, and cancel, each bound to one window and one message. Verified by: `app-window-attachments.test.mjs` for the happy path, an oversized part, an out-of-order part, a part for an ended upload, seventeen attachments, and a second message begun while one is in flight.
- [x] 3.4 Restrict uploads to the presentation-lease holder and the connection that began them, and end an upload when the lease moves, the window closes, the session ends, or the connection ends. Verified by: `app-window-attachments.test.mjs` for each ending, and `app-windows-composition.test.mjs` for an observer, a takeover part way, and a dropped connection against the real server.
- [x] 3.5 Evaluate Window Messages once at begin, before any part is accepted. Verified by: `app-windows-composition.test.mjs` for Ask Permission pending, declined, allowed, and Never Allow, each asserting whether the scratch directory gained a file and that no part was read from the view.
- [x] 3.6 Compose and deliver the pasted message: the view's text, then one `Attached: <path>` line per file, through the existing paste-and-submit path, with the 16 KiB bound on the view's text only. Verified by: `app-windows-composition.test.mjs` for text with a file without bracketed paste and two files with empty text with it; `app-window-attachments.test.mjs` for a failed second write and a message that cannot be typed, each leaving no file.
- [x] 3.7 Confirm no path reaches a client. Verified by: `app-window-attachments.test.mjs` asserting the delivery result holds only the window id, and `app-windows-composition.test.mjs` asserting no event sent to a client names the scratch directory or the file.

## 4. Workspace

- [x] 4.1 Extend the bootstrap in `viewDocument.ts`: `sendMessage(text, { files })`, `window.terminay.attachments`, and answering the host's requests for one part of an offered file. Verified by: `viewDocument.test.ts` for the generated script, and the browser test where `attachments` is false without the capability and a `files` call is refused.
- [x] 4.2 Handle attachment requests in `viewBridge.ts` for agent-authored views only, with the count bound, and read parts from the view on request, accepting exactly the bytes asked for. Verified by: `viewBridge.test.ts` for an MCP App view, no capability, seventeen files, malformed entries, a part of the wrong length, and a view that goes away mid-read. The gesture rule is the proxy's and is covered in 5.3.
- [x] 4.3 Show the large-attachment confirmation in the window frame in `AppWindowHost.tsx` when the total is over 8 MiB, with file count and size, at desktop and phone width. Verified by: `e2e/app-windows-browser.spec.ts` for confirm, decline (window unchanged, view told), a total under the threshold showing nothing, and the phone sheet.
- [x] 4.4 Show upload progress and a cancel control in the window frame. Verified by: the browser E2E that cancels part way, and one that closes the window part way, each delivering nothing.
- [x] 4.5 Show attachment names and sizes in the Window Messages prompt. The strip renders a request's details as given, so the lines are composed on the server. Verified by: `scripts/mcp-approval-strip.test.mjs` for a request with attachment details, and `app-windows-composition.test.mjs` for the lines themselves.
- [x] 4.6 Apply the proxy change if 1.1 found one is needed. None is: the proxy already relays structured-clone payloads. Verified by: `public/app-view.html` is unchanged and the hostile-view test in `e2e/app-windows.spec.ts` still passes.

## 5. End to end

- [x] 5.1 Desktop: a view sends text and a 3 MiB image; the terminal receives the text and a path, and the file at that path matches. Verified by: `e2e/app-windows.spec.ts`.
- [x] 5.2 Browser: 300 KiB without a question, 9 MiB through the confirmation at desktop width and on a 390 px touch sheet. Verified by: `e2e/app-windows-browser.spec.ts`.
- [x] 5.3 A hostile view cannot upload without a gesture, cannot choose a path, cannot answer the confirmation, and cannot learn a path. Verified by: cases added to the hostile-view test in `e2e/app-windows.spec.ts`, the unattended case in `e2e/app-windows-browser.spec.ts`, and the confirmation asserted to be outside the view's frame.
- [x] 5.4 A client that does not control the terminal cannot start an upload, and takeover during an upload ends it cleanly. Verified by: `app-windows-composition.test.mjs` against the real server. An observer's workspace runs no view, only a mirror, so there is nothing for a browser test to press.
- [x] 5.5 A closed terminal leaves its delivered attachments on disk. Verified by: `app-windows-composition.test.mjs`, which exits the terminal's process and lists the directory.

## 6. Documentation and delivery

- [x] 6.1 Document `html_file`, `data`, attachments, the 8 MiB confirmation, and that files are not removed, in `docs/product-overview.md`. Verified by: the section exists and states each.
- [x] 6.2 Add the scratch directory, its growth, the `tmpfs` limit in the container examples, and how to clear it to `docs/operations/standalone-server.md`. Verified by: the runbook names the directory and the command.
- [x] 6.3 Run `openspec validate --all`, `npm run smoke`, the server, client, and adapter test suites, and the app-window E2E suites through `npm run test:e2e`. Verified by: all pass.
- [ ] 6.4 Open a pull request on `origin` (Gitea) and read back every CI status. Verified by: every status is `success` or `skipped`.
