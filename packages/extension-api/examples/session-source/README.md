# Example Agent extension

This package is the reference for authoring a Terminay agent extension. Copy
its shape; do not import Server Core, Electron, or any other private Terminay
module.

## Package shape

1. A `terminay` manifest in `package.json`. It declares the extension id, the
   `agent-observation` permission for its session source, the
   `mcp-registration` permission for its MCP install target, and the ids of
   both. The manifest is data only.
2. A default export from `defineExtension({ activate(context) { ... } })`.
   There is no global Terminay singleton. Every grant arrives on `context` or
   a callback argument.
3. `context.agents.registerSessionSource` and
   `context.mcp.registerInstallTarget` under ids the manifest declared, added
   to `context.subscriptions` so disable, update, shutdown, and host failure
   dispose them.
4. Tests through `@terminay/extension-api/testing`.

## Session sources

A session source reports every live session of its harnesses on the server's
machine, wherever it was started. `start({ enabledHarnesses, publisher,
signal, onEnabledHarnessesChanged })` begins watching and resolves once the
source is running.

- `publisher.reset(sessions)` replaces everything the source reported before.
  Send one after start, and again whenever the enabled harness set changes.
- `publisher.upsert(session)` replaces one session by id.
- `publisher.remove(sessionId)` forgets one when its process exits.
- `publisher.diagnostic({ code, message })` records a typed problem. Keep paths
  and conversation content out of it.

A snapshot is a closed object: id, harness, pid, cwd, and optional title,
model, status, waiting description, current tool, last-turn outcome and end
time, error, and subagents. Transcripts, prompts, tool arguments, and raw
records are never accepted. Every string has a bound in `EXTENSION_LIMITS`.

Terminay, not the extension, decides which project a session belongs to (its
cwd under the project root or one of the repository's worktrees) and which
terminal, if any, it binds to (by process ancestry). Watch files; never poll.
When `signal` aborts, release every watch.

## MCP install targets

A target owns one client's Terminay MCP registration. `status`, `install`,
and `uninstall` each receive the host-supplied `server` command and a
`signal`. Write exactly that command, atomically, into the client's own
configuration file, and report `not-installed`, `installed`, `changed`,
`unavailable`, or `error` with the path you inspected.

## Tests

```js
import { createAgentExtensionHarness } from "@terminay/extension-api/testing";
import extension from "./extension.js";
```

The harness checks manifest/registration agreement, snapshot bounds, declared
and enabled harnesses, reset/upsert/removal validity, cancellation, and
privacy exclusions, and drives install targets with a fixture MCP command.
