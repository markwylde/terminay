# MCP Apps in a terminal: gateway and window placement spike

Date: 2026-10-04
Code: the harness lived in `scripts/spikes/mcp-apps/` and was removed once the
feature shipped. It is in history at commit `88a175e3`; there, run
`node scripts/spikes/mcp-apps/server.mjs` and open `http://127.0.0.1:4517`.
Supports: ADR-0037, ADR-0038

## Question

Can Terminay show MCP Apps for an agent CLI running in a terminal without hooking
the CLI, and where should the view go?

## Method

A standalone harness with real parts: `node-pty` shells served to xterm.js 6.1
over a WebSocket; a stdio MCP server (`gateway.mjs`) that proxies to the harness
by a per-terminal token in the PTY environment, as Terminay's adapter does; the
harness as MCP client of an upstream server (`demo-upstream.mjs`) advertising
`io.modelcontextprotocol/ui`; a hand-written SEP-1865 host bridge; a sandbox proxy
on a second origin with an opaque-origin inner frame. The upstream's two apps
speak the raw protocol and know nothing of Terminay.

## Results

Observed with Claude Code 2.1.289 launched as
`claude --mcp-config <generated file>` inside the harness terminal:

- Claude called `deploy_configurator`; the harness read `ui://demo/deploy.html`,
  rendered it, and delivered `tool-input` then `tool-result` to the view.
- The view's app-only tool (`get_system_stats`, visibility `["app"]`) was
  polled through the host and was not listed to the model.
- `ui/message` from a button was pasted into the terminal and submitted.
- `ui/update-model-context` was accepted and held for the next tool result.
- Claude Code rendered the call as `Called apps` and printed none of the result
  text, so an anchor string placed at the head of the result never reached the
  terminal buffer.

Placement, driven in a browser at 1254×697 and 388×686 panes:

| Placement | Outcome |
| - | - |
| Dock (PTY loses rows) | Works; TUI reflows. Rejected as heavier than needed. |
| Inline in scrollback | Exact for a plain CLI that reserves rows. No reliable anchor in a TUI. Rejected. |
| Sub-tabs | Works; hides the terminal. Rejected. |
| Split | Works; rejected for the same reason as dock. |
| Float | Chosen. |

Float variants for the minimised form: pill, bar, title bar, edge tab, bubble.
**Edge tab** was chosen, with the terminal ending above a tab rail that exists
only while a window is minimised (46 rows open, 43 rows minimised in the test
pane), a bottom sheet under 560 px, and one open window per terminal.

Switching: with two projects of two terminals each, a view kept its state across
terminal and project switches in every placement when the pane was hidden rather
than removed and the iframe was never re-parented. Moving the iframe in the DOM
reloaded it.

## Not tested

- Codex, or any agent other than Claude Code.
- Any third-party MCP Apps server; only the two demo apps.
- A real touch device; phone layout was checked at phone width with synthetic
  pointer events.
- The view under Terminay's real content security policy. The harness had no
  CSP. Measured afterwards; see the next section.
- A TUI's repaint when the rail appears and disappears.

## View isolation under the real workspace policy (task 1.1)

Date: 2026-10-04. Chromium, driven through DevTools. A stand-in workspace page
was served with the exact `DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`, and
`public/app-view.html` was served from the same listener with
`Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline' https: blob:; … ; frame-ancestors 'self'`.
The parent framed the proxy by URL with `sandbox="allow-scripts allow-forms"`
and sent it a view document carrying its own `<meta>` policy.

| Probe from inside the view | Agent-authored policy | MCP App, no declared domains |
| - | - | - |
| Inline script runs | yes | yes |
| `self.origin` | `null` | `null` |
| Proxy `event.origin` seen by the parent | `null` | `null` |
| Read the workspace document | `SecurityError` | `SecurityError` |
| `localStorage` | `SecurityError` | `SecurityError` |
| `fetch("https://example.com/")` | allowed | blocked by `connect-src 'none'` |
| `top.location = …` | `SecurityError` | `SecurityError` |
| `window.open(…)` | blocked | blocked |

Control: a `srcdoc` frame created directly by the workspace page, as the MDX
preview does, did **not** run its inline script. The console reported a
violation of `script-src 'self'`. A view therefore cannot be a direct `srcdoc`
child of the workspace wherever that policy is in force.

