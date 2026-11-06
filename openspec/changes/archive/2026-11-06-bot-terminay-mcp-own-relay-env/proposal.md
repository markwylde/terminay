## Why

A bot with **Terminay MCP access** turned on still says it can't see the user's projects or terminals. Asked to "create 4 terminals in a 2x2 grid", it replies that it only has its own container. The access the user granted never reaches the agent.

The cause is the real agent launcher for Codex and Claude Code. To keep secrets off the command line, it drops each MCP server's `TERMINAY_RUNTIME_SOCKET` and `TERMINAY_RUNTIME_TOKEN` and lets the server inherit them from the agent process. The agent process carries only the runtime relay's pair, so the `terminay` server connects to the runtime relay and gets a second copy of the bot's own tools. The tests used a fake runtime that reads each server's environment directly, so this went unnoticed.

## What Changes

- The `terminay` server's socket and relay secret travel under their own names, `TERMINAY_MCP_SOCKET` and `TERMINAY_MCP_TOKEN`. The agent process carries them next to the runtime pair, and the launcher forwards each server only the names that server declared.
- `terminay-bot-mcp` takes a `--terminay-mcp` flag that makes it read the `TERMINAY_MCP_*` pair. Without the flag it reads the runtime pair as before. It never falls back to the other pair.
- Codex forwards each server only its own names. Claude Code launches its MCP servers through `terminay-tool-shell`, which admits the exact `--terminay-mcp` launch and gives each adapter only its own pair. Tool commands the agent runs never see either token.
- At execution start the server probes the `terminay` adapter. If the probe fails, for example on an old image, Runner output says to rebuild the image, and the agent isn't given a `terminay` server that would fail. Secrets still never appear in the agent's command line or in its MCP configuration.
- An image built before this change refuses the flag. Its `terminay` server then fails to start without sending anything to the runtime relay, rather than serving the runtime tools as `terminay`. The changed adapter makes the bot image out of date, so the dashboard offers a rebuild.
- Tests join the real bridge, the native launch arguments and the real adapter for both drivers. They also cover missing pairs, access off, the pre-change adapter, and the image fingerprint.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: "Bot execution capability delivery" states that the `terminay` server connects to its own relay, under its own variable names, and never to the runtime relay.

## Impact

- `packages/server-core/src/botService/runtimeBridge.ts`: the `terminay` server entry and the execution environment.
- `packages/server-core/src/botService/native.ts`: per-server `env_vars` for Codex, and stripping of both pairs from the Claude Code MCP config.
- `docker/terminay-bot/bin/terminay-bot-mcp`: the `--terminay-mcp` flag. This changes the image fingerprint, so bots need an image rebuild.
- Tests in `packages/server-core/test`.
- No API, protocol or UI change.
