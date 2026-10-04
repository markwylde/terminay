## 1. View isolation

- [x] 1.1 Prove how an untrusted view can run under the real workspace CSP in each host. Verified by: results in `openspec/adr/evidence/mcp-apps-terminal-windows-spike.md` naming the mechanism per host and stating which host reports unavailable.
- [x] 1.2 Ship the sandbox proxy document `public/app-view.html` in the workspace bundle: nested opaque-origin `srcdoc` frame, two-way relay that drops `ui/notifications/sandbox-*` from the view, no other behaviour. Verified by: the built bundle manifest lists the asset; a browser test that the proxy relays both ways and ignores a forged `sandbox-resource-ready` from the view.
- [x] 1.3 Serve the proxy asset from `localUiServer` with its own header set (`Content-Security-Policy` carrying `sandbox`, the view ceiling policy, and `frame-ancestors 'self'`; no `X-Frame-Options: DENY`), leaving every other asset's headers unchanged. Verified by: a `node --test` request test asserting the proxy's headers and that the entry document's headers are byte-identical to before.
- [x] 1.4 Build the view document in the workspace: CSP `<meta>` from the window's source (open `https` for agent, declared domains for MCP App, none when undeclared) and the permission `allow` list. Verified by: unit tests for the CSP builder covering agent, MCP App with domains, and MCP App with none; a browser test that an undeclared `fetch` is blocked and a declared one is not.
- [x] 1.5 Probe the proxy once per workspace and report the app-windows capability unavailable when it does not answer. Verified by: a unit test with a proxy that never answers; `e2e/app-windows.spec.ts` on Desktop and `e2e/app-windows-browser.spec.ts` in a browser under the workspace policy, where the probe succeeds, and on a host without the proxy, where windows report unavailable.
- [x] 1.6 Confirm Desktop needs no privileged change: the proxy loads from the bundle root under the existing navigation policy with no `terminayHost`. Verified by: an Electron E2E in `e2e/server-ui-sandbox.spec.ts` on the `file://` path showing the proxy and view run, have opaque origins, and cannot call host IPC.

## 2. Server window store and protocol

- [x] 2.1 Add the server-owned window store per terminal session in `packages/server-core` with the bounds from the spec (8 windows, 512 KiB, 4 MiB, 16 KiB). Verified by: `node --test` unit tests for create, replace, close, ninth-window refusal, session-end cleanup, and cross-session lookup failing as not found.
- [x] 2.2 Define protocol operations and events in `packages/protocol` for window list, state change, content fetch, open/minimise, close, view-to-server request, and window message, behind a new capability. Verified by: `packages/protocol-conformance` cases for each operation including an older client that does not negotiate the capability.
- [x] 2.3 Add client-core bindings in `packages/client-core`. Verified by: unit tests against a fake transport for subscribe, fetch, and state updates.
- [x] 2.4 Restrict view requests and window messages to the presentation-lease holder on the server. Verified by: a server test where an observer's request is refused and nothing is written.
- [x] 2.5 Implement window-message delivery to the PTY using the `run_command` paste-and-submit path, with the 16 KiB bound. Verified by: server tests for bracketed-paste on and off, empty, and oversized text.
- [x] 2.6 Implement model-context storage and one-shot append to the next tool result from the owning terminal. Verified by: server tests for single delivery, replacement by a later update, and no delivery to another terminal.

## 3. MCP tools and permissions

- [x] 3.1 Add `show_window`, `close_window`, and `list_windows` to the operation table, dispatcher, and stdio adapter, raising the request frame bound to 768 KiB for `show_window` only. Verified by: `npm run test:mcp-stdio` cases for hello world, update in place, oversized document, foreign handle, and listing; a control-endpoint test that other operations still reject a frame over 64 KiB.
- [x] 3.2 Add the App Windows and Connected Server Tools groups and the Window Messages policy to `packages/server-core/src/mcpApprovals`, with defaults Always Allow. Verified by: unit tests for fresh defaults, each policy value, the split evaluation of a UI tool (tool runs, window denied), and `get_mcp_capabilities` reporting the new tools' effective permission.
- [x] 3.3 Extend `McpApprovalStrip` prompts for `show_window` (title) and window messages (window title and full text). Verified by: component tests for both prompt texts and the three buttons.
- [x] 3.4 Add the three policies to Settings > AI > Terminay MCP. Verified by: `e2e/app-windows.spec.ts` changes the App Windows policy in the Settings window and observes Ask Permission, Decline, Allow One Time, and Never Allow in the main window.

## 4. Window UI

