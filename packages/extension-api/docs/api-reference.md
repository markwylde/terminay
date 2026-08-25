# Extension API v1.2 reference

Directory discovery and dynamic agent child sources were introduced in 1.2.
An extension using either must declare `"api": "^1.2.0"` in its Terminay
manifest; extensions using the prior surface remain compatible with this host.

Import only from `@terminay/extension-api`. The package's generated TypeScript
declarations are canonical; this page explains the callable surface and
lifecycle. JSON values are null, booleans, finite numbers, strings, arrays, or
plain string-keyed objects. Executable values and unknown DTO fields fail host
validation.

## Extension entrypoint

`defineExtension(TerminayExtension)` preserves types and returns the extension.
`activate(context)` registers contributions; optional `deactivate()` releases
resources. `ExtensionContext` exposes the immutable `extensionId`, negotiated
`apiVersion`, own configuration/data/cache paths, and
`registerProjectEnvironmentProvider`. For agent extensions it also exposes
`agents.registerProvider(id, provider)` and disposable `subscriptions`.

Registration contains a declarative `ProviderDefinition` and a `ProviderRuntime`.
The definition's id, display metadata, icon, capabilities, `profileForm`, and
`createForm` must agree with the manifest contribution.

### Profile-save environment creation

Saving a profile creates only the profile by default. A provider may opt in to
creating one environment bound to that new profile by declaring
`profileSave: { createEnvironment: true }` on its manifest
`contributes.projectEnvironments` entry. This is an activated-contribution
declaration: the host honours it only after that exact provider has registered
at activation. Providers without the declaration—including provisioners whose
`createEnvironment` needs additional create-form values—are never guessed.

## Runtime callbacks

| Method | Purpose | Result |
| --- | --- | --- |
| `testProfile` | Validate non-secret values and brokered connectivity. | `ValidationIssue[]` |
| `resolveOptions` | Bounded async options for a declared source. | `OptionSourceResult` |
| `createEnvironment` | Create/bind an environment id assigned by the host. | `ProvisioningResult` |
| `resumeOperation` | Resume/poll durable pending work. | `ProvisioningResult` |
| `getStatus` | Read current environment status. | `ProviderEnvironmentStatus` |
| `invokeAction` | Run one declared lifecycle action. | `EnvironmentActionResult` |
| `updateEnvironment` | Optional revision-aware update. | `EnvironmentActionResult` |
| `deleteEnvironment` | Optional explicit provider deletion. | `EnvironmentActionResult` |
| `invokeService` | Optional environment-bound capability operation. | Operation-specific JSON DTO |

Every call receives `ProviderCallContext`: absolute `deadlineAt`, cancellation
`signal`, optional mutation `idempotencyKey` and `expectedRevision`, and the
brokers below. Call `signal.throwIfAborted()` before and after awaited external
work; do not begin work that cannot finish before the deadline.

## Brokers

- `profiles.get(profileId)` returns an own-provider `ProviderProfileSnapshot`
  containing non-secret JSON values, secret field names, and revision.
- `secrets.withValue({profileId, fieldId, purpose}, callback)` resolves one
  exact own binding for the callback lifetime.
- `sshAgent.listIdentities` and `sshAgent.sign` expose bounded public identity
  metadata and one SSH user-authentication signature. They never expose a
  socket or private key.
- `dependencies.call` invokes one compatible manifest-declared provider with a
  bounded operation/payload/deadline. The host authorizes and routes it.

Broker availability is constrained by manifest permission. Calls do not confer
ownership of ids embedded in their payloads.

## Provider dependency targets

A target provider optionally registers `ProviderRegistration.dependencyOperations`
with a `ProviderDependencyHandler`. The host invokes `handler.call(request,
context)` only after authorizing an operation named in the target's manifest
`dependencyOperations` allowlist and a compatible caller dependency. Do not
implement authorization in the handler by accepting an identity from payload:
`request.caller` is host-authenticated `{ extensionId, providerId }` metadata.

`request.operation` and `request.payload` are bounded JSON. A result must also
be plain JSON (up to 256 KiB); functions, class instances, cyclic values, and
unknown request fields are rejected. The context has the host-assigned absolute
`deadlineAt`, cancellation `signal`, and optional `idempotencyKey` and
`expectedRevision`. Check cancellation around external work, use the same
idempotency key for retries of a mutation, and apply `expectedRevision` for
optimistic concurrency when updating existing target state. Target handlers
receive `ProviderDependencyTargetContext`, which contains those base fields and
one target-owned `vault` broker. It deliberately does not contain profile,
secret, or SSH-agent brokers.

