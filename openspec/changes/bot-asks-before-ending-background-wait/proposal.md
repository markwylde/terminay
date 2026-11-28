## Why

A bot session can finish its work and stay **running** for hours, because it
left a background shell, Monitor or subagent behind. Nothing ends it, a stuck
check-in is never watched, and nobody can see what is holding it
([#680](https://git.i.wylde.net/markwylde/terminay/issues/680)).

Claude Code bots run with no background-work ceiling (ADR-0140), and Terminay
keeps the agent's input open while it counts background work as pending.

## What Changes

- Every execution's instructions say to stop the background tasks it started
  before it finishes.
- When a Claude Code execution has finished its turn and waited on background
  work for 5 minutes, Terminay asks it whether it is done. If it says so,
  Terminay stops its background tasks and it ends as **completed**. Otherwise it
  keeps running and is asked again after each further 5 minutes. This covers
  every origin, check-ins included.
- No time limit is added: only the agent's answer ends a waiting session.
- The execution records what is holding it open, its last activity and the
  checks made. The session details show it, and `sessions_get` returns it.

## Capabilities

### New Capabilities

- `bot-background-wait`: the cleanup instruction, the done check and the
  background-wait diagnostics.

### Modified Capabilities

- `bot-cli-runtime`: an execution whose done answer was accepted does not need
  a successful exit status.
- `terminay-bots`: the approval channel of a Claude Code execution also closes
  once the execution says it is done.

## Impact

- `packages/server-core/src/botService/`: `native.ts`, `agentProcess.ts`,
  `service.ts`, `runtime.ts`, `sessions.ts`.
- `packages/protocol/src/bots.ts`: one optional field on the session record.
- `src/workspace/bots/BotSessionsPanel.tsx` and its styles.
- ADR-0149 supersedes ADR-0140. Evidence:
  `openspec/adr/evidence/claude-code-background-wait.md`.
- Extra model usage: one short turn per 5 minutes of continuous waiting.
