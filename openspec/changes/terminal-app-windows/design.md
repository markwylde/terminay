## Context

Terminay's MCP server is a stdio adapter (`apps/terminay-server/src/mcp/stdio.ts`)
that proxies to a local control socket, where every request is attributed to a
terminal session by a capability token (ADR-0031). It returns text only and is not
an MCP client of anything. The workspace UI is one bundle shared by the Desktop and
browser hosts (ADR-0018), loaded in a sandboxed, origin-bound partition (ADR-0005)
under a fixed content security policy that has no `frame-src` where it is served
over HTTP, and under no policy at all on Desktop, which loads it from `file://`.
The only framed content today is the MDX preview, in an opaque-origin `srcdoc`
frame.

A prototype (`scripts/spikes/mcp-apps/`, written up in
`openspec/adr/evidence/mcp-apps-terminal-windows-spike.md`) proved the end-to-end
path against Claude Code 2.1.289 and was used to choose the window UX. Its findings
constrain this design:

- In MCP Apps the host is the MCP client. Inside a terminal that is the agent CLI,
  so Terminay sees none of the traffic unless it is the client itself.
- A view cannot be anchored inline in a TUI: Claude Code prints `Called <server>`
  and none of the tool result, so there is no text to anchor to.
- Re-parenting an iframe reloads it. A view keeps its state only if its element
  stays where it is and is restyled and repositioned.
- Hiding inactive panes instead of removing them keeps background terminals and
  their views untouched by a switch.

Decisions the owner made in `questionnaires/scope.yaml` and afterwards: one change
with agent-authored windows landing before the gateway; upstream servers are a list
in Terminay settings; agent-authored HTML has open network access and can send
messages; new permission options default to allow, because the agent CLI's own
permission model is the user's gate; a view follows the device that takes control.

## Goals / Non-Goals

**Goals:**

- An agent in any terminal can show its own HTML in a window with one tool call.
- A tool of a user-connected MCP server that declares an MCP App UI shows that UI in
  the calling terminal, in Desktop, browser, and phone clients.
- The window UX matches the prototype's "edge tab" variant.
- No agent CLI is hooked, patched, or configured beyond Terminay's existing entry.
- The view is isolated from the workspace as strongly as a third-party page.

**Non-Goals:**

- Inline placement in the terminal scrollback, docking, split panels, or sub-tabs.
- OAuth or interactive sign-in for remote upstream servers; static headers only.
- Upstream prompts, sampling, elicitation, or general resource browsing.
- Windows that survive a server restart, or that are captured in recordings.
- Transferring unreported in-page state between devices on takeover.
- Per-project or per-terminal permission policies.
- Windows for non-terminal panels.

## Decisions

### 1. The Terminay MCP server becomes a gateway

Terminay Server connects to user-listed MCP servers with the SDK's `Client`,
advertising `capabilities.extensions["io.modelcontextprotocol/ui"]`, and re-exposes
their model-visible tools through the existing control endpoint as
`<entry>__<tool>`. The stdio adapter stops registering a fixed tool set with
`McpServer` and instead serves `tools/list` and `tools/call` from the control
endpoint, sending `notifications/tools/list_changed` when the set changes.

*Why:* it is the only route that needs nothing from the agent CLI. The token already
in the terminal's environment attributes every proxied call to its terminal.

*Alternatives:* intercepting the agent's own MCP traffic (needs PATH shims or
config rewriting, which is hooking); importing agent config files (per-agent
parsers, and the agent still loads its own copy so tools appear twice); waiting for
agent CLIs to implement MCP Apps (they have no surface to render on).

*Boundary:* upstream connections cross the server's process and network boundary.
They are made only by the server, never by a client. An upstream process is spawned
with a scrubbed environment that omits `TERMINAY_CONTROL_SOCKET` and
`TERMINAY_CONTROL_TOKEN`, so a connected server cannot call back into Terminay.

### 2. Upstream connections are per project for local servers

A stdio entry is spawned lazily per project with the project root as cwd, and
stopped on entry change, project close, or server shutdown. An HTTP entry is one
connection per server. Reconnection happens on demand, never on a timer (ADR-0028).

