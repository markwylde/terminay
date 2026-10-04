# MCP Apps in a terminal — placement spike

Throwaway prototype for showing [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)
(SEP-1865) next to a TUI agent, without hooking the agent CLI.

```sh
node scripts/spikes/mcp-apps/server.mjs   # then open http://127.0.0.1:4517
```

The page is a mock Terminay window: two projects, two terminals each, every terminal
with a real PTY and real xterm.js. The toolbar buttons act on the terminal in view:

- **open app / open 2nd app** — run `show-app.mjs`, a plain CLI calling a tool with a view.
- **app in 6s** — the same after a delay, to watch a view arrive in a background terminal.
- **claude** — types `claude --mcp-config "$MCP_APPS_SPIKE_CONFIG"`; then ask it to
  "use the deploy_configurator tool for billing-api" or "use the system_monitor tool".

To try a real third-party server, add `upstreams.json` here:
`{ "name": { "command": "npx", "args": ["-y", "<server>"] } }`.

## What makes it possible

In MCP Apps the *host is the MCP client*: it advertises `io.modelcontextprotocol/ui`,
reads the `ui://` resource, and proxies the view's `tools/call`. Inside a terminal that
client is the agent CLI, which is text-only, so Terminay never sees the traffic.

The generic route is a **gateway**. Terminay's own MCP server (already installed into
each agent, already attributed to a terminal by token) connects to upstream servers as
a UI-capable client and re-exposes their tools. When the agent calls one that has a
view, Terminay renders it in the calling terminal and returns the text result as usual.

| File | Stands in for |
| - | - |
| `server.mjs` | Terminay server: PTY, control endpoint, upstream MCP clients |
| `gateway.mjs` | the per-terminal stdio MCP adapter |
| `public/host.js` | renderer: xterm.js + the SEP-1865 host bridge + placements |
| `public/sandbox.html` | sandbox proxy on a second origin (double iframe) |
| `demo-upstream.mjs` | a third-party server with two apps, raw protocol, no Terminay knowledge |

View → agent goes through the PTY: `ui/message` is pasted into the prompt and submitted,
which works for any agent. `ui/update-model-context` is held and appended to the next
tool result, because there is no generic way to add silent context to a CLI.

## Placement: a floating window

An earlier round compared dock, inline, sub-tabs, split and float; float was chosen.
A view opens as a window at the bottom-left of the terminal that called the tool, at
its content height capped at 60% of the pane. On a narrow pane it is a bottom sheet.
One window is open per terminal; opening another minimises the rest. Only a minimised
view can be dragged, and the window reopens from wherever its handle was left.

The toolbar switches what a minimised view becomes:

| | Minimised form | Draggable | Takes rows |
| - | - | - | - |
| **1 Pill** | floating title pill, stacked from the bottom-left | anywhere | no |
| **2 Bar** | bar along the bottom of the terminal, only while something is minimised | no | one or two |
| **3 Title bar** | the window rolled up to its own title bar | anywhere | no |
| **4 Edge tab** | tab attached to the bottom edge | along the edge | no |
| **5 Bubble** | round bubble, snaps to the nearer side | anywhere | no |

"Phone size" previews the whole window at 390px wide.

## Findings

- **Verified with Claude Code 2.1.289**: tool call → view rendered → app-only
  `tools/call` polling → `ui/message` typed back into the terminal.
- **Inline cannot be anchored reliably in a TUI.** The plan was to scan the buffer for
  an anchor string returned at the head of the tool result. Claude Code folds an MCP
  call to `Called <server>` and prints none of the result, so there is nothing to find.
- **Never re-parent the iframe.** The window and its minimised form are one element in
  the terminal's overlay layer, restyled and repositioned, so a view keeps its state
  through minimise, terminal switches and project switches.
- **Hide inactive panes, don't remove them.** Background terminals keep their size, so
  their PTY and views are untouched by a switch.

## Open questions for a real change

- Where upstream servers are configured, and whether the agent's own copy of the same
  server must be removed to avoid duplicate tools.
- Sandbox origin on Desktop, where the UI is loaded from `file://`, and the CSP, which
  has no `frame-src` today.
- Consent for `ui/message` (it types into a terminal) and for app-initiated tool calls,
  alongside the existing MCP permission groups.
- Remote and phone clients: which attached client renders the view.
