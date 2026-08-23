# omp journal provider for the Agents sidebar

## Goal

Observe a user-started interactive `omp` process in a Terminay terminal the
same way Codex is observed: bind the open JSONL writer under the omp sessions
root to the exact PTY, then reduce durable records into the existing canonical
agent model. Do not wrap `omp`, install MCP, spawn RPC/ACP, or change oh-my-pi.

## Governing specifications

- [Agent status and Agents sidebar](../features/agent-status-and-sidebar.md)
- [MCP server](../features/mcp-server.md) (independence only; omp is not an MCP
  install client)

## Current gap

The provider union, foreground matcher, journal roots, drivers, fixtures, and
UI labels are closed over `codex` and `claude-code`. Running `omp` in a
Terminay terminal therefore cannot appear in the Agents sidebar.

## Out of scope

- Any change in the oh-my-pi repository.
- Wrapping `omp`, installing a plugin, or registering Terminay as an omp MCP
  server.
- Spawning `omp --rpc` or `omp acp`.
- Using `~/.omp/agent/terminal-sessions/` breadcrumbs as identity.
- Claiming `waiting` / `blocked` for omp permission prompts (no journal
  record).
- Windows journal binding (same darwin/linux `lsof`/procfs limit as Codex).

## Read these implementation anchors first

- `packages/server-core/src/activity/agentTypes.ts` — `AGENT_PROVIDERS`.
- `packages/server-core/src/activity/agentService.ts` —
  `providerFromForegroundProcess`.
- `packages/server-core/src/activity/agentJournal.ts` — process-tree bind,
  `lsof`/procfs open-handle discovery, first-record inspect, tailer roots,
  `.jsonl` path guard.
- `packages/server-core/src/activity/agentDrivers.ts` — `(codex, 0.1)` and
  `(claude-code, 0.1)` plus `createAgentDriverRegistry`.
- `packages/client-core/src/agentStatus.ts` and `src/types/agentStatus.ts` —
  client provider union.
- `src/shared/SharedAgentRouteBody.tsx` and `src/components/AgentsSidebar.tsx`
  — hardcoded Codex / Claude Code labels.
- `packages/server-core/test/agent-drivers.test.mjs` and
  `packages/server-core/test/agent-journal.test.mjs`.
- `packages/server-core/test/fixtures/codex/v0.1/basic.jsonl` — fixture shape
  to copy for omp.

omp journal facts to implement against (do not import oh-my-pi):

- Sessions root: `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl`
  (`PI_CODING_AGENT_DIR`, `OMP_PROFILE` then `PI_PROFILE`, Linux XDG after
  migrate).
- Physical first line: 256-byte `type: "title"` slot. Skip it. Logical first
  record: `type: "session"` with `id`.
- Writer keeps the FD open after lazy materialize (first assistant persist or
  `ensureOnDisk()`). Until then, fallback to terminal activity.
- Live tool start: `type: "custom"`, `customType: "tool_execution_start"`.
- Exit: `customType: "session_exit"`.
- Children: `<parent-stem>/<agentId>.jsonl`.
- Process title is `omp`; a macOS shebang run may still appear as `bun`.

## Work slices

### 1. Provider identity and chrome

- [ ] Add `"omp"` to `AGENT_PROVIDERS` and every mirrored client/UI union.
- [ ] Display name is `omp`. Replace hardcoded Codex/Claude ternary labels
      with a provider map.
- [ ] Keep MCP install clients unchanged.

### 2. Foreground and journal bind

- [ ] Match foreground `omp` (and `oh-my-pi` if that argv appears).
- [ ] Reuse the existing leave-shell discovery window so a `bun` wrapper can
      still bind, but only after a descendant holds a writable JSONL under
      the omp sessions root (same rule as Codex/`node`).
- [ ] Resolve the sessions root from `~/.omp/agent/sessions` plus
      `PI_CODING_AGENT_DIR` / `OMP_PROFILE` / `PI_PROFILE` / XDG. Add an
      `ompHome` test override beside `claudeHome` / `codexHome`.
- [ ] Skip the 256-byte title slot before inspect. Require
      `type === "session"` and a stable `id`. A physical `type: "title"`
      line must not be treated as Codex `session_meta`.
- [ ] Bind by open writer PID in the exact PTY tree. Never newest-mtime,
      never breadcrumb, never encoded-cwd alone.
- [ ] Admit only encoded-cwd root `*.jsonl` files as roots. Nested
      `<parent-stem>/*.jsonl` files are children.
- [ ] Tail the same JSONL through the existing 250ms poller, including
      shrink/replace reset.

### 3. Driver `(omp, 0.1)`

- [ ] `inspectSession` reads the logical session header, not the title slot.
- [ ] Map session header → `session.started`.
- [ ] Map first user-facing `message.role === "user"` → `turn.started` and
      the stable bounded root label.
- [ ] Map `customType: "tool_execution_start"` → `tool.started`.
- [ ] Map assistant tool results / matching tool calls → `tool.finished`.
- [ ] Map completed assistant tail / terminal `stopReason` → `agent.done`.
- [ ] Map `session_exit` → `session.stopped` (interrupted when pending tools
      remain).
- [ ] Map child JSONL → `subagent.started` / `subagent.stopped`.
- [ ] Ignore unknown types. Project no tool args, assistant text, or tool
      output.

### 4. Fixtures and tests

- [ ] Add `packages/server-core/test/fixtures/omp/v0.1/basic.jsonl` with
      title slot, session header, user message, tool start, tool result,
      assistant completion, and session_exit.
- [ ] Add a child-journal fixture and a title-slot-only reject fixture.
- [ ] Driver tests for the mapping above and unknown-record ignore.
- [ ] Journal tests: process-bound bind, same-cwd isolation, title-slot
      skip, child files are not roots, missing file stays unbound.
- [ ] Existing Codex and Claude Code tests stay green.

## Acceptance checks

- [ ] Ordinary `omp` in a Terminay terminal needs no extra flags, hooks, or
      MCP.
- [ ] After the first assistant persist, the sidebar shows an `omp` root
      bound to that exact terminal.
- [ ] User message → working; unmatched `tool_execution_start` → working;
      completed assistant with no pending tools → done/idle;
      `session_exit` with pending tools → interrupted, not still-live.
- [ ] Two `omp` terminals in the same cwd do not share a row.
- [ ] A `bun`-named process is shown only when its tree holds the omp
      JSONL FD.
- [ ] Idle pre-file `omp` does not steal another session by mtime.
- [ ] Disabling agent status does not touch `~/.omp`.
- [ ] No oh-my-pi source changes.

## Definition of done

The feature spec describes omp as a supported journal provider, the Terminay
provider/bind/driver/UI slices are implemented, focused tests pass, Codex and
Claude Code behavior is unchanged, and this task is moved to
`tasks_completed/` with its checklist complete.
