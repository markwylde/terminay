## Why

Project MDX with real React and TSX imports cannot be rendered today. Rendering
it needs a compiler that runs where the project files live and an execution
context that gives the rendered code ordinary browser capabilities while giving
it no Node, Electron, preload, Terminay, cross-project, or filesystem authority.

## What Changes

- Add an `mdxRuntime` feature to server-core that compiles a project MDX entry
  through the exact project environment's canonical path resolver, with
  Terminay-owned compiler options and no project build configuration.
- Add three application-protocol operations — `mdx.compile`, `mdx.resource`, and
  `mdx.dispose` — with bounded binary bodies and authenticated project scope
  taken from dispatcher context.
- Add an `MdxRuntimeClient` to client-core, constructed once in the shared
  renderer server client so Desktop and web use the same path.
- Add a host-neutral `PreviewHost` with Desktop and web implementations that pass
  the same capability tests, each creating a fresh sandboxed runtime per preview
  on a dedicated preview origin.
- Report preview capability unavailable when a host cannot provide a dedicated
  preview origin, rather than combining scripts and same-origin access on
  Terminay's application origin.
- Route every browser download through a host-governed save flow, and add
  compile, resource, crash, unresponsive-frame, and repeated-restart failure
  states.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mdx-browser-runtime`: adds the compile, resource, and dispose protocol
  operations, the authenticated project scope rule, the preview-origin
  prerequisite, and host-parity requirements for the preview host.

## Impact

- New `packages/server-core/src/mdxRuntime` feature, its exports, adapter
  operations, authorization, lifecycle cleanup, and typed error mapping.
- Extension-backed project environments compose the same service through the
  remote file protocol, with no fallback to the Terminay Server filesystem.
- New compiler dependency (`esbuild` with the official MDX integration unless a
  repository constraint rules it out).
- `packages/client-core` gains `MdxRuntimeClient`; `src/shared/rendererServerClient.ts`
  constructs it; the shared server-client context carries it.
- New preview host implementations and the existing Desktop save-dialog boundary.
- Task 62's Documentation editor consumes this runtime; this change delivers the
  execution runtime only.
