# MDX browser runtime

## Summary

Terminay renders executable MDX as a normal browser application inside a
disposable, isolated browser runtime. MDX may import project React components,
execute browser JavaScript, use browser-compatible packages, fetch network
resources, render external assets, and provide interactive forms without
receiving Electron, Node, Terminay, terminal, secret, or unrestricted
filesystem authority.

The runtime is a containment boundary, not a trust prompt. Every MDX document
uses the same isolated execution policy, so opening a document never asks the
user to trust its folder.

## Compilation and project resources

- The runtime compiles MDX and browser-compatible JavaScript, TypeScript, JSX,
  and TSX dependencies needed by that document.
- Relative imports resolve from the importing file and remain within the exact
  canonical project root and environment. Escaped symlinks, absolute host
  paths, another project, and another environment are rejected.
- Browser-compatible package imports may resolve from the project's dependency
  tree when the resolved files remain within the server-authorized project
  scope. Node built-ins and packages that require Node or Electron authority
  fail with a bounded diagnostic.
- Compilation does not load or execute project Vite, Webpack, Babel, TypeScript,
  or other build configuration, plugins, lifecycle scripts, or arbitrary host
  commands. Terminay controls the compiler and its bounded options.
- Imported styles and project assets use server-authorized project resource
  identities. The client never receives a raw host filesystem handle or gains
  a general `file://` origin.
- Compilation enforces bounds for dependency count, traversal depth, source
  bytes, output bytes, elapsed time, and concurrency. A failure identifies the
  importing document and bounded diagnostic without exposing paths outside the
  project.
- A file or dependency watch revision invalidates the affected compilation and
  refreshes the preview without reloading the Documentation editor.

## Browser capabilities

Executed MDX has ordinary browser capabilities inside its isolated context:

- React components and JavaScript expressions execute.
- HTTP and HTTPS requests follow the browser's normal networking, TLS, CORS,
  cookie, and mixed-content rules.
- External images, fonts, stylesheets, media, and other browser assets may
  load under the browser's normal content rules.
- Form controls and JavaScript submit handlers work. A handler may prevent the
  default submission, update application state, or make network requests.
- Browser-compatible component storage and cookie APIs belong to an isolated
  per-project preview partition. They persist across document reloads and
  project sessions until the user clears that project's preview data. On hosts
  using the opaque iframe fallback, these APIs are a validated host broker;
  their cookie values intentionally do not attach to HTTP requests because the
  opaque frame has no browser network cookie jar. A dedicated preview origin
  may provide normal network-cookie attachment without exposing Terminay's
  origin.
- Timers, workers, and other supported browser-only APIs may run within the
  same isolated authority and resource policy.

The runtime does not expose Node integration, Electron APIs, a preload bridge,
Terminay application APIs, terminal contents, environment secrets, host
credentials, arbitrary filesystem access, or another project's browser
partition.

## Navigation, links, forms, and popups

- The preview document cannot replace or navigate its top-level runtime away
  from the compiled document.
- Native form submission that would navigate is intercepted and blocked.
  JavaScript form handlers still run normally.
- `window.open`, popup creation, and creation of an ungoverned browser window
  are blocked.
- A project-relative link to an `.md` or `.mdx` document asks the host to open
  that document in Documentation mode after the server revalidates its project
  scope.
- Other project-relative resources remain inside the preview resource broker.
- HTTP and HTTPS links use Terminay's normal external-link policy rather than
  navigating the preview or application.
- Fragment navigation within the current rendered document remains available.

## Downloads

- Browser-initiated downloads are intercepted by the client host before bytes
  are written.
- Desktop asks the user whether and where to save each download. Cancel writes
  nothing. The chosen destination is a client-host concern and is never
  presented to the MDX runtime as filesystem authority.
- A web client uses its browser's governed download flow while preserving the
  same explicit user initiation requirement.
- Downloads have bounded metadata and transfer limits, expose progress and
  failure, and never silently overwrite a destination.

## Isolation and lifecycle

- Executable previews run outside Terminay's main renderer context in a
  sandboxed browser context with Node integration disabled and no preload
  bridge.
- Each context uses the exact project's isolated browser partition. It cannot
  read Terminay application storage, another project partition, or ambient
  authenticated application state.
- The host validates a narrow message contract for preview readiness, intrinsic
  size, diagnostics, project-document navigation, and lifecycle. Arbitrary
  preview messages cannot invoke application commands.
- Navigation, popup, permission, protocol, and download requests are denied by
  default unless this specification explicitly allows the host-mediated path.
- Closing the last presentation, changing project identity or environment,
  losing authorization, or detecting a compromised protocol tears down the
  context.
- A hung, crashed, or resource-exhausted preview is destroyed independently of
  the editor and can be restarted. It cannot stall terminal input or another
  project workspace.

## Ownership and remote clients

Compilation, dependency resolution, project resource authorization, and watch
invalidation run on the exact project's environment adapter under Terminay
Server. The isolated browser runtime runs on the presenting client host.

Remote and web clients receive bounded compiled/resource streams through the
application protocol; they never connect directly to the project machine's
filesystem. Browser networking originates from the presenting client runtime,
like a webpage opened on that client. Disconnect cancels transfers and destroys
or suspends the preview without discarding an editor draft.

## Security and privacy

- Browser sandboxing contains application authority; it does not promise that
  executed MDX is private. MDX JavaScript may send document data available to
  it to network destinations, just as a normal webpage can.
- Project files become visible to executed code only when they are imported or
  requested through an authorized project resource reference. Directory
  enumeration is not an implicit browser capability.
- Browser credentials and storage used by previews are separate from
  Terminay's own sessions and from other projects.
- Clearing preview data removes the project's preview cookies, storage, cache,
  and workers without deleting project files.

## Failure behaviour

- Syntax, unsupported import, escaped path, missing dependency, CORS, network,
  asset, compilation-limit, and runtime failures produce distinguishable,
  bounded diagnostics.
- A failed preview leaves the document editor usable and does not discard or
  save an unrelated draft.
- The user can restart a failed runtime. Repeated crashes do not create an
  unbounded restart loop.

## Non-goals

- Reproducing an arbitrary project's existing build pipeline or development
  server.
- Providing Node, Electron, shell, terminal, secret, or unrestricted host
  filesystem APIs to MDX.
- Allowing an MDX document to navigate Terminay or create ungoverned windows.
- Treating a browser sandbox as a confidentiality boundary against network
  requests intentionally made by the rendered code.

## Acceptance outcomes

- An MDX document can import and render a project `Alert.tsx` component and a
  browser-compatible package without a trust prompt.
- Rendered components can fetch HTTP/HTTPS resources, load external assets,
  and run JavaScript form handlers under normal browser rules.
- Top-level navigation, popup creation, Node/Electron access, preload access,
  cross-project reads, and project-root escapes are rejected.
- A native form navigation is blocked while its JavaScript submit handler can
  prevent default and complete normally.
- Every download requires a user-governed destination and cancellation writes
  no file.
- Preview cookies and storage persist for the same project but are unavailable
  to Terminay, other projects, and other preview partitions.
- A hanging or crashing preview can be destroyed without interrupting the
  Documentation editor, terminals, or another project.
