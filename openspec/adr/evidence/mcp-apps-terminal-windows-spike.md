# MCP Apps in a terminal: gateway and window placement spike

Date: 2026-10-04
Code: `scripts/spikes/mcp-apps/` (run `node scripts/spikes/mcp-apps/server.mjs`,
open `http://127.0.0.1:4517`)
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
