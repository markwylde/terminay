# MCP Server Specification

This is the canonical spec for the Terminay MCP server: a [Model Context
Protocol](https://modelcontextprotocol.io) server that lets an AI coding agent
running inside a Terminay terminal (Claude Code, Codex, etc.) control the
terminals around it — list them, read their output, type into them, open and
close tabs, and wait on activity events.

## Summary

When you run an agent like Claude Code or Codex inside a Terminay tab, that
agent has no way to see or touch the other tabs sitting next to it. This feature
adds an MCP server, shipped as a `terminay mcp` subcommand of the existing app
binary, that exposes the surrounding terminals as MCP tools.

From the agent you can say things like:

- "open a new terminal"
- "what's happening in Terminal 2?"
- "type `npm test` into the Test second tab"
- "close Terminal 3"
- "wait until the build terminal has been idle for 10 seconds, then continue"

The agent only ever sees the tabs in **its own window** — the same set of tabs
the user sees in that window's tab strip. It has no knowledge of other windows,
and crucially **no knowledge of the "project" concept at all**. If two projects
(Project 1, Project 2) are open and the agent is running in a tab inside
Project 2, the agent sees exactly the tabs of Project 2 (e.g. `Terminal 1`,
`Test second tab`, `Terminal 3`) and nothing else. "Project" is the *implicit
boundary* that defines the visible set, never a thing the MCP API exposes.

## Goals

- Let an in-terminal agent enumerate, read, and control the sibling terminals in
  its own window with zero manual configuration.
- Scope every operation to the agent's own window/project automatically, derived
  from where the agent process is running — not from what the user has clicked.
- Never leak the concept of "project" or other windows into the MCP surface.
- Support a "subscribe and sleep" model: the agent can block on an event such as
  "no activity for N seconds", "the next command finished", or "the terminal
  asked for attention", and resume only when it resolves.
- Make installation trivial: a Cmd+L command opens a modal that installs or
  uninstalls the server for Claude Code and Codex, showing live install state.
- Be safe by construction: a local-only Unix domain socket, a per-terminal
  capability token, and a user-controllable on/off setting.

## Non-Goals

- No control across windows or across projects. A token minted for a Project 2
  terminal can never see or touch Project 1.
- No file system, settings, recording, or remote-access control via MCP. This is
  about terminals only.
- No network exposure. This is distinct from the existing remote-access feature
  (see `specs/REMOTE.md`) and does not reuse its transport, pairing, or auth.
- Advanced window management (popout windows, moving tabs between groups, pane
  resizing) is out of scope for the first version. Basics only: open, close,
  focus, rename, split.

## What We Are Trying To Do

Three cooperating pieces, plus install plumbing and a setting.

```
┌─ Claude Code / Codex ─────────────┐
│   (running inside a Terminay tab)  │
│         │ stdio (MCP protocol)     │
│         ▼                          │
│   `terminay mcp`  ← reads TERMINAY_CONTROL_SOCKET + TERMINAY_CONTROL_TOKEN
└─────────│──────────────────────────┘
          │ Unix domain socket (~/…/Terminay/control.sock, 0600)
          ▼
┌─ Terminay main process ────────────┐   broker: validates token → scope,
│   ControlServer (new)              │   serves PTY-level ops (wait/write) directly
│         │ ipc 'control:request'    │
│         ▼                          │
│   Owning window's renderer         │   brain: resolves tab names, runs Dockview
│   (App.tsx control handler, new)   │   ops, reads xterm buffers, scoped to one project
└────────────────────────────────────┘
```

### 1. Scope and auth via env injection

When Terminay spawns a shell it injects two environment variables into the PTY:

- `TERMINAY_CONTROL_SOCKET` — absolute path to the Unix domain socket.
- `TERMINAY_CONTROL_TOKEN` — a unique, per-terminal capability token.

Any process running in that terminal — the agent, and its `terminay mcp` child —
inherits both. The token is **both the credential and the scope anchor**: the
main process keeps an in-memory map `token → { sessionId, webContentsId,
projectId }`, so presenting the token tells the broker which terminal the agent
lives in, and therefore which window/project's tabs are visible. No discovery, no
pairing, no config files for the connection itself.

Injection happens in `getTerminalSpawnEnv()` in `electron/main.ts`
(currently lines 1019–1033, which today only sets `COLORTERM` and macOS locale).
Because the token is per-terminal, the env must be built per session rather than
once; the token is generated in `createPtySession()` (`electron/main.ts`,
~lines 1199–1223) and threaded into the spawn options.

`projectId` is a renderer-only concept today — the main process's
`TerminalSession` interface (`electron/main.ts`, lines 156–163) has no project
field, and `ipcMain.handle('terminal:create', …)` (line 1988) only receives
`{ cwd? }`. We extend the `terminal:create` payload so the renderer passes the
owning `projectId`, letting the main process record it in the token map. The
renderer remains the source of truth for which sessions belong to which project.

### 2. ControlServer in the main process

A new `electron/control/server.ts` listens on the Unix domain socket
(`0600`, under the app's `userData` dir). For each request it validates the
token, resolves scope, then either:

- **Serves it directly** when it is PTY-level. Writing input maps to the existing
  `terminal:write` path; "wait for inactivity" maps directly onto
  `waitForInactivity()` in `electron/ptyHost.ts` (lines 201–219), which already
  resets a timer on every chunk of PTY data and reports back via `inactive`
  messages and the `inactivityWaiters` map on `TerminalSession`.
- **Forwards to the owning renderer** via a new `control:request` IPC channel for
  anything needing project/tab/Dockview/buffer knowledge (listing, naming,
  opening, closing, focusing, splitting, reading the scrollback buffer).

The shared message types live in `electron/control/protocol.ts`.

### 3. The renderer control handler

A new handler in `src/App.tsx` is the only place that knows projects, tab
titles, the Dockview layout, and the xterm buffers. Given a scope (the agent's
`sessionId` → its `projectId`), it:

- Enumerates **only** that project's terminals via `workspaceRefs` /
  `activeProjectId` machinery (`src/App.tsx`, lines 5833–5884) and the Dockview
  API for that workspace.
- Resolves a human tab name ("Test second tab") to a `sessionId`: exact →
  case-insensitive → unique fuzzy match, returning a disambiguation error
  listing candidates when a name is ambiguous.
- Executes Dockview operations (open / close / focus / rename / split).
- Reads recent output via an extended `TerminalContextReader`
  (`src/components/TerminalPanel.tsx` / `TerminalTab.tsx`), today capped at
  ~200 lines / 20 KB for AI tab metadata; we allow a larger/explicit grab for
  `read_terminal`.

### 4. The `terminay mcp` subcommand

The Terminay binary detects `mcp` in `process.argv` at the very top of
`electron/main.ts`, **before** `app.whenReady()` and any window creation, and
branches into a headless stdio MCP mode (no GUI, no dock icon). In that mode it:

1. Reads `TERMINAY_CONTROL_SOCKET` + `TERMINAY_CONTROL_TOKEN` from its env.
2. If absent (the agent was launched outside Terminay, e.g. a globally-registered
   server in a normal terminal), it still starts cleanly but reports **no
   terminals** and a clear "not running inside a Terminay terminal" message, so
   it degrades gracefully everywhere.
3. If present, connects to the control socket and serves the MCP tools below.

The MCP server is built with the official `@modelcontextprotocol/sdk`
(not currently a dependency — must be added). Its code lives under
`electron/mcp/`, sharing the control protocol client with the broker.

### 5. Install modal + Cmd+L command

Cmd+L opens the command bar (the macro launcher; `open-command-bar` →
`CmdOrCtrl+L` in `src/keyboardShortcuts.ts`, handled in `src/App.tsx` around
lines 4232–4238, items built in the `commandItems` memo, lines 3946–4121). We
add a command entry:

- **"Install Terminay MCP"** — opens the install modal.

The modal (`src/components/McpInstallModal.tsx`) lists supported agents with live
install state and per-agent install/uninstall:

```
Install Terminay MCP

  [✓] Claude Code      installed     [ Uninstall ]
  [ ] Codex            not found     [ Install   ]

  Registers `terminay mcp` so agents can control this window's tabs.
```

Only Claude Code and Codex are supported initially; the structure leaves room for
more agents later.

Backing IPC (new, main process, under `electron/mcpInstall/`):

- `mcp-install:get-status` → `{ claudeCode: boolean, codex: boolean }`
- `mcp-install:install({ agent })`
- `mcp-install:uninstall({ agent })`

Install mechanics edit each agent's config file directly (no dependency on the
agent's own CLI being on `PATH`):

- **Claude Code**: add/remove a `terminay` entry under `mcpServers` in
  `~/.claude.json`. Installed = key present.
- **Codex**: add/remove an `[mcp_servers.terminay]` block in
  `~/.codex/config.toml`. Installed = block present.

The registered command is the resolved Terminay executable path
(`process.execPath` in production, with a documented dev fallback) plus the
`mcp` argument — which is why the headless argv branch above exists.

### 6. Setting (Settings → AI)

A new boolean setting, default **on**, lets users disable the control server.

- Add `terminayMcp: { enabled: boolean }` to `TerminalSettings`
  (`src/types/settings.ts`, lines 109–152) with default `true` in
  `defaultTerminalSettings` (`src/terminalSettings.ts`, ~line 147).
- Add a "Terminay MCP" section under the existing `'ai'` category
  (`src/terminalSettings.ts`, categories at lines 70–75) with one `boolean`
  field keyed `terminayMcp.enabled` (e.g. "Allow AI agents to control terminals
  in this window").
- Add `terminayMcp` to the `allowedRoots` set in
  `src/components/SettingsWindow.tsx`.
- The main process honors the setting: when `false`, the ControlServer refuses
  connections and the env vars are not injected into newly spawned shells.

## MCP Tool Surface

Terminals are addressed by their tab name (with a stable id available to avoid
name races). All tools operate strictly within the agent's own window/project.

**Read / inspect**

- `list_terminals()` → `[{ id, name, busy, cwd, lastActivityAgo, exitCode? }]`
- `read_terminal({ terminal, lines? })` → recent output buffer
- `get_terminal_status({ terminal })` → working/idle, last exit code, attention flag

**Act**

- `open_terminal({ name?, cwd?, split? })` → new tab in the agent's window
- `write_terminal({ terminal, text, submit? })` → raw terminal input, optionally
  press Enter
- `run_command({ terminal, command })` → write + Enter convenience; multiline
  commands are inserted with bracketed paste and submitted once
- `close_terminal({ terminal })`
- `focus_terminal({ terminal })`
- `rename_terminal({ terminal, name })`
- `split_terminal({ terminal, direction })`

**Subscribe (blocking waits — "sleep until it resolves")**

- `wait_for_idle({ terminal, seconds, timeout? })` → returns after N seconds of no
  activity; built on `waitForInactivity()` in `electron/ptyHost.ts`
- `wait_for_command({ terminal, timeout? })` → returns when the next command
  finishes, with its exit code (OSC 133 command lifecycle, see
  `specs/TERMINAL_ACTIVITY_SIGNALS.md`)
- `wait_for_attention({ terminal, timeout? })` → returns on bell/notification

These are ordinary request/response MCP tool calls that simply do not return
until the condition is met, which is the most compatible "subscribe and sleep"
shape for Claude Code and Codex.

## Security

- Local-only Unix domain socket under `userData`, mode `0600`. Never a TCP port.
- Per-terminal capability token; it authorizes only its own project scope. A
  token from one project cannot reach another project or another window.
- User-controllable: the Settings → AI toggle disables the server and stops env
  injection entirely.
- Distinct from `specs/REMOTE.md`: no shared transport, pairing, PIN, or device
  keys.

## Affected Files

**New**

- `electron/control/server.ts` — Unix-socket ControlServer (token validation,
  routing, direct PTY ops).
- `electron/control/protocol.ts` — shared control message types.
- `electron/mcp/` — headless stdio MCP server, control-socket client, tool
  definitions (uses `@modelcontextprotocol/sdk`).
- `electron/mcpInstall/` — agent config detection + install/uninstall for Claude
  Code and Codex.
- `src/components/McpInstallModal.tsx` — install/uninstall UI.

**Modified**

- `electron/main.ts` — argv `mcp` headless branch; per-terminal token generation;
  env injection in `getTerminalSpawnEnv()`; `token → {sessionId, webContentsId,
  projectId}` map; start/stop ControlServer per setting; `mcp-install:*` and modal
  IPC; extended `terminal:create` payload.
- `electron/ptyHost.ts` — reuse `waitForInactivity`; hooks for command-complete /
  attention waits if needed.
- `electron/preload.ts` — expose new IPC for the modal.
- `src/App.tsx` — `terminal:create` payload carries `projectId`; new `control:request`
  renderer handler (name resolution + Dockview ops + buffer reads, project-scoped);
  Cmd+L command entry; render the modal.
- `src/components/TerminalPanel.tsx` / `TerminalTab.tsx` — extend
  `TerminalContextReader` for fuller buffer reads.
- `src/types/settings.ts`, `src/terminalSettings.ts`,
  `src/components/SettingsWindow.tsx` — the new setting.
- `package.json` — add `@modelcontextprotocol/sdk`; ensure the `mcp` entry point
  is bundled by Vite/electron-builder.

## Tasks

> Implementation notes (deviations from the original sketch, both deliberate):
> 1. **Scope source of truth is the renderer, resolved per request.** The
>    `token → { sessionId, webContentsId }` map in main does not carry
>    `projectId`; instead the renderer resolves the calling session → its owning
>    project workspace at request time. This is more robust to terminals being
>    dragged between projects. So `terminal:create` was NOT extended.
> 2. **Headless entry instead of an argv branch.** Rather than branching on
>    `process.argv` inside `main.ts` (which would still evaluate GUI/service
>    side effects), the MCP server runs from a dedicated `electron/mcpEntry.ts`
>    launched via `ELECTRON_RUN_AS_NODE=1` — a clean Node process, no window, no
>    `main.ts`. The install command sets that env var. `dist-electron/**` is
>    asar-unpacked so the entry + shared chunks load on disk.

### Scope & transport plumbing
- [x] Generate a per-terminal capability token in `createPtySession()`
- [x] Maintain a `token → { sessionId, webContentsId }` map in the main process
- [x] ~~Extend `terminal:create` to carry `projectId`~~ → superseded: renderer resolves session → owning project per request (note 1)
- [x] Inject `TERMINAY_CONTROL_SOCKET` + `TERMINAY_CONTROL_TOKEN` per session in `getTerminalSpawnEnv()`
- [x] Define `electron/control/protocol.ts` shared message types

### ControlServer (main process)
- [x] Create `electron/control/server.ts` listening on a `0600` Unix domain socket under `userData`
- [x] Validate tokens and resolve scope on each connection/request
- [x] Serve ops by forwarding to the owning renderer (which calls the PTY-level APIs: write, wait-for-inactivity)
- [x] Forward project/tab/buffer ops to the owning renderer via a new `control:request` IPC channel
- [x] Start/stop the ControlServer based on the `terminayMcp.enabled` setting

### Renderer control handler
- [x] Add a `control:request` handler in `src/App.tsx` scoped to the agent's owning project
- [x] Enumerate only the owning project's terminals (via `workspaceRefs` + Dockview API)
- [x] Implement tab-name resolution (exact → case-insensitive → unique fuzzy) with ambiguity errors
- [x] Implement Dockview ops: open, close, focus, rename, split
- [x] Read recent buffer via `TerminalContextReader` (with optional line cap)

### `terminay mcp` subcommand
- [x] Add `@modelcontextprotocol/sdk` dependency and bundle the `mcpEntry` build input
- [x] ~~argv branch in main.ts~~ → headless `electron/mcpEntry.ts` run via `ELECTRON_RUN_AS_NODE=1` (note 2)
- [x] Connect to the control socket using env-provided socket path + token
- [x] Degrade gracefully (no terminals + clear message) when env vars are absent
- [x] Implement read/inspect tools: `list_terminals`, `read_terminal`, `get_terminal_status`
- [x] Implement act tools: `open_terminal`, `write_terminal`, `run_command`, `close_terminal`, `focus_terminal`, `rename_terminal`, `split_terminal`
- [x] Implement blocking subscribe tools: `wait_for_idle`, `wait_for_command`, `wait_for_attention`

### Install/uninstall
- [x] Create `electron/mcpInstall/` with detection + install/uninstall for Claude Code (`~/.claude.json` `mcpServers`)
- [x] Add install/uninstall for Codex (`~/.codex/config.toml` `[mcp_servers.terminay]`)
- [x] Resolve the Terminay executable path (`process.execPath`) + `mcpEntry.js` arg + `ELECTRON_RUN_AS_NODE` for the registered command
- [x] Add IPC: `mcp-install:get-status`, `mcp-install:install`, `mcp-install:uninstall`
- [x] Expose the install IPC through `electron/preload.ts`
- [x] Build `src/components/McpInstallModal.tsx` with live install state and per-agent install/uninstall
- [x] Add the "Install Terminay MCP" entry to the Cmd+L `commandItems` in `src/App.tsx`

### Setting (Settings → AI)
- [x] Add `terminayMcp: { enabled: boolean }` to `TerminalSettings` (`src/types/settings.ts`)
- [x] Default `terminayMcp.enabled` to `true` in `defaultTerminalSettings`
- [x] Add a "Terminay MCP" section + boolean field under the `'ai'` category
- [x] Add `terminayMcp` to the `allowedRoots` set in `SettingsWindow.tsx`
- [x] Wire the setting to ControlServer start/stop and env injection

### Verification
- [x] Unit tests: protocol framing (`control-protocol`), socket round-trip + token scoping (`control-server`), Codex TOML upsert/remove (`mcp-install-codex`)
- [x] MCP stdio handshake exposes all 13 tools and degrades gracefully without Terminay env (smoke-tested)
- [x] Token scoping enforced by construction: a token resolves to exactly one session → one owning project workspace; cross-project access is impossible by routing
- [ ] Manual end-to-end test in a running app with two projects, plus real Claude Code / Codex (list, read, write, open/close, waits) — _requires interactive run_
- [x] `npm run smoke` (lint + build) passes
