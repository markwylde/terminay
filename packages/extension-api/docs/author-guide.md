# Extension author guide

Terminay extensions are ESM npm packages installed and executed by the selected
Terminay Server. Desktop and browser clients receive bounded declarative data;
they never import an extension. The v1 API supports project-environment
providers and agent providers.

## Build the first provider

1. Require Node 22 or newer and add `@terminay/extension-api` as a development
   dependency. Do not import Terminay internals.
2. Put a closed `terminay` manifest in `package.json`; copy
   `examples/basic-provider` as a starting point and replace every namespaced id.
3. Export `defineExtension({ activate, deactivate })` from the manifest's ESM
   entrypoint. In `activate`, register each declared provider exactly once.
4. Describe forms and status with API DTOs. Do not ship renderer code, HTML,
   CSS, SVG, routes, or callbacks in presentation objects.
5. Implement all provider runtime callbacks and honour `context.signal` and
   `context.deadlineAt`. Mutations must use the host idempotency key and expected
   revision when supplied.
6. Keep only redacted, JSON-safe state in `providerState`. Resolve secrets only
   inside `secrets.withValue`; never return, log, cache, or persist the bytes.
7. Run `npx terminay-extension-conformance package.json`, unit tests, and the
   release verifier before packing.
8. Test the packed tarball in a clean Terminay Server, not a workspace import.

## Build an agent provider

An agent provider recognizes a foreground terminal process, binds it to
provider-specific evidence, and maps that evidence into Terminay's canonical
agent lifecycle. Start with [`examples/agent-provider`](../examples/agent-provider)
and read the [agent provider guide](agent-providers.md).

1. Declare the `agent-observation` permission and one or more namespaced
   `contributes.agentProviders` entries in the manifest.
2. Register each declared id from `activate()` with
   `context.agents.registerProvider()`, then add its disposable registration to
   `context.subscriptions`.
3. Use `defineAgentProvider()` for foreground recognition and terminal-scoped
   observation. Bind a session only from provider-specific, process-bound
   evidence, then publish lifecycle facts with the bound publisher.
4. Pass `terminal.signal` to every long-running operation and clean up
   idempotently when it aborts. Return a typed unavailable result when the
   selected environment lacks a required observation capability.
5. Test mapping with `createAgentExtensionHarness()` and `fixtureTerminal()`
   from `@terminay/extension-api/testing`; do not import Server Core, Electron,
   renderer, or host-bridge modules.

### Terminal facts and journal paths

`terminal.tty` is optionally supplied as a host-issued `{ deviceId,
deviceName? }` fact for the registered PTY. Use it only as provider data—for
example, to select a matching entry from a provider-owned resume index. It may
be absent, so keep a non-TTY discovery fallback. It does not grant path access,
and providers must not construct a filesystem path directly from it.

Use the file observation broker for every terminal-scoped journal lookup:

- Use `resolveHomeRelative()` for an exact known location below home.
- If a bounded provider record contains an absolute filename, use
  `resolvePathUnderHome()` with the narrowest declared `beneath.homeRelative`
  root. The value remains data until the host returns an opaque handle.
- Use `homeRelativePath()` only to compare or display a canonical handle's
  relative location. It is a fact, not a new read/follow capability.

For example, a Claude-style exact-resume mapper can read its own validated
resume id from a provider journal, then request the known transcript location
under `.claude/projects`; it must fall back when no TTY-associated resume entry
or transcript is present:

```js
const transcript = await terminal.observation.files.resolveHomeRelative(
  `.claude/projects/${projectKey}/${resumeId}.jsonl`,
  {
    beneath: { homeRelative: ".claude/projects" },
    extension: ".jsonl",
    signal: terminal.signal,
  },
);
if (!transcript) return { state: "not-bound" };
```

`projectKey` and `resumeId` above are validated provider-native path segments;
they are not raw terminal, process, or user input. The optional `terminal.tty`
fact may select the resume-index entry, but is never interpolated into a path.

An OMP-style breadcrumb can instead contain provider-record absolute paths.
For a provider-managed root outside home, declare `PI_CODING_AGENT_DIR` in the
agent contribution's `requiredEnvironmentVariables`. Read it only through the
exact terminal foreground/descendant process—never `process.env`; a remote
environment may not expose it, in which case return the normal unavailable or
not-bound result. The host retains the raw root internally. Read a known
breadcrumb and constrain every path it names by variable *name*:

```js
const env = await terminal.observation.processes.environment(["PI_CODING_AGENT_DIR"], {
  signal: terminal.signal,
});
if (!env.PI_CODING_AGENT_DIR) return { state: "not-bound" };

const breadcrumb = await terminal.observation.files.resolveRelativeToEnvironment(
  "breadcrumbs/current.json",
  { environmentVariable: "PI_CODING_AGENT_DIR", signal: terminal.signal },
);
const root = await terminal.observation.files.resolvePathUnderEnvironment(
  breadcrumb.rootJournalPath,
  {
    environmentVariable: "PI_CODING_AGENT_DIR",
    beneathRelative: "sessions",
    extension: ".jsonl",
    signal: terminal.signal,
  },
);
const children = await Promise.all(breadcrumb.children.map(async ({ id, path }) => {
  const journal = await terminal.observation.files.resolvePathUnderEnvironment(path, {
    environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "sessions",
    extension: ".jsonl", signal: terminal.signal,
  });
  return journal ? { childId: id, journal, source: terminal.observation.files.follow(journal) } : undefined;
}));
```

After filtering absent children, pass them as `childSources` to the single root
`jsonlSession()`. In its record mapper, branch on `context.journal.role` to
give child records their provider-native meaning; `childId` is stable context,
not a second root binding. These are public SDK patterns only—do not import a
private agent runtime or host bridge. If a UI label or mapping needs a stable
relative name below `PI_CODING_AGENT_DIR`, call
`environmentRelativePath(handle, { environmentVariable: "PI_CODING_AGENT_DIR",
beneathRelative: "sessions" })`. It returns a fact only; retain the opaque
handle for reads and follows.

Extensions are ordinary trusted Node.js packages. Public `node:` APIs and
declared npm dependencies are allowed for normal work on the Terminay Server.
They are not evidence that identifies a remote terminal or a session in an SSH
environment. For terminal-scoped process and file observations, especially in
remote environments, use the `AgentTerminalContext` observation broker.

The server may stop, restart, retry, or cancel a callback. Make every external
mutation idempotent and every resume operation reconstructible from persisted
redacted provider state. Throw bounded user-safe errors without credentials,
endpoints, provider response bodies, local paths, or stacks.

## Provider lifecycle

`activate` declares providers and performs no external mutation. Profiles store
non-secret configuration and opaque host-owned secret bindings. Creating an
environment returns either `ready` or a resumable `pending` operation. `getStatus`
must be read-only. Actions, updates, and deletes return a revised state and may
also be resumable. `invokeService` is optional and is only for the documented
terminal/filesystem capability DTOs accepted by that provider; it is not a
generic command surface.

Deactivation stops admissions and releases resources. It must not delete remote
machines, files, profiles, credentials, or environments.

## Conformance workflow

The CLI verifies the closed manifest, package identity, and exported entrypoint:

```sh
npm run build
npx terminay-extension-conformance package.json
node ./node_modules/@terminay/extension-api/scripts/verify-release.mjs . --output ./release-evidence
npm pack --ignore-scripts
```

Install the resulting exact tarball into a disposable server data root for the
final smoke test. Installation from a folder, Git URL, or tarball is not a
supported end-user install path; this local step only verifies what will be
published.