- [x] 4.1 Add the per-pane window layer to `TerminalPanel` beside `McpApprovalStrip`, mounted for inactive panes without unmounting views. Verified by: a component test that a view's iframe element identity is unchanged across terminal switch, project switch, minimise, and restore.
- [x] 4.2 Implement open-window placement: bottom-left, 440 px max, content height capped at 60%, fill-the-pane, and the sheet under 560 px with touch-sized controls. Verified by: E2E geometry assertions at 1250×700 and 390×700 panes.
- [x] 4.3 Implement the edge tab and rail: tab on the bottom edge, rail only while a tab exists, horizontal-only drag with client-local position, open window above the rail. Verified by: E2E asserting terminal rows decrease when a window is minimised and return when restored, and that a vertical drag does not move the tab off the edge.
- [x] 4.4 Enforce one open window per terminal. Verified by: E2E opening a second window and restoring a minimised one.
- [x] 4.5 Publish the rail resize under the canonical-grid rules: holder publishes once, observer scales and submits nothing. Verified by: `e2e/app-windows.spec.ts` reads `stty size` in the shell before, during, and after the rail and sees one stable grid each time; an observer runs no view and publishes nothing (`e2e/app-windows-browser.spec.ts`).
- [x] 4.6 Add window badges with count and background-arrival pulse to terminal and project tab components; leave the status bar unchanged. Verified by: E2E for badge appear, pulse on background arrival, pulse cleared on show, and disappear on last close.
- [x] 4.7 Implement the host bridge: initialise with theme, display mode, container dimensions, and platform; size reports; display-mode requests; open-link through the host's external-link path; teardown; rejection of unknown methods and foreign frames. Verified by: unit tests per message and an E2E with a view that sends an unknown method.
- [x] 4.8 Implement the agent-authored bootstrap (`window.terminay.sendMessage/updateContext/openLink/close`, automatic handshake, sizing, theme). Verified by: E2E where static HTML sizes to content and a button's `sendMessage` types into the terminal and minimises the window.
- [x] 4.9 Follow the presentation lease: only the holder runs views; observers show tabs and route activation to takeover; on takeover the former holder tears down and the new holder rebuilds from the server record. Verified by: `packages/server-core/test/app-windows-composition.test.mjs` for which client may speak for a view and the hand-over on takeover; `e2e/app-windows-browser.spec.ts` for the observer notice, takeover, and the view rebuilt from the server record with matching content.

## 5. Gateway

- [x] 5.1 Convert the stdio adapter from fixed `registerTool` calls to `tools/list` and `tools/call` served from the control endpoint, with `tools/list_changed`. Verified by: the existing `test:mcp-stdio` and `test:mcp-install` suites pass unchanged, plus a test that Terminay's own tool names and order are stable.
- [x] 5.2 Add the Connected MCP servers setting: server-owned list, name validation, vault storage for env and header values, never returned to clients. Verified by: server tests for add, edit, disable, remove, duplicate name, and that a saved secret is absent from the settings read.
- [x] 5.3 Implement the upstream connection manager: SDK `Client` advertising the UI extension; stdio entries spawned lazily per project in the project root with a scrubbed environment; HTTP entries per server; stop on change, disable, project close, and shutdown; on-demand reconnect with no timer. Verified by: tests with a fixture upstream asserting the advertised capability, cwd, absence of `TERMINAY_CONTROL_*` in the child environment, one spawn per project, and zero spawns while idle.
- [x] 5.4 List upstream model-visible tools as `<entry>__<tool>`, hide app-only tools, forward calls, and bound results to 1 MiB. Verified by: stdio tests against the fixture upstream for listing, a forwarded call, an app-only tool absent, and an oversized result.
- [x] 5.5 Open a window for a tool that declares a UI: read and cache the resource, validate type and the 4 MiB bound, deliver tool input then result or cancellation, and prefix the agent's result. Verified by: an E2E where a fixture tool's view renders its arguments and result; tests for wrong content type, oversized resource, and tool failure.
- [x] 5.6 Route a view's `tools/call` and `resources/read` to its own upstream connection only, for app-visible tools only, under Connected Server Tools. Verified by: tests that a call to another entry's tool, a Terminay tool, and a model-only tool are each refused.
- [x] 5.7 Add the Connected MCP servers section to Settings > AI with per-entry status, tool count, and bounded failure reason. Verified by: an E2E adding the fixture upstream, seeing it connected with its tool count, and seeing a reason for a bad command.

## 6. End-to-end and real-client verification

- [x] 6.1 Add a fixture upstream MCP Apps server and Playwright suites for Desktop, browser, and phone-width covering agent-authored windows, MCP App windows, switching, takeover, and permissions. Verified by: `npm run test:e2e -- e2e/app-windows.spec.ts e2e/app-windows-browser.spec.ts e2e/mcp-approvals.spec.ts` passes locally in Docker.
- [x] 6.2 Add `show_window` and one gateway tool to the provider conformance coverage for Claude Code and Codex, including whether each forwards the terminal environment to the stdio server. Verified by: the conformance run records pass or a documented limitation per provider in `docs/agent-provider-capabilities.md`.
- [x] 6.3 Exercise one real third-party MCP Apps server from the ext-apps examples through the gateway in the dev build. Verified by: a note in the evidence file naming the server, its version, and what rendered.
- [x] 6.4 Check on a real touch device that the sheet, tab drag, and controls work, and that a TUI repaints acceptably when the rail appears and disappears. Verified by: Chromium touch emulation at 390×740 in `e2e/app-windows-browser.spec.ts` for the sheet, tab drag, and controls, and the shell-reported grid for the rail; a physical device was not available and is recorded as not checked in the evidence file.
- [x] 6.5 Add a security E2E to `e2e/server-ui-sandbox.spec.ts` with a hostile view that tries to read the parent, navigate the top frame, open a popup, start a download, and post forged messages. Verified by: every attempt fails and no host command runs.

## 7. Documentation and close-out

- [x] 7.1 Document app windows and connected servers in `docs/product-overview.md` and the MCP tool descriptions. Verified by: the docs build and the tool descriptions appear in `tools/list`.
- [x] 7.2 Remove `scripts/spikes/mcp-apps/` once the evidence file is complete, keeping the evidence file. Verified by: `git grep mcp-apps scripts/` returns nothing and the ADR links resolve.
- [ ] 7.3 Run `openspec validate --all`, `npm run smoke`, the MCP suites, and the full E2E. Verified by: all pass.
- [ ] 7.4 Open the pull request on `origin` (Gitea) and read back every CI status. Verified by: every status is `success` or `skipped`.
