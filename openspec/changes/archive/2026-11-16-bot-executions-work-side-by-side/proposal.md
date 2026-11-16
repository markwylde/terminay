## Why

An always-on bot often has more than one execution running at once: a user message arrives while a trigger is running, or two triggers overlap. Today only one of those executions can use the shell or the desktop. Every other execution gets `terminay-bot-mcp: runtime capability refused` on every command, so the bot tells its owner "my shell is refusing commands" with no fault to find. Unrelated work that happens to overlap simply fails.

The owner asked for something different when concurrent executions were introduced. A new execution should learn how many other executions are running and then decide for itself: stop one, steer it, replace it, or leave it alone and do its own work. The coordination tools and briefing for that already exist. The exclusive shell/desktop lease (`work_acquire`/`work_release`) was added on top, and it removes the "leave it alone" choice.

## What Changes

- **BREAKING (bot runtime tools)**: Remove the `work_acquire` and `work_release` runtime tools, the per-bot shared-work owner, the `work.acquired`/`work.released` events, and the `ownsWork` field in execution summaries and replacement receipts.
- Every live execution can run shell commands and use desktop/browser tools without first acquiring anything, alongside the bot's other live executions. The container's shell gate and the desktop MCP still refuse an execution whose capability has been revoked or has ended.
- An execution admitted into the reserved user-message coordination slot gets the same tools as any other execution. When an ordinary work slot frees, the server moves it into that slot, so the reserved slot is free again for the next correction.
- The execution briefing states how many other executions are running (running or waiting on the user, not queued) and lists them, and separately says how many are queued. It asks the agent to decide whether its task relates to one: stop it, steer it with an inbox message, replace it, or leave it running. It warns that the desktop and browser are shared, so the agent must not drive them while another execution is using them.
- A shell command that the gate refuses no longer leaves the execution's later commands without their runtime token. Today, one refused command breaks every later command in the run with `runtime request failed or capability revoked`, even after the lock is taken. This is seen in seven recorded runs.
- Desktop and browser MCP tools work for a live execution. Until now their per-call check never received the execution's runtime pair: Claude launched them through the shell prefix, which strips it, and Codex launched them with an empty environment. So every desktop tool call was refused for every agent. The server now gives both desktop servers the runtime pair, the shell prefix passes it through for their two exact launch commands, and the desktop MCP removes it from everything it starts.
- Replacement keeps revoking the older execution and awaiting its cleanup; it no longer transfers ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: concurrent admission no longer requires exclusive shell/desktop ownership; the correction scenario and the cleanup-failure rules no longer mention releasing ownership.
- `bot-message-log`: the runtime tool set drops shared-work coordination; briefings state the number of other active executions; replacement no longer transfers ownership; shared resources are used side by side by every live execution.
- `bot-engine-recovery`: the Claude MCP bootstrap scenario no longer refers to acquiring shared work; shell commands are gated on a live execution capability instead.

## Impact

- `packages/server-core/src/botService/runtime.ts`: tool list, owner map, `assertWork`, briefing, summaries, replacement.
- `packages/server-core/src/botService/runtimeBridge.ts`: `runtime/check-work` checks only that the execution is live; the desktop and browser MCP servers receive the runtime pair.
- `packages/server-core/src/botService/service.ts`: finishing and stopping an execution no longer release an owner.
- `docker/terminay-bot/bin/terminay-tool-shell`, `terminay-shell-env`, `terminay-desktop-mcp.mjs`: gate wording and messages; the gate stays a liveness check. The bot image is rebuilt.
- Tests under `packages/server-core/test/` that exercise `work_acquire`, `ownsWork`, or the busy refusal.
- No protocol, client UI, or persisted-state change. A server upgrade restarts the server, which marks running executions interrupted as it already does; the next execution gets the new tool list and the rebuilt image.