Per host:

- **Direct browser session (`localUiServer`):** works with one per-asset header
  set. No workspace policy change.
- **Desktop:** the workspace loads from `file://` and carries no policy at all
  (`server.html` has no CSP `<meta>` and there is no `onHeadersReceived`). The
  proxy is a file under the bundle root, which the navigation policy already
  admits. To be confirmed end to end by task 1.6.
- **Hosted sessions:** read from the live surface on 2026-10-04, the session
  origin sends `default-src 'self'; … script-src 'self'; …` with no `frame-src`,
  and its service worker answers a navigation under `/remote-app/` with a
  redirect to `/v1/`. The proxy cannot be framed there until that surface, which
  is a separate repository, serves it with the header above. Reports unavailable.

Not measured: WebKit and Firefox.

## Implementation checks (terminal-app-windows)

Date: 2026-10-04.

**Desktop, in the Docker end-to-end harness (`e2e/app-windows.spec.ts`).** The
workspace loads from `file://`. The sandbox proxy, a file under the bundle
root, loaded under the existing navigation policy with no change to
`electron/`. A hostile agent-authored view reported `self.origin` `null`, no
`terminayHost`, no access to the workspace document or storage, a blocked
top-level navigation and a blocked popup; a forged `sandbox-resource-ready`
did not replace its document; the proxy's own origin was `null` and it had no
host bridge either.

**A published third-party server.** `@modelcontextprotocol/server-basic-vanillajs`
2.0.3, started with `npx -y … --stdio` as a connected server from Settings.
Terminay advertised the UI extension, the server offered `get-time` with
`ui://get-time/mcp-app.html` (`text/html;profile=mcp-app`, about 218 KB, no
declared CSP domains), and its view, built with the official SDK, rendered in an
app window and showed the time its tool returned. Run with
`TERMINAY_E2E_REAL_MCP_APP=@modelcontextprotocol/server-basic-vanillajs npm run test:e2e -- e2e/app-windows.spec.ts`.

**Real agent CLIs (`scripts/app-windows-real-agents.mjs`).** Each CLI was given
the stdio adapter and the two environment variables a Terminay terminal has,
and asked to call `show_window` and a connected server's tool.

| Agent | `show_window` | Connected tool with a view | Note |
| - | - | - | - |
| Claude Code 2.1.289 | window created | window created | Forwards the terminal environment to the stdio server. |
| Codex | not run | not run | The account was at its usage limit; the CLI exited before any tool call. |

**Hosted sessions.** The `terminay.com` repository now serves the proxy at
`/v1/app-view.html` on session origins with the sandboxing policy and
`frame-ancestors 'self' <manager origin>`, covered by `specs/appView.test.mjs`
there. It has not been deployed, and a hosted session has not been exercised
end to end.

**A browser host (`e2e/app-windows-browser.spec.ts`).** The real window layer
ran in Chromium in a page served over HTTP with the exact workspace policy, the
proxy served with the exact headers a Terminay Server sends. A view ran, with
`self.origin` `null` and nothing to reach; an MCP App received its input and
result, called its server through the host, and was held to its declared
`connect-src`. A client that does not control the terminal ran no view and
offered the takeover; on taking control it rebuilt the view from the stored
content, without the state the previous view held. A host with no proxy
reported windows unavailable and fetched no content. Under touch emulation at
390×740 the window was a sheet, its controls were touch-sized, and a touch drag
moved the tab along the edge only. The window store in that page is a stand-in:
which client the server lets speak for a view, and the hand-over on takeover,
are proven against the real server in
`packages/server-core/test/app-windows-composition.test.mjs`.

**The rail and the PTY.** In the Desktop run the shell reported 51×161 with a
window open, 49×161 with it minimised (twice, unchanged), and 51×161 again
once restored.

**Policies.** Changing App Windows in the Settings window took effect on the
next request in the main window for Ask Permission, Decline, Allow One Time,
and Never Allow. Writing that test found that no Terminay MCP setting could be
changed from Settings at all, because `terminayMcp` was missing from the
window's writable roots; fixed in this change.

Not done:

