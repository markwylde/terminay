## Context

After phase 1, a project's files live on the server that owns it. After
phase 3, the client editor highlights and edits but has no language service.
The extension platform runs each extension as a supervised child process on
the server with a nine-operation broker; extensions can spawn processes with
the server account's authority; they cannot register protocol operations,
contribute UI, or enter the renderer.

The protocol is one central envelope schema with query, command, event, and
cancel envelopes, per-operation scopes, deadlines, payload limits, a
revisioned event journal with resync, and project-relative path DTOs. The
client emits `cancel` only for commands, so an aborted query keeps running on
the server.

Stakeholders: the file viewer, server-core, the extension API, the protocol,
packaging, and any future language extension (Rust, Python, Go).

## Goals / Non-Goals

**Goals:**

- Real diagnostics, completion, hover, and definition for TypeScript and
  JavaScript projects, from the project's own configuration.
- One mechanism that a second language reuses without touching core.
- A bounded protocol surface that keeps the UI ignorant of LSP.
- No new authority for extensions beyond spawning a child they already could.

**Non-Goals:**

- Rename, refactor, code actions, formatting, semantic tokens, workspace
  symbols. The surface is deliberately small; later changes may add
  operations.
- Running the language server anywhere but the server that owns the project.
- A language server for a project whose files the server cannot read.
- Replacing Monaco.

## Decisions

### Core owns the language surface; the extension is a provider behind it

Core registers `language.capabilities`, `language.completion`,
`language.hover`, and `language.definition` as read-scoped queries and
`language.diagnostics` as an event on the workspace journal. Payloads carry
`projectId`, a project-relative path, a document revision, and a position.
Core resolves the path through the canonical project resolver, forwards to
the session for the file's language, translates LSP results into bounded DTOs,
and truncates with an `isTruncated` flag at a per-operation byte and item cap.

Alternative rejected: let a language extension register operations or own a
channel. The platform spec forbids it, and it would put an extension on the
application protocol. Also rejected: proxy Monaco's worker protocol or raw
LSP JSON-RPC. Both are unbounded, stateful, and would move language logic
into the client.

Boundary: the application protocol boundary and the server-to-extension
broker boundary. Extensions gain a new invocation kind, `language.*`, invoked
by core, and no new broker operation.

### A language session is per project and language, shared and idle-reaped

The session manager keys sessions by `(projectId, languageServerId)`. The
first request for a file starts the session: the extension child spawns the
language server with the project root as cwd, initialises it, and opens the
document. Every client of that project shares it. A session with no open
documents and no request for a bounded idle period is shut down. A per-server
cap on concurrent sessions is enforced; beyond it the request returns a typed
unavailable outcome.

Alternative rejected: one session per client connection. A TypeScript
language service holds a whole program; per-client copies multiply server
memory by the number of open devices.

### Document state comes from the editor, project state from the disk

The client sends full document text on open and on change, with a revision
counter. Requests carry the revision they were made against; results carry
it back, and the client drops results for a stale revision. The language
server reads every other file from the project on disk. Save writes through
the existing file protocol; the session is told the file changed on disk
through the existing watch registry.

### Diagnostics push, everything else pulls

The session forwards `publishDiagnostics` into one debounced
`language.diagnostics` event per file on the workspace journal, so a client
that reconnects resyncs like any other event. Completion, hover, and
definition are queries with `deadlineMs` set by the client and a
client-side debounce; the client aborts superseded requests, and the
`cancel` envelope now reaches the server for queries.

### The extension declares selectors and a launch, not behaviour

`LanguageServerContribution` carries an id, language ids, file selectors,
and required runtime notes for Settings. Its registration supplies a `launch`
that returns argv, cwd policy, and environment for the language server given
a project root, plus optional initialisation options. The host owns spawning,
stdio framing, LSP initialise, lifecycle, deadlines, and translation. The
TypeScript extension's job is to find the project's TypeScript, fall back to
its bundled one, and set initialisation options.

Boundary: the extension child already runs with server-account authority;
spawning a language server adds no authority, and the host, not the
extension, decides cwd and reads the project.

### The editor consumes providers; it does not know about LSP

`TextViewer.tsx` registers Monaco completion, hover, and definition providers
that call a language gateway, and applies diagnostics as model markers. The
gateway is the only file that knows the operation names. Phase 3 leaves
Monaco's language workers out, so nothing competes with server diagnostics.

## Risks / Trade-offs

- [Server memory for TypeScript programs] → idle reaping, a per-server
  session cap, and a Settings toggle per language extension.
- [Completion round trips on a remote WebRTC connection] → client debounce,
  per-query deadline, cancellation of superseded queries, and a size cap so a
  slow query never blocks the shared application lane for long.
- [Module resolution touches thousands of files on first load] → the session
  starts on first request, not on project open, and reports a `starting`
  state the editor shows quietly.
- [A project without TypeScript installed] → the extension bundles one and
  reports which it used.
- [Query cancellation fix changes client behaviour for every feature] →
  covered by a protocol conformance test that aborts a query and asserts the
  server observed the cancel.

## Migration Plan

None. The feature is additive. Rollback is disabling the extension in
Settings, which returns the editor to highlighting only.

## Open Questions

- None that block. A future change decides whether the surface grows to
  rename, code actions, and formatting.
