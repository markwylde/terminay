## Context

Proposal.md states the goal. The hard part is that MDX is genuinely executable
application code authored inside a project, so it must gain real browser
capabilities — React, networking, external assets, forms, storage — while gaining
none of Terminay's authority. Two boundaries already exist and are reused rather
than re-invented: the canonical project path resolver in the file service, which
is the only place project paths are validated, and the environment adapter, which
is how non-local projects reach their files.

## Goals / Non-Goals

Goals:

- Compile a project MDX entry with real relative and package imports, on the
  machine where the project files live.
- Execute the result in a disposable browser context with ordinary browser
  capability and no application authority.
- Behave identically for local, SSH, and other extension-backed environments, and
  for Desktop and web hosts.

Non-Goals:

- The Documentation tree, MDXEditor, document tabs, and autosave; those belong to
  the Documentation change that consumes this runtime.
- Supporting project build tooling, dev servers, or package scripts.
- Promising that executed MDX is private. Sandboxing contains authority, not
  data egress.

## Decisions

1. **The exact project environment reads source files and resolves imports.**
   Renderer code never reads project files directly, and there is no second,
   weaker path checker: every imported file is re-resolved through the canonical
   project resolver before it is read.
2. **The compiler lives in server-core, not in Electron or the renderer.** A new
   `mdxRuntime` feature sits beside the file service and is composed for both the
   standalone local project and extension-backed environments, following the
   remote file protocol. It never falls back to the Terminay Server filesystem
   for a non-local project.
3. **One typed client for both hosts.** `MdxRuntimeClient` in client-core with
   response, range-contiguity, and cancellation validation, constructed once in
   the shared renderer server client. There is no Desktop-only IPC path.
4. **Terminay-owned compiler options.** Project Vite, Webpack, Babel, TypeScript,
   package-manager, and MDX configuration are never loaded and package scripts
   are never run.
5. **Compiled output is executed only in a browser.** Unit tests execute the
   resulting bundle in a test browser or JavaScript harness, never in server Node.
6. **A narrow read-only resource broker.** Preview code receives compiled modules
   and project assets by opaque resource id with an offset and length; it never
   receives a canonical host path or a `file://` URL, and `mdx.resource` never
   accepts a raw path from preview JavaScript.
7. **A dedicated preview origin, or no preview.** `allow-scripts` and
   `allow-same-origin` are never combined on a document sharing Terminay's
   application origin. If persistent cookies and storage require same-origin
   access, the preview is served from a dedicated cross-origin preview origin
   scoped to the canonical project; a host that cannot provide one reports the
   preview capability unavailable rather than weakening isolation.
8. **Messages are data, not authority.** A small versioned `postMessage` union —
   `ready`, `resize`, `diagnostic`, `open-document`, `download` — is validated for
   source frame, project and runtime id, kind, and payload before anything acts
   on it. Everything else is ignored.
9. **Downloads are host requests.** Desktop uses the existing main-process
   save-dialog boundary; web uses an explicit user-governed download. Filenames
   are sanitized, nothing is silently overwritten, and cancellation writes
   nothing.

## Risks / Trade-offs

- A dedicated preview origin is real deployment surface. The alternative — an
  opaque frame without same-origin access — loses network cookie attachment, so
  the specification accepts a broker-backed storage fallback and states the
  difference rather than pretending the two are equivalent.
- Adding a compiler dependency enlarges the server's supply-chain surface. It is
  taken deliberately, pinned, and driven only by Terminay-owned options.
- Bounded compilation can produce partial results for large documents. Bounds for
  source bytes, output bytes, dependency count, depth, elapsed time, and
  concurrency are named constants with explicit diagnostics so a bound is
  distinguishable from a defect.
- Executed MDX can send whatever data it holds to the network, exactly as a normal
  webpage can. The contract is containment of authority, not confidentiality.

## Open Questions

- Whether Desktop's isolated browser context or a dedicated preview origin served
  from the server is the better Desktop implementation is left to the preview-host
  work; both must pass the same capability tests before either is chosen.
