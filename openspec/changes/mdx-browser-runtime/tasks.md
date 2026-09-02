## 1. Compiler proof with no host execution

- [ ] 1.1 Add the compiler dependencies deliberately, preferring esbuild with the official MDX integration, and verify the choice against repository constraints
- [ ] 1.2 Create a pure compiler service accepting an entry path and a storage and path resolver supplied by the exact project environment, verified by unit tests with a fake resolver
- [ ] 1.3 Resolve relative `.mdx`, `.md`, `.tsx`, `.ts`, `.jsx`, `.js`, JSON, CSS, and browser-compatible package imports, re-resolving every imported file through the canonical project resolver before reading it, verified per import kind
- [ ] 1.4 Reject Node built-ins, Electron, absolute paths, escaped symlinks, dependencies outside the canonical project root, unsupported dynamic imports, and missing files with typed diagnostics, verified by a fail-closed test per case
- [ ] 1.5 Enforce named constants for maximum source bytes, output bytes, dependency count, depth, compile time, and concurrent compilations, and check cancellation before and after every storage read, verified by bound and cancellation tests
- [ ] 1.6 Unit-test a small MDX entry importing `Components/Alert.tsx`, executing the resulting bundle only in a test browser or JavaScript harness and never in server Node

## 2. Application protocol and environment composition

- [ ] 2.1 Add the `mdxRuntime` source files, server-core exports, adapter operations, authorization, lifecycle cleanup, and typed error mapping, verified by protocol tests
- [ ] 2.2 Register `mdx.compile`, `mdx.resource`, and `mdx.dispose` with bounded binary bodies and authenticated project scope from dispatcher context, verified by a test proving a payload `projectId` alone grants nothing
- [ ] 2.3 Compose the service for the standalone local project and for extension-backed environments following the remote file protocol, verified by an adapter-parity test that proves no fallback to the Terminay Server filesystem
- [ ] 2.4 Add `MdxRuntimeClient` with response validation, range-contiguity validation, cancellation, and tests in client-core
- [ ] 2.5 Construct the client in the shared renderer server client and carry it in the shared server-client context used by Desktop and web, verified by a construction test
- [ ] 2.6 Dispose client-owned runtime state on disconnect, project or root replacement, explicit close, and server shutdown, verified per trigger
- [ ] 2.7 Integration-test compiling and streaming one fixture through the real dispatcher for local and non-local adapter fixtures, and rejecting a mismatched client, project, or runtime id

## 3. Sandboxed preview host

- [ ] 3.1 Define a `PreviewHost` interface with Desktop and web implementations and verify both pass the same capability test suite
- [ ] 3.2 Add a host-neutral preview component and controller that accept only compiled bytes and resource callbacks, verified by a test asserting no filesystem path crosses the interface
- [ ] 3.3 Create a fresh sandboxed runtime per preview with scripts enabled and no Node integration, Electron globals, preload object, parent DOM, Terminay client, or application cookies and storage, verified by absence assertions
- [ ] 3.4 Assign browser storage by canonical server and project identity and provide lifecycle code to clear a project's preview data, verified by a cross-project isolation test
- [ ] 3.5 Establish the dedicated preview origin before enabling same-origin access and report preview capability unavailable when the host cannot provide it, verified by a host-without-origin test
- [ ] 3.6 Implement the versioned `ready`, `resize`, `diagnostic`, `open-document`, and `download` message union, ignoring all other messages and messages from the wrong source or runtime, verified by rejection tests
- [ ] 3.7 Serve imported project assets by opaque resource id while external HTTP and HTTPS requests stay ordinary browser requests, verified by network and asset tests
- [ ] 3.8 Intercept top-level, frame, and native form navigation while keeping fragment changes and JavaScript submit handlers working, verified by navigation and form tests
- [ ] 3.9 Block `window.open`, popups, permission prompts, and attempts to reach the embedding application, and route external links through the existing policy while project document links emit validated `open-document` messages, verified per case

## 4. Governed downloads and failure recovery

- [ ] 4.1 Treat every browser download as a host request using the Desktop main-process save dialog or an explicit user-governed web download, verified by accepted and cancelled download tests
- [ ] 4.2 Sanitize suggested filenames, never overwrite silently, bound metadata and transfer size, expose progress and failure, and write nothing on cancellation, verified per rule
- [ ] 4.3 Add compile timeout, resource timeout, crash, unresponsive-frame, and repeated-restart states, destroying the old runtime before restart and capping automatic retries, verified by a crash and restart test
- [ ] 4.4 Ensure closing or replacing a runtime cancels outstanding compile and resource work and releases object URLs, listeners, and timers, verified by a leak assertion
- [ ] 4.5 Verify a looping fixture does not block a sibling terminal interaction

## 5. Acceptance

- [ ] 5.1 Add the focused server-core compiler, protocol, and hardening tests and the client-core runtime test
- [ ] 5.2 Add renderer and controller tests beside the preview implementation
- [ ] 5.3 Run lint and the application build clean
- [ ] 5.4 Run the MDX browser runtime Electron acceptance through the Docker container runner only, documenting the fact if the runner does not accept a file argument