### Target vault

`context.vault` owns a narrow, atomic credential lifecycle for the target
provider. It inherits its enclosing target deadline and cancellation signal;
none of its methods accepts a replacement signal or deadline.

```ts
const stored = await context.vault.put({
  bindingKey: "connection.primary",
  purpose: "ssh.authentication",
  value: new TextEncoder().encode(token),
  idempotencyKey: context.idempotencyKey ?? "create-connection",
  expectedRevision: context.expectedRevision,
});

const client = await context.vault.withSecret(
  { binding: stored.binding, purpose: "ssh.authentication" },
  async (copy) => connectWithToken(copy),
);
await context.vault.remove({ binding: stored.binding, idempotencyKey: "remove-connection" });
```

`put` returns only a durable opaque `{ bindingRef }` and a revision. The ref is
safe to persist in redacted provider state, but is scoped by the host to the
extension installation and target provider; it is neither a vault path nor a
host-global secret id. There is no read, get, list, export, create/bind split,
or raw-secret result API.

`withSecret` makes a transient `Uint8Array` copy available only to its local
callback. Its generic callback result stays in the extension child—it is never
put on vault IPC and may be a live local object. Do not return, retain, log,
place in a presentation DTO, or otherwise expose the secret bytes. Hosts must
zeroize parent and child copies in `finally` paths. A removal during an active
callback returns `pending`, denies every new use, then cleans up after that
callback finishes. After a host/child crash, hosts must deny the binding until
their vault's crash cleanup has completed. Foreign, stale, and deleted bindings
must be indistinguishable to the caller.

Tests can import `createProviderDependencyTargetHarness()` from
`@terminay/extension-api/testing`. It validates the public request, context,
handler result, and cancellation plumbing; it deliberately does not emulate
host authorization. `createProviderVaultHarness()` is similarly a one-scope
functional mock for atomic writes, callback lifetime, and pending removal. It
does **not** prove cross-extension/install isolation; production hosts are
responsible for that enforcement. Test authorization and manifest compatibility
at the host boundary, rather than through private Terminay imports.

## Results and state

Creation/resume returns `ready` with provider state and status, or `pending`
with an operation id, stable progress stages, resumable provider state, and an
optional bounded poll delay. Actions similarly return `complete` or `pending`.
Status has an availability state, safe message/default root/card/progress, and
monotonic revision.

Provider state must contain only the minimum redacted restart information.
Profiles, environments, projects, operations, and secret references remain
host-owned records. A provider cannot retarget their identity.

## Declarative presentation

`DeclarativeForm` contains bounded sections and fields: text, URL, secret,
textarea, number, checkbox, switch, select, and preset cards. Conditions compare
one primitive field value. Option sources return plain options plus an opaque
cursor. Status cards contain safe facts/actions and optionally a credential-free
HTTPS link. Confirmations bind a kind, label, and expected revision. Progress
contains stable ordered stages and a resumable flag. Icons are selected from
the Terminay-owned `ExtensionIcon` union.

Use the exported runtime validators and fixtures in tests. The host applies the
same closed validators at manifest, activation, and callback IPC boundaries.

## Agent providers

`defineAgentProvider()` defines the provider-specific part of agent
observation. `matchesForeground(process)` receives only bounded safe process
metadata. A match requests an observation attempt; it does not establish
session ownership. `observe(terminal: AgentTerminalContext)` receives one exact
terminal/process incarnation and must return either a bound observation or a
typed unavailable/not-bound result.

`AgentTerminalContext` provides the cancellation signal, advertised environment
capabilities, and `AgentObservationBroker`. The broker supplies only
terminal-scoped, environment-routed process and file evidence. Its opaque
handles cannot be used with another terminal context. After the provider has
validated provider-specific evidence, `terminal.bindSession()` returns an
`AgentSessionBinding`; only that binding can create an `AgentLifecyclePublisher`.

`terminal.tty` is an optional, host-issued `{ deviceId, deviceName? }` fact for
the exact PTY. It is useful when a provider's own journal format associates a
resume record with a terminal device, but it is neither a path nor filesystem
authority. It can be absent; treat that as an ordinary fallback case and do not
poll or dynamically refresh it.

The file broker has three deliberately narrow discovery operations:

- `resolveHomeRelative(relativePath, options)` resolves a known, non-escaping
  relative path in the selected environment home.
- `resolvePathUnderHome(providerPath, { beneath, ... })` accepts an absolute
  path found in a provider record only after the host proves that it remains
  below the explicit home-relative root. It is not arbitrary absolute-path
  access.
