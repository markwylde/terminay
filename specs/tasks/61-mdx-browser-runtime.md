# MDX browser runtime

## Goal

Compile and render project MDX with real React/TSX imports in a disposable
browser sandbox. Rendered code has normal browser networking, external assets,
interactive forms, cookies/storage, and governed downloads, but it cannot use
Node, Electron, a preload bridge, Terminay APIs, another project, or files
outside its project root.

This task delivers the execution runtime only. Task 62 supplies the
Documentation tree, MDXEditor, document tabs, and autosave.

## Governing specifications

- [MDX browser runtime](../features/mdx-browser-runtime.md)
- [Project environments](../features/project-environments.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Security threat model](../decisions/security-threat-model.md)

## Read these implementation anchors first

- `packages/server-core/src/fileService/pathResolver.ts` — final canonical
  project-path validation. Do not create a second weaker path checker.
- `packages/server-core/src/fileService/catalog.ts` and `catalogAdapter.ts` —
  bounded project storage access and application-protocol registration pattern.
- `packages/server-core/src/extensions/remoteFileProtocol.ts` — creates the same
  file services for non-local project environments.
- `apps/terminay-server/src/cli.ts`, `createDefaultProjectFileServices` —
  standalone composition and root-change reconciliation.
- `packages/client-core/src/fileViewer.ts` — typed host-neutral feature client
  pattern, including binary query bodies.
- `src/shared/rendererServerClient.ts` — creates feature clients once for both
  Desktop and connected web renderers.
- `src/host/nativeActions.ts` and `electron/main.ts` — existing renderer-to-host
  action and download/save-dialog boundaries.
- `e2e/server-ui-sandbox.spec.ts` and `scripts/run-e2e-container.sh` — existing
  sandbox assertions and the only supported Electron E2E route.

## Fixed architecture

Do not redesign these boundaries while implementing the task:

1. The exact project environment reads source files and resolves imports.
   Desktop renderer code never reads project files directly.
2. Add a server-core `mdxRuntime` feature beside `fileService`; do not put the
   compiler in `electron/` or `src/`.
3. Add a `MdxRuntimeClient` in `packages/client-core`. Desktop and web use this
   same application-protocol client.
4. Use Terminay-owned compiler options. Never load project Vite, Webpack, Babel,
   TypeScript, package-manager, or MDX configuration and never run package
   scripts.
5. Use a sandboxed browser frame with scripts enabled, Node integration off,
   and no preload bridge. Give each project its own browser storage partition.
   The preview must never share the parent application's origin. If persistent
   cookies/storage require `allow-same-origin`, serve the preview from a
   dedicated preview origin that is cross-origin to Terminay and scoped to the
   canonical project. Never combine `allow-scripts` and `allow-same-origin` on a
   document that shares Terminay's application origin.
6. Preview code receives compiled modules and project assets through a narrow
   read-only resource broker. It never receives a canonical host path or
   `file://` URL.
7. Networking and external assets use ordinary browser behaviour. Navigation,
   popups, Electron permissions, and ungoverned filesystem writes are blocked.
8. A renderer message is data, not authority. Validate the source frame,
   project/runtime id, message kind, and payload before acting.

## Protocol contract to add

Use these stable operation names unless an existing application-protocol naming
constraint requires a documented equivalent:

- `mdx.compile` — binary query. Input: `projectId`, project-relative entry path,
  and optional known revision. Output metadata identifies the runtime revision,
  entry module, bounded diagnostics, imported project resources, and whether
  the result is complete; the body carries compiled browser JavaScript.
- `mdx.resource` — binary query. Input: `projectId`, runtime revision, opaque
  resource id, offset, and length. Output is a bounded content range plus MIME
  type and total length. It never accepts a raw path from preview JavaScript.
- `mdx.dispose` — command. Releases compilation/resource state for one runtime
  id owned by the calling client.

Put shared limits and JSON-safe types in the established protocol/server/client
layers. Do not put source text or compiled bundles into an unbounded JSON
envelope. Every request carries authenticated project scope through dispatcher
context; a payload `projectId` alone grants nothing.

## Delivery milestones

Implement and verify these in order. Do not start the Documentation UI in this
task.

### 1. Compiler proof with no host execution

- Add the compiler dependencies deliberately. Prefer `esbuild` with the
  official MDX esbuild integration unless a repository constraint rules it
  out.
- Create a pure compiler service that accepts an entry path and a storage/path
  resolver supplied by the exact project environment.
- Resolve relative `.mdx`, `.md`, `.tsx`, `.ts`, `.jsx`, `.js`, JSON, CSS, and
  browser-compatible package imports. Re-resolve every imported file through
  the canonical project resolver before reading it.
- Reject Node built-ins, Electron, absolute paths, escaped symlinks, dependencies
  outside the canonical project root, unsupported dynamic imports, and missing
  files with typed diagnostics.
- Enforce named constants for maximum source bytes, output bytes, dependency
  count, depth, compile time, and concurrent compilations. Check cancellation
  before and after every storage read.
- Unit-test a small MDX entry importing `Components/Alert.tsx`; execute the
  resulting bundle only in a test browser/JS harness, never in server Node.

Milestone gate: server-core tests prove a valid React component graph compiles
and every path/config/Node escape listed above fails closed.