- Two live clients attached to one Desktop server in a single end-to-end test;
  this repository has no harness for it. Covered in two halves, above.
- WebKit and Firefox; the end-to-end image has Chromium only.
- A physical touch device.
- A hosted session end to end; that needs the `terminay.com` change deployed.
- Codex; the account was at its usage limit.

## Independent review and what it changed

Date: 2026-10-04. A separate reviewer read the whole change against `main` and
confirmed most of the following by probe. Each was fixed with a test. (This
section first said each test fails without its fix; the next section corrects
that for one row.)

| Finding | Fix | Test |
| - | - | - |
| App-window and mirror operations ignored a client's project or session binding: a client bound to project B could list, read, close, and watch windows of project A. | Listing is filtered and every lookup refuses a window outside the caller's boundary as not found; mirror operations refuse a terminal outside it. | `app-windows.test.mjs`, `app-windows-composition.test.mjs` |
| A view's message reached the PTY with control bytes, so it could end the paste, interrupt, and submit a line of its own. | A message with any control character other than tab and line feed is refused. Without bracketed paste, line breaks are written as spaces, so a message is submitted once. | same two files, with the bytes written to the PTY |
| Nothing kept a view's frame on the document it was given: a view could navigate itself, carrying data out past its policy, and a forged recording could refresh a mirror onto another page. | The proxy adds `frame-src 'none'` to itself after creating the frame, so the frame can load nothing else and the view, which took its policy at creation, can still frame what it may. A frame that loads a second document is removed. The replica makes every `meta[http-equiv]` inert. | `e2e/app-view-mirror.spec.ts` (no request reaches the server), `e2e/app-windows.spec.ts` on Desktop |
| A connected server that failed to start changed the tool-list revision on every listing, so agents listed again and the server was started again, without end. | A change is announced when a server's state changes, not each time it fails the same way. A failed server is left for 30 seconds before a listing tries it again; saving its entry or calling one of its tools by name tries at once. | `connected-servers.test.mjs` |
| Tool input, results, and view responses over 64 KiB broke the window, which stayed blank. | They travel as binary bodies. A view response too large for a command result is held once for the caller to fetch. A window whose content cannot be loaded says so. | `app-windows.test.mjs`, client-core tests, `e2e/app-windows-browser.spec.ts` |
| Model context a view left was consumed by the adapter's own listing of connected tools. | Listing does not take it. Context from many windows is kept in whole notes up to what the adapter accepts. | `app-window-tools.test.mjs` |
| A refused request was retried on any `forbidden`, so declining a permission prompted twice. (As shipped the retry never ran at all, because the error's code was not read through its wrapper.) | The server marks "not the controlling client" refusals; only those are retried, through the wrapper. | `mirror.test.ts` |
| A view was never told it was being removed: the message was posted to a frame already gone. | The view is told, and its frame kept for 150 ms, before a replacement, a move of control, or a close removes it. | `e2e/app-windows-browser.spec.ts` |
| One caller cancelling failed a connection another caller was waiting for; a save during a connect failed an unchanged entry. | A connection attempt belongs to no caller and is stopped only when its project or the gateway closes; an unchanged entry keeps its identity across saves. | `connected-servers.test.mjs` |

Smaller: a snapshot request could be coalesced away for good if the controlling
client missed it (a repeat from the same watcher now goes through); an observer
could be made to buffer about 128 MiB (parts are bounded in characters and a
snapshot to 128 parts, about 16 M characters); disabling MCP left windows open
(it now ends them); a UI resource with no content type was accepted (it is now
refused); two quick saves could apply connected servers out of order; a failed
commit left the list in memory ahead of disk; a mirror that became available
after a view started was not recorded.

Not changed: `app-windows.changed` still tells every subscriber the ids,
terminals, and states of all windows, without titles or content, as the event
journal does for every feature.

## Second independent review

Date: 2026-10-04. A second reviewer, told to distrust the fixes above, read
both pull requests again.

**A correction to the section above.** It said each fix had a test that fails
without it. That was false for the frame-navigation row: the test navigated to
an `http://127.0.0.1` address, which the proxy's own `frame-src https:` header
already refuses, so it passed with the fix removed. The test now targets an
`https` address and watches for the request. It was run with the fix stripped
from the proxy and failed (the browser asked for
`https://terminay-exfil.invalid/view?secret=1`), and passes with it.

| Finding | Fix | Test |
| - | - | - |
| A view could press Enter in the terminal by itself: a white-space message wrote a bare `\r`, with no gesture and no pacing. | White space alone is refused. A message is taken only from an open window, one at a time; a delivered message minimises the window, so it sends once per opening. The sandbox proxy passes on `ui/message` and `ui/open-link` only while the browser reports user activation in the view. | `app-windows-composition.test.mjs`; `e2e/app-windows-browser.spec.ts` (a view that sends on load is refused, a click sends); `e2e/app-windows.spec.ts` on Desktop |
| A server that connected and then exited was started again without limit (76 starts in 6 seconds, no agent involved). | A server whose connection ends is left alone as one that fails to start is. | `apps/terminay-server/test/connected-servers.test.mjs` |
| One-batch-at-a-time pacing of a recording was kept by the recorder, which runs inside the untrusted view. | The workspace drops a batch that arrives before the last was taken. | `mirror/mirror.test.ts` (500 batches, one publish) |
| `ui/open-link` opened a browser with no gesture or pacing. | Gated on user activation by the proxy, and at most one a second. | same E2E; `viewBridge.test.ts` |
| Saved credentials could be re-pointed: saving an entry with a new address or command kept its stored values. | Credentials not supplied again are removed when the destination changes. The form says so. | `packages/server-core/test/connected-servers.test.mjs` |
| One failed `list()` cleared every window and ended every view; missed events were never recovered. | A failed read keeps what was shown; a resync notice reads again. | `windowLoader.test.ts` |
| "The controlling client" was matched by client id, which a client states for itself. | The connection holding the lease is required; a recording is addressed to the connection that asked to watch. | `app-windows-composition.test.mjs` |
| A forged recording with a document node made `rrweb-snapshot` reopen the replica's own document. | Refused before building; the replica reports failure and draws the next snapshot. | `e2e/app-view-mirror.spec.ts` |
| A mirror whose snapshot never came waited for ever. | It asks again after 5 seconds, up to four times, then says it cannot be shown. | `mirror/mirror.test.ts` |
| Three task verifications cited tests that are not in the branch. | The tasks now cite the tests that exist; the hostile-view test also attempts a download and an unattended message. | `tasks.md` |

Smaller, also fixed: a window that returned as another left could stay mounted
and hidden; a view told it was closing could be left running if control came
straight back; model context that did not fit a result was dropped (it now stays
for the next result); a document whose JSON encoding escaped heavily could
exceed the control frame (the bound now covers the worst case); an environment
variable named like a built-in property was lost on save; the MCP App content
type was compared as a string, not as a media type; a mirror request for
another project's terminal answered differently depending on whether it had
windows; nothing kept the two copies of the proxy document in step (both
repositories now pin its digest); an encoded path served the proxy from
`terminay.com` without its policy.

### Not fixed: WebRTC

`connect-src` does not govern WebRTC, so a view allowed no connections can
still reach a peer of its choosing with `RTCPeerConnection`. The directive that
covers this is `webrtc 'block'`. Measured in the end-to-end image's Chromium
153.0.8010.12: a top-level page served with `Content-Security-Policy: webrtc
'block'` sent the same four STUN datagrams to a local listener as a page served
without it. The directive is not enforced. No sandbox flag or permissions
policy covers peer connections, and removing the constructor from a view is not
a defence, because a view can take a fresh one from an `about:blank` frame.

The view and mirror policies carry `webrtc 'block'` for MCP App views, so it
takes effect wherever a browser honours it. The spec says what is and is not
governed. What this leaves exposed is narrow: an MCP App view sees its own
tool's input and result and what the user does in it, and can already send any
of that to the server that supplied it through that server's own tools.

### Not verified

- On Desktop, a view framing an allowed origin. Electron's frame navigation
  policy admits only files under the bundle root, so this is probably refused
  there, which is stricter than the spec's "may".
- The reviewer's Desktop-specific observations, which were made by reading.

## Third independent review

Date: 2026-10-04. A third reviewer, told to distrust both earlier rounds,
confirmed the server-side fixes hold and that their tests fail without them,
and found the following.

| Finding | Fix | Test |
| - | - | - |
| A view can take the keyboard focus by itself. Keys typed for the terminal then go to the view, and one of them counts as the gesture that lets it type into the terminal. The second round's claim that a view could not fake a gesture was wrong. | When the focus moves into a view's frame, the workspace asks the proxy whether the browser has recorded a gesture in the view; if not, and the focus did not arrive by Tab, the focus goes back to the terminal. | `e2e/app-windows-browser.spec.ts`: a view that focuses itself on load does not keep the focus, keys reach the terminal, nothing is sent; a real click keeps the focus and sends |
| Any ordinary link ended the view and left a blank window, because the proxy removes a frame that navigates. | Every view handles its own link clicks: a link to a place in the page scrolls, a link to a web page is handed to the host to open. A view that is removed now says so in its window. | same file: both link kinds, and a view that leaves or rewrites itself |
| A server that exited did not come back: after the back-off nothing listed again, and agents no longer knew its tools. A cold start could exceed the connect timeout. | A server that has gone keeps its last tools on the list, so calling one starts it again. Saving an entry, changed or not, tries at once. The connect timeout is 60 seconds. | `apps/terminay-server/test/connected-servers.test.mjs` |
| An entry corrected while its old version was still connecting joined that attempt and was charged with its failure. | The old attempt is stopped and forgotten when its entry changes. | same file |
| Context for the model could contain control characters, which JSON escapes sixfold, taking a result over its bound and losing the notes. | Context is held to the same characters as a message, and the budget counts encoded size. | `packages/server-core/test/app-windows.test.mjs` |
| The mirror boundary answered differently for another project's terminal depending on whether it had windows. | One answer for every mirror operation. | `app-windows-composition.test.mjs` |
| A view whose snapshots the replica refused kept observers asking without end; a snapshot whose last part was lost was never asked for again; a recording stopped and started mid-batch dropped its first part. | A mirror counts as recovered when it has drawn, not when a snapshot arrives; the wait covers a snapshot's parts; a stop ends what the link was pacing. | `mirror/mirror.test.ts` |
| A tab is a keystroke in a plain shell. | Written as a space where bracketed paste is off. | `app-windows-composition.test.mjs` |
| `/app-view.html/` and `/app-view.html%2F` served the proxy from terminay.com without its policy. | Refused. | `specs/appView.test.mjs` there |
| Two more task verifications cited tests that do not exist. | Corrected. | `tasks.md` |

### A second limit that cannot be closed here: a host name can leave

A view that sets its own location is refused: no page loads, and its frame is
removed. But the reviewer measured, in Chrome 154, that the browser opens a
connection to the destination before it refuses the load. A raw listener
received a TLS ClientHello for each attempt. The name of a host the view
chooses therefore leaves by name lookup and connection setup. The path, the
query, and any content do not.

Stopping the navigation where it starts was tried and does not work: a
sandboxed frame has an opaque origin, and the Navigation API fires no
`navigate` event there, so there is nothing to cancel. (Measured: with a
listener in place, a view that set its location was still refused only by the
proxy and removed.) `location` cannot be replaced by script. No sandbox flag
or policy directive forbids a frame navigating itself; `navigate-to` was
dropped from CSP.

Together with WebRTC above, this means "an MCP App view allowed no
connections" governs what the view loads, fetches and frames, and is not a
guarantee that nothing can be signalled out. The spec now says exactly that.
The exposure is the same narrow one: such a view sees its own tool's data and
what the user does in it, and can already send that to the server that supplied
it.

### Test lesson

A test's own look inside a frame (`locator.evaluate`, or anything built on it)
counts, to the browser, as someone using that frame. A test of "nothing happens
without a gesture" that first reads the frame is racing itself. The gesture and
focus tests learn the outcome without touching the view's frame, and were run
three times over without a failure.

### Not changed

- Publishing a recording is paced by the server's acknowledgement and has no
  rate limit of its own; a view can keep the relay as busy as the connection
  allows. A busy legitimate view does the same.
- For a local server, changing its environment variables does not drop its
  stored credentials. A client allowed to save entries can already start any
  command as the same user.