- `homeRelativePath(handle, { beneath })` returns only a normalized display or
  comparison fact for an existing opaque handle. The returned string cannot be
  passed to `read()` or `follow()`; retain the handle for those operations.

All three requests reject traversal, backslashes, unsafe extensions, and roots
outside their declared constraint at the host boundary.

For a provider-owned multi-journal format, first resolve an opaque directory
root with `resolveHomeDirectory()` or
`resolveDirectoryRelativeToEnvironment()`. Then call
`listDirectory(root, { extensions, maxDepth, maxEntries, maxBytes })`; every
limit and at least one suffix is mandatory. Results contain opaque regular-file
handles plus a relative-path fact, size, and optional timestamp. They cannot
be used to traverse, read, or follow another directory. `watchDirectory()` has
the same limits, yields the initial snapshot and subsequent changed snapshots,
and must be disposed. It is the public mechanism for a provider to discover a
late native child without polling its own local filesystem or re-binding the
terminal. Remote routing either provides the same scoped capability or fails;
it never falls back to the server's local disk.

An agent-provider contribution may additionally declare bounded
`requiredEnvironmentVariables` names. `observation.processes.environment(names)`
then returns only declared, bounded facts from the exact terminal foreground
process or its descendants—never the extension host's ambient Node environment.
This evidence can be unavailable on a remote environment; return the normal
typed unavailable/not-bound result instead of substituting `process.env`.

For a provider-managed root outside home (for example
`PI_CODING_AGENT_DIR`), use `resolveRelativeToEnvironment(relativePath,
{ environmentVariable, ... })` for a known location, or
`resolvePathUnderEnvironment(providerPath, { environmentVariable,
beneathRelative?, ... })` for a provider-record absolute path. Pass the
*declared variable name*, never its raw value: the host reads the terminal
environment internally, canonicalizes strict containment, and returns only an
opaque file handle. `environmentRelativePath(handle, { environmentVariable,
beneathRelative? })` returns a normalized fact below that same declared root;
like `homeRelativePath()`, it never grants read or follow authority.

Use `jsonlSession()` for bounded JSONL replay/follow when it fits the provider's
journal format. Its record mapper receives the parsed record and an
`AgentRecordContext`, whose publisher has semantic methods for session, turn,
tool, wait, metadata, completion, exit, and subagent lifecycle facts. The host
assigns canonical order and rejects invalid transitions, stale contexts,
cross-terminal handles, and oversized values.

`createJsonlRecordDecoder(maxRecordBytes?)` is the public plain-data decoder for
provider tests and non-host adapters. It buffers incomplete lines and split
UTF-8 bytes, discards an oversized record through its terminating newline, and
accepts `push(bytes, true)` (or `reset()`) after truncate or atomic replacement.
It never emits a partial or malformed record. The host-driven harness checks
the terminal cancellation signal before acquiring a watcher, between chunks,
and before each mapping callback, and disposes every acquired watcher in a
`finally` path. Providers must also pass `terminal.signal` to broker calls.

`selectAgentMapping()` chooses the greatest declared semantic mapping no newer
than a recognized provider version. Versions below the oldest mapping use that
oldest conservative mapping; unparseable future labels use the newest declared
mapping so the mapper can ignore unknown records. `safeAgentString()` rejects,
rather than truncates, unsafe identity text. `createAgentLifecyclePublisher()`
builds the semantic convenience methods around any event sink and validates
every bounded canonical event before delivery.

One `jsonlSession()` has one root source and may declare bounded `childSources`.
Every child carries a stable `childId`, its own opaque journal handle, and a
watcher, but it shares the root binding and cannot establish another root
session. In `mapRecord(record, context)`, use `context.journal.role` and, for a
child, `context.journal.childId` to interpret provider-native child records.
For children that appear later, `childSourceDiscovery` is an async iterable of
the same child-source shape. The host starts each newly discovered stable id
once, after the root has begun, and de-duplicates it for that root binding.

For ordinary local server work, extensions may import public `node:` modules and
their declared npm dependencies. Node filesystem/process values are not a
substitute for terminal-scoped evidence and cannot inspect a remote project.
Use `AgentObservationBroker` whenever the operation needs the selected terminal
or its environment.

The public `@terminay/extension-api/testing` entrypoint exports
`createAgentExtensionHarness()` and `fixtureTerminal()`. It tests manifest and
registration agreement, binding scope, cancellation, lifecycle validity, and
bounded publication without importing Terminay internals.
