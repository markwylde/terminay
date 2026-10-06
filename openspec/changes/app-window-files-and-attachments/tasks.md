## 1. Spike

- [ ] 1.1 Measure how a 256 KiB `ArrayBuffer` gets from an opaque-origin view through `public/app-view.html` to the workspace on Desktop and in a browser: transferred, copied, or refused, and whether the proxy needs a change. Verified by: results in `openspec/adr/evidence/app-window-attachments-spike.md` naming the mechanism per host, and a statement of whether `terminay.com` must change.

## 2. Document from a file, and data

- [ ] 2.1 Add `html_file` and `data` to the `show_window` schema in `apps/terminay-server/src/mcp/stdio.ts`: exactly one of `html` and `html_file`, an absolute path, and `data` at most 64 KiB serialised. Verified by: `npm run test:mcp-stdio` cases for both given, neither given, a relative path, and oversized data.
- [ ] 2.2 Read the file in the adapter: regular file only, final component not followed if it is a link to a non-regular file, at most 512 KiB, valid UTF-8, with bounded errors that carry no file contents. Verified by: `test:mcp-stdio` cases for missing, directory, named pipe, oversized, and invalid UTF-8, each asserting no window is created and the error text holds none of the file.
- [ ] 2.3 Prove the path never leaves the adapter. Verified by: a `test:mcp-stdio` case capturing the control request for an `html_file` call and asserting it carries the document and no path.
- [ ] 2.4 Store `data` on the window record in `packages/server-core/src/appWindows`, replaced with the content and cleared when a replacement gives none. Verified by: `packages/server-core/test/app-windows.test.mjs` for create, replace with data, replace without, and the 64 KiB bound.
- [ ] 2.5 Carry `data` to the controlling client with the window's content in `packages/client-core/src/appWindows.ts`. Verified by: `packages/client-core/test/app-windows.test.mjs`.
- [ ] 2.6 Embed `data` in the view document as an escaped JSON block ahead of the author's markup and expose it as a frozen `window.terminay.data`. Verified by: `viewDocument.test.ts` for a value containing `</script>`, U+2028, and `&`, and for no data; a browser test in `e2e/app-windows-browser.spec.ts` where the document's first inline script reads `data`.
- [ ] 2.7 Rewrite the `show_window` description to explain `html_file`, `data`, and `window.terminay.data`. Verified by: a `test:mcp-stdio` assertion on the description's mention of each.

## 3. Attachment protocol and server

- [ ] 3.1 Add capability `app-window-attachments.v1` to `packages/protocol`. Verified by: a composition test where a server built without it does not advertise it.
- [ ] 3.2 Add the scratch writer in `packages/server-core/src/appWindows`: directory `terminay-attachments` under `os.tmpdir()` at mode `0700`, files at `0600`, name `<random>-<sanitised offered name>`, append by part, remove on abandon. Verified by: `node --test` unit tests for a traversal name, an empty name, a 300-character name, a name of only disallowed characters, file modes, and removal of a partial file.
- [ ] 3.3 Add the upload operations: begin a message with attachment names and sizes, send a part of at most 256 KiB, finish, and cancel, each bound to one window and one message. Verified by: `packages/server-core/test/app-windows.test.mjs` for the happy path, an oversized part, a part for an unknown upload, seventeen attachments, and a second message begun while one is in flight.
- [ ] 3.4 Restrict uploads to the presentation-lease holder and end an upload when the lease moves, the window closes, or the connection ends. Verified by: `app-windows-composition.test.mjs` where an observer's upload is refused, and where each of the three endings leaves no file and types nothing.
- [ ] 3.5 Evaluate Window Messages once at begin, before any part is accepted. Verified by: server tests for Ask Permission pending, declined, allowed, and Never Allow, each asserting whether the scratch directory gained a file.
- [ ] 3.6 Compose and deliver the pasted message: the view's text, then one `Attached: <path>` line per file, through the existing paste-and-submit path, with the 16 KiB bound on the view's text only. Verified by: server tests for text with two files, files with empty text, bracketed paste on and off, and a failed second write that types nothing and removes the first file.
- [ ] 3.7 Confirm no path reaches a client. Verified by: a composition test asserting the delivery result and every event sent to the controlling client and to an observer contain no scratch path.

## 4. Workspace

- [ ] 4.1 Extend the bootstrap in `viewDocument.ts`: `sendMessage(text, { files })`, `window.terminay.attachments`, slicing each file into parts and sending the next only when asked. Verified by: `viewDocument.test.ts` for the generated script, and a browser test where `attachments` is false without the capability and a `files` call is refused locally.
- [ ] 4.2 Handle attachment requests in `viewBridge.ts` under the existing gesture and open-window rules, with the count bound, and relay parts with acknowledgement-driven flow control. Verified by: `viewBridge.test.ts` for no gesture, a minimised window, seventeen files, and an out-of-order part.
- [ ] 4.3 Show the large-attachment confirmation in the window frame in `AppWindowHost.tsx` when the total is over 8 MiB, with file count and size, at desktop and phone width. Verified by: `e2e/app-windows-browser.spec.ts` for confirm, decline (window unchanged, view told), and a total under the threshold showing nothing.
- [ ] 4.4 Show upload progress and a cancel control in the window frame. Verified by: a browser E2E that cancels part way and finds no file and nothing typed.
- [ ] 4.5 Add attachment names and sizes to the Window Messages prompt in `McpApprovalStrip`. Verified by: component tests for one and several attachments.
- [ ] 4.6 Apply the proxy change if 1.1 found one is needed, and record the hosted-surface change. Verified by: the hostile-view test in `e2e/app-windows.spec.ts` still passes, and the open item is recorded on ADR-0042's evidence file.

## 5. End to end

- [ ] 5.1 Desktop: a view with a file input sends text and a 3 MiB image; the terminal receives the text and a path, and the file at that path matches. Verified by: `e2e/app-windows.spec.ts`.
- [ ] 5.2 Browser: the same at 390 px width, plus a 20 MiB file through the confirmation. Verified by: `e2e/app-windows-browser.spec.ts`.
- [ ] 5.3 A hostile view cannot upload without a gesture, cannot choose a path, cannot answer the confirmation, and cannot learn a path. Verified by: cases added to the hostile-view test in `e2e/app-windows.spec.ts`.
- [ ] 5.4 An observer's mirror cannot start an upload, and takeover during an upload ends it cleanly. Verified by: `e2e/app-windows-browser.spec.ts`.
- [ ] 5.5 A closed terminal leaves its delivered attachments on disk. Verified by: a server test that ends the session and stats the file.

## 6. Documentation and delivery

- [ ] 6.1 Document `html_file`, `data`, attachments, the 8 MiB confirmation, and that files are not removed, in `docs/product-overview.md`. Verified by: the section exists and states each.
- [ ] 6.2 Add the scratch directory, its growth, and how to clear it to `docs/operations/standalone-server.md`. Verified by: the runbook names the directory and the command.
- [ ] 6.3 Run `openspec validate --all`, `npm run smoke`, `npm run test:mcp-stdio`, and the app-window E2E suites through `npm run test:e2e`. Verified by: all pass.
- [ ] 6.4 Open a pull request on `origin` (Gitea) and read back every CI status. Verified by: every status is `success` or `skipped`.
