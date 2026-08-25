# Agent provider guide

An agent provider is an ordinary ESM Node.js extension that recognizes an agent
in one foreground terminal, binds a native session with authoritative evidence,
and publishes provider-neutral lifecycle facts. Terminay owns canonical event
ordering, storage, remote delivery, sidebar rendering, retries, and extension
lifetime.

## Minimal registration

```js
import { defineExtension } from "@terminay/extension-api";
import { exampleAgentProvider } from "./example-agent.js";

export default defineExtension({
  activate(context) {
    const registration = context.agents.registerProvider(
      "com.example.agent/cli",
      exampleAgentProvider,
    );
    context.subscriptions.add(registration);
  },
});
```

The id must be declared by `contributes.agentProviders` in this package's
manifest. Registrations are disposed automatically during disable, update,
shutdown, and extension-host failure.

## Observation and binding

```js
import {
  defineAgentProvider,
  jsonlSession,
} from "@terminay/extension-api";

export const exampleAgentProvider = defineAgentProvider({
  mappingVersion: "0.1",
  matchesForeground(process) {
    return process.executableName === "example-agent";
  },
  async observe(terminal) {
    if (!terminal.capabilities.has("process-observation")) {
      return { state: "unavailable", reason: "environment-capability-missing" };
    }

    const descendants = await terminal.observation.processes.descendants({
      signal: terminal.signal,
    });
    const files = await terminal.observation.processes.openFiles(descendants, {
      access: "writable",
      signal: terminal.signal,
    });
    const candidate = files.find((file) =>
      file.path.endsWith("/.example-agent/sessions/current.jsonl"),
    );
    if (!candidate) return { state: "not-bound" };

    const journal = await terminal.observation.files.canonicalFile(candidate.handle, {
      beneath: { homeRelative: ".example-agent/sessions" },
      extension: ".jsonl",
      signal: terminal.signal,
    });
    if (!journal) return { state: "not-bound" };

    const header = await terminal.observation.files.readJsonLine(journal, {
      position: "first", maxBytes: 64 * 1024, signal: terminal.signal,
    });
    if (header?.type !== "session" || typeof header.id !== "string") {
      return { state: "not-bound" };
    }

    const binding = await terminal.bindSession({
      providerSessionId: header.id,
      mappingVersion: "0.1",
      journal,
      fingerprint: { kind: "writable-file-below-terminal-process", file: candidate.handle },
    });
    return jsonlSession({
      binding,
      source: terminal.observation.files.follow(journal, { signal: terminal.signal }),
      mapRecord,
    });
  },
});
```

A title, cwd, timestamp, or filename alone is not session identity. Bind only
with provider-specific evidence associated with the issued terminal process.
Pass `terminal.signal` to all work and always close any custom watcher in a
`finally` block.

## Terminal facts, exact resumes, and child journals

`terminal.tty` is an optional host-issued fact for the exact terminal:
`{ deviceId, deviceName? }`. It can help select an entry from a provider-owned
resume index, but it is not a path and does not add filesystem authority. It is
normal for an environment not to provide it; use a non-TTY fallback and do not
try to refresh it dynamically.

For a Claude-style exact resume, validate the provider's known project key and
resume id, then resolve only the expected home-relative journal location. Do
not construct a path from the TTY fact or import a private Claude/host module:

```js
const journal = await terminal.observation.files.resolveHomeRelative(
  `.claude/projects/${projectKey}/${resumeId}.jsonl`,
  { beneath: { homeRelative: ".claude/projects" }, extension: ".jsonl", signal: terminal.signal },
);
if (!journal) return { state: "not-bound" };
```

If a provider record contains an absolute path, it is still data, not an
authority. An OMP-style provider whose `PI_CODING_AGENT_DIR` is outside home
declares that *name* in `requiredEnvironmentVariables`, then requests it with
`terminal.observation.processes.environment(["PI_CODING_AGENT_DIR"])`. That
returns only an exact foreground/descendant process fact, never the extension
host's ambient environment. A remote environment can omit this evidence; return
the normal unavailable/not-bound result rather than reading `process.env`.

The host keeps the raw root value internal. Resolve the fixed breadcrumb with
`resolveRelativeToEnvironment("breadcrumbs/current.json", {
environmentVariable: "PI_CODING_AGENT_DIR" })`, then narrow every root or
child path from its record with `resolvePathUnderEnvironment(path, {
environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "sessions" })`.
The host canonicalizes strict containment and returns an opaque handle. Use
`environmentRelativePath(handle, { environmentVariable:
"PI_CODING_AGENT_DIR", beneathRelative: "sessions" })` only when a normalized
relative name is needed for comparison or display. It is fact-only; continue
using the handle for reads and follows. `homeRelativePath(handle, { beneath })`
is the corresponding fact-only operation for a home-rooted journal.

One root JSONL binding may follow bounded child journals:

```js
return jsonlSession({
  binding,
  source: terminal.observation.files.follow(root, { signal: terminal.signal }),
  childSources: [{
    childId: breadcrumb.childId,
    journal: child,
    source: terminal.observation.files.follow(child, { signal: terminal.signal }),
  }],
  mapRecord(record, context) {
    if (context.journal.role === "child") {
      // context.journal.childId identifies this provider-native child stream.
    }
  },
});
```

Children share the root binding and never create another root session.

## Mapping records

```js
function mapRecord(record, session) {
  if (!record || typeof record !== "object") return;
  if (record.type === "session" || record.type === "session_started") {
    session.publish.sessionStarted({ title: bounded(record.title, 200) });
  } else if (record.type === "user_message") {
    session.publish.turnStarted({
      turnId: requiredId(record.turnId), promptText: bounded(record.text, 4_000),
    });
  } else if (record.type === "approval_requested") {
    session.publish.waitStarted({
      waitId: requiredId(record.requestId), state: "waiting", reason: "Approval requested",
    });
  } else if (record.type === "turn_completed") {
    session.publish.done({ outcome: "success" });
  }
}
```

Use stable native ids for turns, tools, waits, and subagents. Do not derive
identity from array indexes, display text, prompts, or timing. The semantic
publisher validates lifecycle input before IPC; Terminay supplies canonical
sequence and timestamps when needed.

## Node APIs and environment scope

Public Node APIs and declared npm dependencies are valid for ordinary local
server work. They do not establish identity for a selected terminal and cannot
reach SSH project files. Use `terminal.observation` for process and file
evidence tied to a terminal, and return a typed unavailable result when the
environment lacks the required capability. Never import Server Core, Electron,
renderer code, or private host bridges.

## Testing

Use `createAgentExtensionHarness()` and `fixtureTerminal()` from
`@terminay/extension-api/testing` to test the packed extension's registration,
binding, cancellation, and events. The test harness is the public test surface;
do not import Terminay internals.
