# Proposed Agent Extension API: author example

> This document illustrates the target developer experience for
> [Task 63](./63-built-in-agent-extensions.md). The API names are specification,
> not an implementation that is available in the current SDK.

## What an agent extension does

An agent extension is an ordinary Node.js npm package. Terminay starts its
entrypoint in an extension-host child process and supplies an
`ExtensionContext`. The package registers an agent provider with that context.

Terminay calls the provider when a terminal's foreground process changes. The
provider may inspect that exact terminal, discover a native agent session, and
publish provider-neutral lifecycle events. Terminay validates and orders those
events, stores the canonical state, and renders the Agents sidebar.

The extension never imports Server Core or renderer code. It may use public
Node.js APIs and declared npm dependencies normally.

```text
Terminal starts agent
        |
        v
Terminay issues one terminal-scoped context
        |
        v
Extension recognizes and binds the provider session
        |
        v
Extension publishes canonical lifecycle events
        |
        v
Terminay validates -> stores -> sends snapshot -> renders sidebar
```

## Minimal package

```text
terminay-agent-example/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   └── exampleAgent.ts
├── test/
│   └── exampleAgent.test.ts
└── tsconfig.json
```

### `package.json`

```json
{
  "name": "terminay-agent-example",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "peerDependencies": {
    "@terminay/extension-api": "^1.1.0"
  },
  "devDependencies": {
    "@terminay/extension-api": "^1.1.0",
    "typescript": "^6.0.0"
  },
  "terminay": {
    "manifestVersion": 1,
    "id": "com.example.agent",
    "displayName": "Example Agent",
    "description": "Shows Example Agent sessions in Terminay.",
    "api": "^1.1.0",
    "engines": {
      "terminay": ">=1.0.0",
      "node": ">=24"
    },
    "entrypoint": "dist/index.js",
    "platforms": ["darwin", "linux"],
    "permissions": ["agent-observation"],
    "contributes": {
      "agentProviders": [
        {
          "id": "com.example.agent/cli",
          "displayName": "Example Agent",
          "icon": "terminal",
          "requiredEnvironmentCapabilities": [
            "process-observation",
            "agent-journal"
          ]
        }
      ]
    }
  }
}
```

The manifest declares what the package contributes. It does not contain
executable callbacks. `activate()` registers those callbacks at runtime.

## Activating the extension

```ts
// src/index.ts
import { defineExtension } from "@terminay/extension-api";
import { exampleAgentProvider } from "./exampleAgent.js";

export default defineExtension({
  async activate(context) {
    const registration = context.agents.registerProvider(
      "com.example.agent/cli",
      exampleAgentProvider,
    );

    context.subscriptions.add(registration);
  },
});
```

`registerProvider()` accepts only an id declared in this package's manifest.
The returned registration is disposable. Adding it to `context.subscriptions`
makes Terminay dispose it automatically during disable, update, shutdown, or
extension-host failure.

The extension does not call a global Terminay singleton. Everything Terminay
grants to this extension arrives through `context` or a callback argument.

## Recognizing a foreground process

```ts
// src/exampleAgent.ts
import {
  defineAgentProvider,
  jsonlSession,
  type AgentTerminalContext,
} from "@terminay/extension-api";

export const exampleAgentProvider = defineAgentProvider({
  mappingVersion: "0.1",

  matchesForeground(process) {
    return process.executableName === "example-agent";
  },

  async observe(terminal) {
    const binding = await discoverSession(terminal);
    if (!binding) return { state: "not-bound" };

    return jsonlSession({
      binding,
      source: terminal.observation.files.follow(binding.journal),
      mapRecord,
    });
  },
});
```

Terminay invokes `matchesForeground()` with bounded safe process metadata. A
match asks Terminay to start a bounded observation attempt; it does not itself
prove session ownership.

