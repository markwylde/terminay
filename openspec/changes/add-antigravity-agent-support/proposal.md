## Why

People running Google's Antigravity CLI (`agy`) in a Terminay terminal get no status for it in the Agents pane. **Install Terminay MCP** offers no way to register Terminay with it either, so `agy` cannot call Terminay tools. The same screen still offers Gemini CLI, which Google has replaced with Antigravity and Terminay no longer supports.

`@markwylde/all-your-agents` 1.6.1, which the built-in agents extension already pins, now ships an `antigravity-cli` provider. agy 1.5.x reads user-wide MCP servers from `~/.gemini/config/mcp_config.json`.

## What Changes

- The built-in agents extension's session source gains a fifth harness, **Antigravity** (`antigravity`), backed by the library's `antigravity-cli` provider. Like the other harnesses, it has its own switch, is on by default, and publishes live sessions, status, titles, models and subagents.
- The extension adds an **Antigravity CLI** MCP install target. It writes the `terminay` entry in `mcpServers` in `~/.gemini/config/mcp_config.json`, the file `agy mcp add` manages, and follows the existing installation-safety and changed-entry rules.
- **BREAKING:** the **Gemini CLI** MCP install target is removed. Install Terminay MCP no longer lists Gemini CLI. Terminay neither reads nor changes `~/.gemini/settings.json`. A `terminay` entry a user installed there earlier stays where it is.
- The Docker-isolated MCP compatibility test installs `agy` in place of Gemini CLI and requires `agy mcp list` to report the `terminay` registration.
- Antigravity sessions waiting only on background work (`waitingFor` `task` or `subagent`) show as running, not as waiting for the user, the same as `shell` and `monitor` waits already do.
- Agents-pane end-to-end coverage for Antigravity uses a new Antigravity fixture driver contributed upstream to `@markwylde/all-your-agents`. The pin moves to the release that ships it.
- Copy that lists supported agents (extension catalog description, the extension manifest description, Settings search keywords, the MCP settings description, the extension README, `docs/product-overview.md`) names Antigravity and drops Gemini CLI.

Antigravity terminal launchers, chat providers and bot agents are out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-agents-extension`: Supported harnesses grows to five with Antigravity. Background `task` and `subagent` waits cross as running. The built-in MCP install targets replace Gemini CLI with Antigravity CLI.
- `mcp-server`: The supported clients, the management-surface target list and the per-client registration contracts replace Gemini CLI with Antigravity CLI and its `~/.gemini/config/mcp_config.json` contract.
- `agent-status-and-sidebar`: The bundled session source reports Antigravity sessions too.
- `extension-platform`: The built-in agents card shows an Antigravity harness switch.

## Impact

- `extensions/builtin-agents`: `src/source.ts` (harness list), `package.json` (harness and MCP target contributions), `src/mcp/` (new `antigravity.ts` writer, `gemini.ts` deleted, provider registry, target ids, types), tests and README.
- `packages/server-core/src/extensions/catalog.ts` (extension description), `src/App.tsx` and `src/terminalSettings.ts` (settings copy and keywords).
- `Dockerfile.mcp-cli-compat` and `scripts/mcp-cli-real-compat.test.mjs`, plus the other script and e2e tests that list targets or harnesses.
- Dependencies: `@markwylde/all-your-agents` moves from 1.6.1 to 1.7.0, which adds the Antigravity fixture driver (markwylde/all-your-agents#27). Its capability matrix is unchanged from 1.6.1. The Antigravity provider needs `node:sqlite`, which both Electron 45 (Node 24.22) and the standalone server's Node 24 provide.
