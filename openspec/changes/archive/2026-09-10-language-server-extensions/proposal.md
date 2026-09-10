## Why

Terminay's editor knows what a file looks like but not what it means. There
are no real errors, no completions, no hover, no go-to-definition, because
nothing in the product reads a project's `tsconfig`, its other files, or its
`node_modules`. VS Code does all of this by running a language server next
to the files. After phase 1 every project's files are on its Terminay Server,
and after phase 3 the client has stopped pretending to do this itself. The
server is the place, and the extension platform is the mechanism.

The extension platform today allows exactly one contribution kind, coding
agent providers, and explicitly rejects "editor plugins" and "autocomplete".
That text predates the decision that language intelligence is a server
concern. This change adds a second kind, **language servers**, keeps the UI
free of language logic, and ships TypeScript as the first built-in.

## What Changes

- The extension platform gains a `languageServers` contribution kind. A
  language server extension declares the language ids and file selectors it
  serves and how to start its server; the host runs the server as a child of
  the extension process on the Terminay Server, with the project root as its
  working directory.
- The server gains a bounded, core-owned **language** protocol surface:
  capabilities, diagnostics, completion, hover, and definition, keyed by
  project and project-relative path with a document revision. Core owns the
  operation names and payload shapes; the extension is a provider behind them
  and speaks the Language Server Protocol only on its own side. No LSP
  JSON-RPC crosses the application protocol.
- Diagnostics are pushed as events on the existing revisioned journal.
  Completion, hover, and definition are queries with deadlines, size caps,
  and cancellation. Query cancellation is fixed so an aborted query cancels
  server work, which today only happens for commands.
- One language session per project and language on a server, shared by every
  client, started on first use and stopped after idle.
- The file viewer consumes these features in Text mode: server diagnostics as
  editor markers, completion, hover, and definition through the editor's
  provider hooks. The file viewer non-goal that excluded language servers is
  reversed.
- `terminay-language-typescript` becomes a built-in extension. It runs
  `typescript-language-server` against the project's own TypeScript when
  present and a bundled TypeScript otherwise, and serves `.ts`, `.tsx`,
  `.js`, and `.jsx`.
- Extensions still contribute no UI, register no protocol operations, and
  never enter the renderer.

## Capabilities

### New Capabilities

- `language-intelligence`: language sessions, the bounded language protocol
  surface, path and revision model, sharing and idle lifecycle, and the
  degraded states when no provider serves a file.

### Modified Capabilities

- `extension-platform`: bounded API scope admits the language server
  contribution kind; contribution arrays, registration, lifecycle, bounds, and
  the child-process model are extended for it.
- `built-in-extensions`: the TypeScript language server package joins the
  official set, the release inventory, and the packaging contracts.
- `server-runtime-and-protocol`: the versioned application protocol lists
  language operations and events; query cancellation is required to reach the
  server.
- `file-viewer`: Text mode consumes server language features; non-goals no
  longer exclude a language server.

## Impact

- `packages/extension-api`: `LanguageServerContribution`, registration on
  `ExtensionContext`, validation, limits, conformance fixtures.
- `packages/server-core/src/extensions`: descriptor, host validation, child
  invocation kind for language sessions, a session manager keyed by project
  and language, idle reaping.
- `packages/server-core/src/languageService/`: new; operation registries,
  path resolution through the canonical project resolver, result bounds,
  diagnostics fan-out onto the event journal.
- `packages/protocol` and `packages/client-core`: `language.*` operation
  names, DTOs, and a feature client; query cancellation in `client.ts`.
- `src/components/file-viewer`: a language gateway and Monaco provider
  adapters in `TextViewer.tsx`.
- `extensions/language-typescript/`: new built-in package;
  `extensions/builtins.json`, catalogue, turbo, packaging tests.
- Server memory: one TypeScript language service per open project per server.
  Bounded by idle reaping and a per-server session cap.

## Sequencing

Phase 4 of four. Assumes phase 3. Independent of phase 2, and works
unchanged with attached servers because every language request already
targets one server and one project.
