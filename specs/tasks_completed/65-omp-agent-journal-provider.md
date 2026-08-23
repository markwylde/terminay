# omp journal provider for the Agents sidebar

## Goal

Observe a user-started interactive `omp` process in a Terminay terminal by
using OMP's terminal-scoped breadcrumb to bind its exact JSONL session to the
exact PTY, then reduce durable records into the existing canonical agent model.
Do not wrap `omp`, install MCP, spawn RPC/ACP, or change oh-my-pi.

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
- Claiming `waiting` / `blocked` for omp permission prompts (no journal
  record).
- Windows journal binding (same darwin/linux `lsof`/procfs limit as Codex).

## Read these implementation anchors first

- `packages/server-core/src/activity/agentTypes.ts` — `AGENT_PROVIDERS`.
- `packages/server-core/src/activity/agentService.ts` —
  `providerFromForegroundProcess`.
- `packages/server-core/src/activity/agentJournal.ts` — PTY-TTY breadcrumb
  resolution, first-record inspect, tailer roots, and `.jsonl` path guard.
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
- Terminal breadcrumb: `terminal-sessions/<tty-derived-id>` stores the exact
  cwd and session-file path, with an optional `fresh` marker before lazy JSONL
  materialization. OMP v18 may atomically replace and close JSONL writers, so
  open-FD sampling is only supplementary evidence.
- Live tool start: `type: "custom"`, `customType: "tool_execution_start"`.
- Exit: `customType: "session_exit"`.
- Children: `<parent-stem>/<agentId>.jsonl`.
- Process title is `omp`; a macOS shebang run may still appear as `bun`.

## Work slices

### 1. Provider identity and chrome

- [x] Add `"omp"` to `AGENT_PROVIDERS` and every mirrored client/UI union.
- [x] Display name is `omp`. Replace hardcoded Codex/Claude ternary labels
      with a provider map.
- [x] Keep MCP install clients unchanged.

### 2. Foreground and journal bind

- [x] Match foreground `omp` (and `oh-my-pi` if that argv appears).
- [x] Reuse the existing leave-shell discovery window so a `bun` wrapper can
      still begin OMP discovery.
- [x] Resolve the sessions root from `~/.omp/agent/sessions` plus
      `PI_CODING_AGENT_DIR` / `OMP_PROFILE` / `PI_PROFILE` / XDG. Add an
      `ompHome` test override beside `claudeHome` / `codexHome`.
- [x] Skip the 256-byte title slot before inspect. Require
      `type === "session"` and a stable `id`. A physical `type: "title"`
      line must not be treated as Codex `session_meta`.
- [x] Derive OMP's terminal ID from the exact PTY TTY and resolve the matching
      bounded terminal breadcrumb under the effective OMP root.
- [x] Validate breadcrumb cwd/path/fresh fields; admit only a materialized
      root JSONL below an allowed sessions root. Never use newest-mtime or
      encoded-cwd alone.
- [x] Admit only encoded-cwd root `*.jsonl` files as roots. Nested
      `<parent-stem>/*.jsonl` files are children.
- [x] Recheck the breadcrumb while OMP remains foreground, rebind on session
      switch, and tail atomic JSONL replacements as well as shrink/reset.

### 3. Driver `(omp, 0.1)`

- [x] `inspectSession` reads the logical session header, not the title slot.
- [x] Map session header → `session.started`.
- [x] Map first user-facing `message.role === "user"` → `turn.started` and
      the stable bounded root label.
- [x] Map `customType: "tool_execution_start"` → `tool.started`.
- [x] Map assistant tool results / matching tool calls → `tool.finished`.
- [x] Map completed assistant tail / terminal `stopReason` → `agent.done`.
- [x] Map `session_exit` → `session.stopped` (interrupted when pending tools
      remain).
- [x] Map child JSONL → `subagent.started` / `subagent.stopped`.
- [x] Ignore unknown types. Project no tool args, assistant text, or tool
      output.

### 4. Fixtures and tests

- [x] Add `packages/server-core/test/fixtures/omp/v0.1/basic.jsonl` with
      title slot, session header, user message, tool start, tool result,
      assistant completion, and session_exit.
- [x] Add a child-journal fixture and a title-slot-only reject fixture.
- [x] Driver tests for the mapping above and unknown-record ignore.
- [x] Journal tests: same-cwd two-TTY breadcrumb isolation, title-slot skip,
      fresh/missing and malformed breadcrumb rejection, session switch, atomic
      replacement, and child files are not roots.
- [x] Existing Codex and Claude Code tests stay green.

## Acceptance checks

- [x] Ordinary `omp` in a Terminay terminal needs no extra flags, hooks, or
      MCP.
- [x] After the first assistant persist, the sidebar shows an `omp` root
      bound to that exact terminal.
- [x] User message → working; unmatched `tool_execution_start` → working;
      completed assistant with no pending tools → done/idle;
      `session_exit` with pending tools → interrupted, not still-live.
- [x] Two `omp` terminals in the same cwd do not share a row.
- [x] A `bun`-named process is shown only when its exact PTY TTY has a valid
      OMP breadcrumb target.
- [x] Fresh/pre-file `omp` does not steal another session and remains on
      terminal-activity fallback until its breadcrumb target materializes.
- [x] Disabling agent status does not touch `~/.omp`.
- [x] No oh-my-pi source changes.

## Definition of done

The feature spec describes omp as a supported journal provider, the Terminay
provider/bind/driver/UI slices are implemented, focused tests pass, Codex and
Claude Code behavior is unchanged, and this task is moved to
`tasks_completed/` with its checklist complete.