`observe()` receives a context for one exact terminal and one process
incarnation. Its cancellation signal fires when the process leaves, the
terminal closes, the environment changes, or the extension is disabled.

## Discovering the provider session

```ts
async function discoverSession(terminal: AgentTerminalContext) {
  const processes = terminal.observation.processes;
  const files = terminal.observation.files;

  const descendants = await processes.descendants({
    signal: terminal.signal,
  });

  const writableFiles = await processes.openFiles(descendants, {
    access: "writable",
    signal: terminal.signal,
  });

  const candidate = writableFiles.find((file) =>
    file.path.endsWith("/.example-agent/sessions/current.jsonl"),
  );

  if (!candidate) return undefined;

  const journal = await files.canonicalFile(candidate.handle, {
    beneath: { homeRelative: ".example-agent/sessions" },
    extension: ".jsonl",
    signal: terminal.signal,
  });

  if (!journal) return undefined;

  const header = await files.readJsonLine(journal, {
    position: "first",
    maxBytes: 64 * 1024,
    signal: terminal.signal,
  });

  if (header?.type !== "session" || typeof header.id !== "string") {
    return undefined;
  }

  return terminal.bindSession({
    providerSessionId: header.id,
    mappingVersion: "0.1",
    journal,
    fingerprint: {
      kind: "writable-file-below-terminal-process",
      file: candidate.handle,
    },
  });
}
```

Important details:

- `terminal` is already scoped to one Terminay terminal.
- File and process handles are opaque and cannot be reused with another
  terminal context.
- `canonicalFile()` applies the selected environment's path rules. On This
  server it can be backed by Node filesystem operations; on SSH it is backed by
  the SSH environment's agent-journal capability.
- The extension chooses provider-specific evidence. Terminay validates that
  every referenced handle came from the issued terminal context.
- A display title, cwd, timestamp, or nearest filename is not session identity.

## Using Node APIs directly

An extension may use Node APIs when it intentionally needs ordinary server-host
behavior:

```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const preferences = JSON.parse(
  await readFile(join(homedir(), ".example-agent", "preferences.json"), "utf8"),
);
```

This reads from the selected Terminay Server account. It is valid extension
code, but it is not terminal identity evidence by itself and it does not work
against an SSH project's remote filesystem.

Use the terminal observation API when an operation must target the terminal's
project environment:

```ts
const metadata = await terminal.observation.files.readJson(binding.metadata, {
  maxBytes: 64 * 1024,
  signal: terminal.signal,
});
```

The practical rule is:

- use Node APIs for ordinary Node application work on the Terminay Server;
- use the observation API for terminal-scoped and environment-routed evidence;
- never import a private Terminay module to obtain internal services.

## Mapping native records

The mapper receives a parsed native record and a publisher already bound to the
validated provider session:

```ts
function mapRecord(record: unknown, session: AgentRecordContext) {
  if (!isObject(record)) return;

  if (record.type === "session_started") {
    session.publish.sessionStarted({
      title: boundedString(record.title, 200),
      model: modelMetadata(record.model),
    });
    return;
  }

  if (record.type === "user_message") {
    session.publish.turnStarted({
      turnId: boundedString(record.turnId, 200),
      promptText: boundedString(record.text, 4_000),
    });
    return;
  }

  if (record.type === "tool_started") {
    session.publish.toolStarted({
      toolId: requiredId(record.toolId),
      name: boundedString(record.toolName, 200) ?? "Tool",
    });
    return;
  }

  if (record.type === "approval_requested") {
    session.publish.waitStarted({
      waitId: requiredId(record.requestId),
      state: "waiting",
      reason: "Approval requested",
    });
    return;
  }

  if (record.type === "turn_completed") {
    session.publish.done({ outcome: "success" });
  }
}
```

The publisher deliberately has semantic methods instead of one unrestricted
`emit(object)` call. This gives authors autocomplete and lets the SDK validate
required ids, bounds, allowed states, and metadata before IPC.