*Why:* most local MCP servers are project-relative. Lazy start keeps idle cost at
zero spawns (ADR-0021).

*Alternative:* one process per entry shared by all projects. Simpler, but gives
every project the same cwd and lets one project's state leak into another's view,
which crosses the project boundary.

### 3. Windows are server-owned records; views are client-side

The server holds a window store per terminal session: id, title, source
(`agent` or `{entry, tool, resourceUri}`), HTML, tool input and result, open or
minimised, pending model context. Clients receive window lists and state changes as
protocol events and fetch content on demand. The view (iframe) exists only on the
client holding the presentation lease.

*Why:* it makes the terminal session the owner (the security boundary), lets a
window open while no client is attached, and gives takeover a record to rebuild
from. Tab x-offsets stay client-local because they are layout preference.

*Alternative:* client-owned windows. Fails takeover and multi-client, and makes the
renderer the authority for something MCP created.

*Bounds:* 8 windows per session, 512 KiB agent HTML, 4 MiB UI resource, 16 KiB
message and model-context text, 1 MiB proxied result. The control endpoint's request
frame bound rises from 64 KiB to 3.25 MiB for `show_window`, which carries a document
(512 KiB of HTML can be 3 MiB once JSON has escaped it),
and for `call_connected_tool`, which carries a tool's arguments; other operations
keep 64 KiB. Between server and clients, a window's document, its tool input and
result, and a view's own requests and responses travel as binary bodies, because a
protocol envelope is capped at 64 KiB.

### 4. Views follow the presentation lease

Only the lease holder runs views; observers render tabs and badges from the same
events. On takeover the former holder tears down (after `ui/resource-teardown`) and
the new holder instantiates from the server record. Activating a tab on an observer
routes to the existing takeover affordance.

