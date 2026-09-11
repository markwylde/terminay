# ADR-0019: Language intelligence comes from language-server extensions on the Terminay Server, behind a core-owned bounded protocol surface

Status: accepted
Date: 2026-09-09

## Context

The workspace UI shipped Monaco's in-browser TypeScript, CSS, HTML, and JSON
language services. They typechecked one anonymous buffer against default
compiler options with no project configuration, no sibling files, and no
dependencies, so they reported errors the project did not have, and they were
about 8.7 MB of the 20 MB workspace bundle every browser session downloads.

With ADR-0017 a project's files, configuration, and dependencies live on the
server that owns it. That is where a language server can read them. The
extension platform already runs trusted extensions as supervised child
processes on the server, and its spec explicitly rejected editor plugins and
autocomplete sources because those would put extension code in the renderer.
Language intelligence can be added without doing that.

## Decision

1. **The client runs no language service.** The editor highlights with
   tokenizers and edits; diagnostics, completion, hover, and definition are
   computed by the server or not at all. The bundle carries no language
   workers, and a build check fails if one is emitted.
2. **Language servers are an extension contribution kind.** A language-server
   extension declares language ids, file selectors, and how to launch its
   server. The extension host spawns the language server as a child of the
   extension process on the Terminay Server, with the project root as its
   working directory, and owns lifecycle, stdio framing, initialise,
   deadlines, and translation. Extensions still contribute no UI, register no
   protocol operations, and never enter the renderer.
3. **Core owns the language protocol surface.** Core registers bounded
   operations for capabilities, completion, hover, and definition as queries
   and diagnostics as an event on the revisioned workspace journal. Payloads
   carry a project id, a project-relative path, a document revision, and a
   position; results are capped by bytes and items and marked when truncated.
   No Language Server Protocol JSON-RPC and no editor worker protocol crosses
   the application protocol.
4. **One language session per project and language per server, shared by
   every client, started on first request and stopped after idle**, with a
   per-server cap. Document text comes from the editor with a revision;
   everything else the language server reads from the project on disk.
5. **The application protocol cancels queries.** An aborted query reaches the
   server as a cancel envelope, exactly as commands do.
6. **TypeScript is the first built-in language-server extension.** It runs
   `typescript-language-server` against the project's own TypeScript when
   present and a bundled one otherwise.

## Rejected alternatives

- **Feed the browser worker a tsconfig, sibling models, and declaration
  files.** A worse language server in the client, still without the
  project's real dependencies.
- **Proxy Monaco's worker protocol to a server thread.** Chatty, unbounded,
  and it keeps editor logic in the client.
- **Let language extensions register protocol operations or own a channel.**
  Puts an extension on the application protocol and breaks the platform's
  bounded API scope.
- **One language session per client connection.** Multiplies a whole
  TypeScript program by the number of open devices.

## Consequences

- The workspace bundle shrinks by roughly 8.7 MB unpacked and fake
  diagnostics disappear immediately, before any server feature exists.
- A second language (Rust, Python, Go) is another extension on the same
  session model and protocol surface, with no core change.
- Server memory grows by one language service per active project per
  language; idle reaping, the session cap, and a per-extension Settings
  toggle bound it.
- Completion round trips on a remote connection are real network latency;
  client debounce, per-query deadlines, cancellation of superseded queries,
  and result caps keep them off the shared application lane.
- The surface is deliberately small. Rename, code actions, formatting,
  semantic tokens, and workspace symbols are future operations on the same
  model, not reasons to widen it now.