### 2. Application protocol and environment composition

- Add `mdxRuntime` source files, exports from `packages/server-core/src/index.ts`,
  adapter operations, authorization, lifecycle cleanup, and typed error mapping.
- Compose the service for both the standalone local project and extension-backed
  project environments. Follow `remoteFileProtocol.ts`; do not fall back to the
  Terminay Server filesystem for SSH/Puzed/extension projects.
- Add `MdxRuntimeClient`, response validation, range-contiguity validation,
  cancellation, and tests under `packages/client-core`.
- Construct the client in `src/shared/rendererServerClient.ts` and carry it in
  the existing shared server-client context used by Desktop and web.
- Dispose client-owned runtime state on disconnect, project/root replacement,
  explicit close, and server shutdown.

Milestone gate: a client-core/server-core integration test compiles and streams
the same fixture through the real dispatcher for local and non-local adapter
fixtures, and rejects a mismatched client/project/runtime id.

### 3. Sandboxed preview host

- Define a `PreviewHost` interface with Desktop and web implementations rather
  than branching throughout the editor. Desktop may use an isolated Electron
  browser context/partition; web uses a sandboxed iframe served from the
  dedicated preview origin. Both must pass the same capability tests.
- Add a host-neutral preview component/controller under `src/components` or
  `src/shared`; it accepts only compiled bytes/resource callbacks and never a
  filesystem path.
- Create a fresh sandboxed frame/runtime per preview. Enable scripts, but expose
  no Node integration, Electron globals, preload object, parent DOM, Terminay
  client, or application cookies/storage.
- Assign browser storage by canonical server/project identity so two projects
  cannot share cookies, cache, workers, or local storage. Provide lifecycle code
  to clear a project's preview data later. Establish the dedicated preview
  origin before enabling `allow-same-origin`; if the host cannot provide that
  origin, report preview capability unavailable instead of weakening isolation.
- Define a small versioned `postMessage` union: `ready`, `resize`, `diagnostic`,
  `open-document`, and `download`. Ignore all other messages and messages from
  the wrong source/runtime.
- Serve imported project assets by opaque resource id. External HTTP/HTTPS
  requests and assets remain ordinary browser requests subject to browser CORS,
  TLS, cookie, and mixed-content rules.
- Intercept top-level/frame navigation and native form navigation. Fragment
  changes stay inside the document. JavaScript submit handlers, including
  `preventDefault()` and network calls, continue to work.
- Block `window.open`, popups, permission prompts, and attempts to reach the
  embedding application. External links go through the existing external-link
  policy; project `.md`/`.mdx` links emit validated `open-document` messages.

Milestone gate: component/browser tests prove React execution, networking,
external assets, storage isolation, JS form submission, blocked navigation,
blocked popups, and absence of Electron/preload/parent authority.

### 4. Governed downloads and failure recovery

- Treat every browser download as a host request. On Desktop, use the existing
  main-process save-dialog boundary to ask for a destination before writing. On
  web, use an explicit user-governed browser download flow.
- Sanitize the suggested filename, never overwrite silently, bound metadata and
  transfer size, expose progress/failure, and make cancellation write nothing.
- Add compile timeout, resource timeout, crash, unresponsive-frame, and repeated
  restart states. Destroy the old runtime before restart; cap automatic retries.
- Ensure closing/replacing a runtime cancels outstanding compile/resource work,
  releases object URLs/listeners/timers, and leaves any future editor draft
  untouched.

Milestone gate: tests cover accepted/cancelled downloads, failed transfer
cleanup, compiler cancellation, a runtime crash, and a looping fixture without
blocking a sibling terminal interaction.

## Required tests and commands

Add focused tests rather than one oversized test file:

- `packages/server-core/test/mdx-compiler.test.mjs`
- `packages/server-core/test/mdx-protocol.test.mjs`
- `packages/server-core/test/mdx-hardening.test.mjs`
- `packages/client-core/test/mdx-runtime.test.mjs`
- renderer/controller tests near the new preview implementation
- `e2e/mdx-browser-runtime.spec.ts`

Run during development:

```sh
npm run test --workspace @terminay/client-core
npm run test --workspace @terminay/server-core
npm run lint
npm run build:app
```

Run Electron acceptance only through Docker:

```sh
npm run test:e2e -- e2e/mdx-browser-runtime.spec.ts
```

If the container runner does not accept a file argument, run `npm run test:e2e`
and document that fact. Never use `npm run test:e2e:host` for this task.

## Do not ship these shortcuts

- `dangerouslySetInnerHTML` in the Terminay renderer for executable MDX.
- `eval`, dynamic `import()`, or project component execution in server Node or
  Terminay's main renderer.
- `file://` paths, canonical host paths, or a general read-file API in preview.
- `nodeIntegration`, a preview preload, `allow-popups`, or parent same-origin
  access.
- Project build config/plugins, development servers, or package scripts.
- A Desktop-only IPC path that bypasses the application protocol and breaks web
  or remote project environments.
- Unbounded source, bundle, asset, message, retry, or download data.

## Definition of done

All four milestone gates pass. The focused package tests, lint, application
build, and Docker Electron E2E pass. The acceptance outcomes in the governing
feature spec are demonstrably covered, no prohibited shortcut remains, and this
file moves to `../tasks_completed/`.
