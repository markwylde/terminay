## Why

Desktop applications opened by a bot close when its execution ends, losing unsaved work before the next message. The observed Gridcraft execution launched the app as a foreground tool command; both tool lifetime and Terminay session cleanup can terminate agent-owned processes.

## What Changes

- Add a desktop-owned launcher for installed graphical applications, independent of agent and tool process groups.
- Keep launched applications open across completed, stopped, suspended, and timed-out executions; stopping the bot container ends them.
- Give bots explicit launcher instructions and require fresh visual verification rather than treating launch acceptance as success.
- Preserve session command cleanup, existing browser navigation, and explicit user control over closing applications; do not automatically restart closed apps.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-container-engine`: Desktop-owned graphical application launch, diagnostics, and lifetime.
- `terminay-bots`: Bot launch guidance and explicit distinction between desktop applications and session-owned commands.

## Impact

Bot image helpers and Dockerfile, container init, bot instructions in `packages/server-core/src/botService/memories.ts`, and bot launcher/session tests. No host application launcher, renderer privilege, new npm dependency, or persistence of unsaved work across container stops is introduced. Existing session supervision remains in place.
