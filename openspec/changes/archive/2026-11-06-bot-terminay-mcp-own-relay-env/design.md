## Context

`openBotRuntimeBridge` (`packages/server-core/src/botService/runtimeBridge.ts`) returns two things:

- the MCP `servers` for the agent, including `terminay_bot` and, when access is on, `terminay`;
- an `environment` that is merged into the agent process.

Each server entry carries its own `TERMINAY_RUNTIME_SOCKET` and `TERMINAY_RUNTIME_TOKEN`.

`nativeArguments` (`native.ts`) builds the Codex and Claude Code command lines. To keep secrets out of argv it removes every `TERMINAY_RUNTIME_*` key from each server's env:

- **Codex** gets `mcp_servers.<name>.env_vars=["TERMINAY_RUNTIME_SOCKET","TERMINAY_RUNTIME_TOKEN"]` for every server.
- **Claude Code** MCP children inherit the agent's environment.

Either way every server sees the agent process's pair, and `environment` holds only the runtime relay's pair. So the `terminay` adapter connects to the runtime relay, presents the runtime secret, and serves `BOT_RUNTIME_TOOLS`.

`terminay-bot-mcp` reads only `TERMINAY_RUNTIME_SOCKET` and `TERMINAY_RUNTIME_TOKEN`. It rejects any argument other than its check flags ("Invalid adapter arguments").

## Goals / Non-Goals

**Goals:**

- The `terminay` server reaches only its own relay, for both native drivers.
- Secrets never appear in argv or in MCP configuration.
- An image without the fix fails closed and never cross-connects.
- There is test coverage through `nativeArguments` and the real adapter.

**Non-Goals:**

- Changing the relay protocol, the capability or the tool surface.
- Supporting older bot images beyond failing closed.

## Decisions

### 1. Per-server variable names, forwarded by declaration

When the `terminay` relay is up, the bridge adds `TERMINAY_MCP_SOCKET` and `TERMINAY_MCP_TOKEN` to the execution `environment`. The `terminay` server entry declares those two names in its env, and passes `--terminay-mcp` in `args`. The runtime entries keep the `TERMINAY_RUNTIME_*` pair.

`nativeArguments` treats both prefixes as forwarded secrets:

- it strips them from each server's literal env;
- for Codex, it writes each server's `env_vars` from the forwarded names that server declared, rather than a fixed list.

Claude Code has no per-server forwarding list. Its MCP launches inherit the whole agent environment and go through `terminay-tool-shell`. That shell admits only two exact adapter commands: the bare runtime adapter, and the same adapter with `--terminay-mcp`. Before it `exec`s either one, it unsets the other pair. The `--terminay-mcp` form needs no work lease, because it reaches only its own relay.

The tool commands the agent runs, through `terminay-tool-shell`, `terminay-shell-env` and `terminay-source`, have both tokens removed. The selection inside the adapter remains the routing guarantee for any launch that bypasses the shell.

This crosses the **container boundary** (ADR-0093) only as before: the same exec env carries the values, and nothing new is mounted or published.

*Alternative:* put the secret in the server's literal env or in argv. Rejected, because it would expose the secret in `ps` and in the logged MCP config.

*Alternative:* run a separate agent process environment for each server. Rejected, because neither CLI supports it.

### 2. The adapter selects its pair with a flag

`terminay-bot-mcp --terminay-mcp` reads `TERMINAY_MCP_SOCKET` and `TERMINAY_MCP_TOKEN`. Without the flag it reads the runtime pair. Path and length checks are unchanged.

The adapter parses its arguments before it opens a socket. If the selected pair is missing or invalid, it exits without connecting, and it never falls back to the other pair.

An adapter from before this change checks the runtime pair and connects to the runtime socket *before* it rejects the unknown flag. It then exits without sending a frame. The runtime relay sees a connection open and close, with no MCP message and nothing dispatched, and the `terminay` server fails to start. The bot image is built from a hash of the whole `docker/terminay-bot` context, so the adapter change makes the image out of date. The dashboard offers a rebuild, and the next environment start rebuilds before running.

*Alternative:* an environment variable that selects the pair. Rejected, because the old adapter would ignore it and serve the runtime tools as `terminay`.

### 3. Tests through the real launch path

- **Joined regression.** It runs the real `openBotRuntimeBridge` with Terminay MCP access, feeds its `servers` and `environment` through `nativeArguments` for each driver, and launches each declared server with the real adapter:
  - for Codex, with only the variables its `env_vars` names;
  - for Claude Code, with the whole agent environment.
  
  `tools/list` must return workspace tools from `terminay` and runtime tools from `terminay_bot`.
- **`nativeArguments` unit tests.** No secret appears in argv or in the MCP JSON. Codex `env_vars` lists only each server's own names.
- **Adapter negatives.** Each pair missing or malformed, with the other pair valid, makes the adapter exit without connecting.
- **Access off.** No `terminay` server or pair is given to the agent.
- **Pre-change adapter.** It is kept as a test fixture, so a shallow CI checkout still has it. The test asserts that the runtime relay dispatches nothing.
- **Image fingerprint.** It changes when an adapter file changes.

## Risks / Trade-offs

- [A bot keeps running an old image] → Its `terminay` server fails to start, and the image is shown as out of date, prompting a rebuild.
- [Another driver added later forgets the per-server list] → The forwarding logic lives in one helper in `native.ts`, and the tests cover both drivers.