Terminay supplies ordering and `occurredAt` when the provider has no reliable
values. Provider timestamps may be proposed but cannot rewind the canonical
stream.

## Updating title or model without changing state

```ts
session.publish.metadataChanged({
  title: "Investigate reconnect failures",
  model: {
    id: "example-pro-2",
    displayName: "Example Pro 2",
    reasoningEffort: "high",
  },
});
```

Metadata changes preserve `working`, `waiting`, `done`, and active tool state.
They do not synthesize a new session or turn.

## Publishing subagents

```ts
session.publish.subagentStarted({
  subagentId: nativeChild.id,
  parentAgentId: nativeChild.parentId,
  title: nativeChild.name,
  promptText: boundedString(nativeChild.task, 4_000),
});

session.publish.subagentDone({
  subagentId: nativeChild.id,
  outcome: "success",
});
```

A provider publishes a child only when its native data supplies a stable child
identity. It publishes completion only from matching authoritative evidence.
Terminay does not encourage array-index, title, prompt, or timing-based child
identity.

## Handling unsupported environments

```ts
async observe(terminal) {
  if (!terminal.capabilities.has("process-observation")) {
    return {
      state: "unavailable",
      reason: "environment-capability-missing",
    };
  }

  // Discover and observe normally.
}
```

Terminay keeps generic terminal activity active when authoritative agent
observation is unavailable. The extension returns a typed safe reason; it does
not throw a raw SSH, filesystem, or provider error into the UI.

## Cancellation and cleanup

```ts
async observe(terminal) {
  const watcher = await terminal.observation.files.follow(journal, {
    signal: terminal.signal,
  });

  try {
    for await (const chunk of watcher) {
      // Parse bounded records and publish canonical events.
    }
  } finally {
    await watcher.close();
  }
}
```

Every long-running API accepts the terminal cancellation signal. The SDK's
watchers are async-disposable and idempotent. Authors do not need to coordinate
renderer subscriptions, reconnects, or extension disablement themselves.

## Testing without Terminay internals

```ts
import {
  createAgentExtensionHarness,
  fixtureTerminal,
} from "@terminay/extension-api/testing";
import extension from "../dist/index.js";

test("maps a completed Example Agent turn", async () => {
  const terminal = fixtureTerminal({
    foregroundExecutable: "example-agent",
    files: {
      "/home/test/.example-agent/sessions/current.jsonl": [
        { type: "session", id: "session-1" },
        { type: "user_message", turnId: "turn-1", text: "Fix tests" },
        { type: "turn_completed" },
      ],
    },
  });

  const harness = await createAgentExtensionHarness(extension);
  await harness.observe(terminal);

  expect(harness.events()).toEqual([
    expect.objectContaining({ kind: "session.started" }),
    expect.objectContaining({ kind: "turn.started", promptText: "Fix tests" }),
    expect.objectContaining({ kind: "agent.done", outcome: "success" }),
  ]);
});
```

The public test harness checks manifest/registration agreement, bounds,
cancellation, session scope, lifecycle validity, and privacy exclusions. A
package can test its complete mapping without importing Server Core.

## What Terminay does for the extension

The extension does not implement:

- sidebar components or styling;
- project and terminal navigation;
- client subscriptions or remote transport;
- acknowledgement and unread behavior;
- canonical event ordering and replay rejection;
- extension enable/disable UI;
- process lifetime and crash backoff; or
- Electron versus standalone-server packaging behavior.

Terminay owns those behaviors. The extension supplies provider knowledge and
canonical lifecycle facts.

## What remains provider-specific

Each agent package documents and implements:

- executable recognition;
- exact process-to-session binding evidence;
- provider home/config resolution;
- durable journal/store locations;
- supported mapping versions;
- title and model metadata sources;
- root, wait, tool, completion, and subagent mappings;
- privacy exclusions; and
- honest fallback when the provider does not persist enough evidence.