*Why:* a view sends input to the terminal and resizes it via the rail, both of
which already belong to the holder (terminal-workspace "Interactive presentation
lease" and "Canonical PTY grid owned by the holder"). Running one copy avoids
duplicated app-to-server calls and conflicting messages.

*Trade-off:* in-page state is lost on takeover. MCP Apps re-read state through
their tools; agent-authored views restart.

### 5. Double-iframe isolation with a self-sandboxing proxy document

The view is a `srcdoc` frame with `sandbox="allow-scripts allow-forms"` (opaque
origin) nested in a Terminay-authored proxy document, `app-view.html`, shipped in
the workspace bundle and framed by URL with the same sandbox attribute. Hosts that
serve the bundle over HTTP send the proxy with
`Content-Security-Policy: sandbox allow-scripts allow-forms; …; frame-ancestors 'self'`,
so it is an opaque-origin document however it is opened. The workspace builds each
view's own policy as a `<meta>` in the view document; the proxy only frames and
relays `postMessage`. The workspace CSP is unchanged.

- **Desktop:** the bundle loads from `file://`, where no header applies. The
  sandbox attribute and the `file:` scheme give an opaque origin, and the existing
  navigation policy already admits a file under the bundle root. Nothing new is
  added to `electron/`.
- **Browser, direct:** `localUiServer` serves the proxy asset with its own header
  set instead of `UI_SECURITY_HEADERS`.
- **Hosted sessions:** the workspace is mounted in the hosted `/v1/` document and
  bundle assets are served by that surface's service worker, which redirects frame
  navigations under `/remote-app/`. That surface is a separate repository; until it
  serves the proxy with its header, the workspace's readiness probe fails there and
  the capability reports unavailable.

*Why:* task 1.1 measured, under the real workspace policy, that a frame the
workspace creates directly (`srcdoc`) cannot run an inline script, while a framed
URL with its own `sandbox` policy can, is an opaque origin, cannot reach the
parent's DOM or storage, cannot navigate the top frame or open a popup, and obeys
a per-view `connect-src`. No workspace policy change, custom scheme, second
listener, or second hostname is needed.

*Boundary:* this sits inside ADR-0005's origin-bound partition without widening
it. Sub-frames already cannot call host IPC (`bindingForEvent` requires the main
frame) and the preload exposes nothing outside the main frame.

*Alternatives:* a custom scheme on Desktop plus a second listener for browsers
(the original plan: more privileged surface, forbidden by default in
connections-and-client-hosts, and impossible for hosted sessions); loosening the
workspace CSP (weakens the whole application); reusing the MDX preview's direct
`srcdoc` host (measured not to run script under the HTTP policy).

### 6. One overlay layer per terminal pane; the window is its own tab

Each terminal pane gets an absolutely positioned layer above xterm. A window is one
element that is restyled between open, sheet, fullscreen, and tab forms and moved by
`left/top/width/height`; it is never re-parented. The rail is a flex row under the
terminal, present only while a tab exists, so xterm's fit shrinks the grid. Inactive
panes are hidden, not unmounted, which Dockview already does for inactive tabs in a
group; the layer is mounted alongside `McpApprovalStrip` in `TerminalPanel.tsx`.

*Why:* carried directly from the prototype.

### 7. Agent-authored views get a bootstrap

For `source: agent` the proxy prepends a small script that performs `ui/initialize`,
reports size with a `ResizeObserver`, applies theme variables, and defines
`window.terminay.{sendMessage, updateContext, openLink, close}`. MCP App views get
nothing injected and speak SEP-1865 themselves.

*Why:* a model should be able to write `<h1>Hello</h1>` and have it work, and call
one function to reply, without knowing a JSON-RPC dialect.

### 8. Messages and context go through the server

`ui/message` becomes a protocol request from the holding client; the server checks
the lease, evaluates Window Messages, and writes to the PTY with the same
bracketed-paste-then-submit path as `run_command`. `ui/update-model-context` is
stored on the window and appended to the next tool result from that terminal.

*Why:* writing to a PTY is server authority, and the policy must be enforced where
the client cannot skip it. There is no generic way to add silent context to an
agent CLI, so the next tool result is the only carrier.

### 9. Three permission entries, default allow

App Windows and Connected Server Tools are ordinary groups in the operation table
(ADR-0031). Window Messages is a policy with the same three values evaluated on the
message path, since a message is not an agent-initiated MCP operation. All default
to Always Allow at the owner's direction.

## Risks / Trade-offs

- **Hosted sessions cannot frame the proxy until the hosted surface serves it** →
  the capability reports unavailable there; the rest ships. The required change
  to that repository is one static document and one header, recorded as an open
  item on ADR-0038.
- **The isolation measurement is Chromium only** → the end-to-end task repeats it
  in WebKit and Firefox.
- **Message injection: a hostile view can instruct the agent** → defaults are the
  owner's choice; the policy can be set to Ask or Never, a message only follows a
  user gesture inside a view the agent chose to open, and the text is visible in the
  terminal as it is typed.
- **Open network for agent HTML can exfiltrate what the agent puts in the page** →
  accepted by the owner; the view still cannot reach the workspace, Terminay
  storage, or the local control socket, and App Windows can be set to Ask or Never.
- **Rail appearing resizes the PTY, so a TUI repaints on minimise and restore** →
  accepted; the resize is published once per transition under the settle rule.
- **Duplicate tools when the user also adds a server to the agent** → Settings
  explains that a connected server should be added to Terminay instead.
- **A slow upstream delays tool listing** → connection and listing are time-bounded
  and a failing entry contributes no tools.
- **Dynamic tool lists change the stdio adapter's stable surface** → Terminay's own
  tools keep their names and order; conformance tests pin them.
- **Takeover loses in-page state** → documented; MCP Apps recover through tools.

## Migration Plan

Additive. A new protocol capability gates everything, so older clients and servers
interoperate unchanged. The stdio adapter's move to dynamic listing is covered by
the existing stdio and provider-conformance suites before any gateway code lands.
Rollback is removing the capability; no stored data changes shape, and the new
settings and vault entries are ignored by an older server.

## Open Questions

- When the hosted session surface will serve the proxy document (outside this
  repository; recorded as an open item on ADR-0038).
- Whether Codex forwards the terminal's environment to stdio MCP servers by default
  (the prototype's Codex path is untested); covered by the provider conformance task.
