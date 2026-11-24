## Why

Opening a bot's Environment tab shows "Reading the environment…" for seconds before anything appears. The Overview waits for one request that also starts a throwaway container to measure the home folder, samples CPU and memory, and reads the container log, one after another. On Docker Desktop each container start alone takes seconds.

Shell and Desktop also treat a stopped machine badly. Opening Shell silently starts the machine, which the user never asked for. Opening Desktop on a stopped machine shows a red "command failed" error, although nothing has failed: the machine is simply not running.

## What Changes

- The Overview renders from the container's own record at once, then fills in CPU, memory, home size, and the log from a second read. Figures not yet read show as being read; figures that could not be read show as unavailable with the failure, and Refresh retries. The reads that make up usage run side by side.
- The state read never waits on an engine security probe: it uses the AppArmor decision only once settled, and the full read settles image currency.
- Full measurements stay limited to Overview open and Refresh. Lifecycle changes, including Start and Stop from the Overview, re-read state only.
- The overview query accepts `usage: false`, which skips those reads, and reports `usageRead` in its result. A server that predates this ignores the flag and returns everything, so older servers keep working.
- **BREAKING:** Opening Shell never starts the machine. The server refuses a shell, as it already refuses a desktop, while the machine is not running, with a plain "The machine is not started." refusal instead of "command failed". Agent sign-in still starts the machine, because the user asked for it.
- While the machine is not running, Shell and Desktop show a calm panel such as "Machine not started." with one action that brings it up (Start machine, Create machine, or Try again), open the live view once it runs, and give way to the panel when it stops. A failure to start is shown with its cause; engine and image recovery are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: the Overview renders before usage is read and measures only on open and Refresh; Shell no longer starts the container; Shell and Desktop show the machine's state and a start action while it is not running.

## Impact

- `packages/server-core/src/botService/environment.ts`, `protocol.ts`, `shell.ts`, `rfb.ts`, `composition.ts`.
- `packages/protocol/src/botEnvironment.ts` (`usageRead`), `packages/client-core/src/botEnvironment.ts` (`usage` option).
- `src/workspace/bots/BotEnvironmentPanel.tsx`, `BotShellView.tsx`, `BotDesktopView.tsx`, new `BotMachineGate.tsx`, `botPanels.css`.
- Tests: `packages/server-core/test/bot-environment.test.mjs`, `bot-shell.test.mjs`, `bot-rfb.test.mjs`, protocol tests, `scripts/bots-ui.test.mjs` and its harness.
