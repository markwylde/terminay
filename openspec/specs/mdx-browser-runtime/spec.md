# mdx-browser-runtime Specification

## Purpose

The MDX browser runtime renders executable MDX as a normal browser application inside a disposable, isolated browser runtime. It is a containment boundary rather than a trust prompt: MDX gains ordinary browser capabilities while receiving no Electron, Node, Terminay, terminal, secret, or unrestricted filesystem authority.

## Requirements

### Requirement: Uniform isolated execution policy

Every MDX document SHALL use the same isolated execution policy. Opening a document SHALL NOT ask the user to trust its folder. Executed MDX SHALL be able to import project React components, execute browser JavaScript, use browser-compatible packages, fetch network resources, render external assets, and provide interactive forms without receiving Electron, Node, Terminay, terminal, secret, or unrestricted filesystem authority.

#### Scenario: Opening any MDX document

- **WHEN** a user opens an executable MDX document
- **THEN** it runs under the standard isolated execution policy with no trust prompt for its folder

#### Scenario: Importing a project component

- **WHEN** an MDX document imports a project React component and a browser-compatible package
- **THEN** both render without a trust prompt

### Requirement: Compilation scope

The runtime SHALL compile MDX and the browser-compatible JavaScript, TypeScript, JSX, and TSX dependencies needed by that document.

#### Scenario: Mixed dependency languages

- **WHEN** an MDX document depends on JavaScript, TypeScript, JSX, and TSX files
- **THEN** the runtime compiles each browser-compatible dependency it needs

### Requirement: Relative import containment

Relative imports SHALL resolve from the importing file and SHALL remain within the exact canonical project root and environment. Escaped symlinks, absolute host paths, another project, and another environment SHALL be rejected.

#### Scenario: In-project relative import

- **WHEN** a document imports a relative path inside the canonical project root
- **THEN** the import resolves from the importing file

#### Scenario: Escaping the project root

- **WHEN** an import resolves through an escaped symlink, an absolute host path, another project, or another environment
- **THEN** the import is rejected

### Requirement: Package resolution limits

Browser-compatible package imports MAY resolve from the project's dependency tree when the resolved files remain within the server-authorized project scope. Node built-ins and packages that require Node or Electron authority SHALL fail with a bounded diagnostic.

#### Scenario: Browser-compatible package

- **WHEN** a document imports a browser-compatible package whose files stay within the server-authorized project scope
- **THEN** the import resolves

#### Scenario: Node built-in import

- **WHEN** a document imports a Node built-in or a package requiring Node or Electron authority
- **THEN** compilation fails with a bounded diagnostic

### Requirement: Terminay-controlled compiler

Compilation SHALL NOT load or execute project Vite, Webpack, Babel, TypeScript, or other build configuration, plugins, lifecycle scripts, or arbitrary host commands. Terminay SHALL control the compiler and its bounded options.

#### Scenario: Project build configuration present

- **WHEN** the project contains Vite, Webpack, Babel, or TypeScript configuration, plugins, or lifecycle scripts
- **THEN** compilation ignores them and uses Terminay's compiler with its bounded options

### Requirement: Authorized project resource identities

Imported styles and project assets SHALL use server-authorized project resource identities. The client SHALL NOT receive a raw host filesystem handle or gain a general `file://` origin.

#### Scenario: Importing a stylesheet or asset

- **WHEN** a document imports a project stylesheet or asset
- **THEN** it is served through a server-authorized project resource identity
- **AND** the client receives no raw host filesystem handle or general `file://` origin

### Requirement: Compilation bounds and diagnostics

Compilation SHALL enforce bounds for dependency count, traversal depth, source bytes, output bytes, elapsed time, and concurrency. A failure SHALL identify the importing document and a bounded diagnostic without exposing paths outside the project.

#### Scenario: Bound exceeded

- **WHEN** dependency count, traversal depth, source bytes, output bytes, elapsed time, or concurrency exceeds its bound
- **THEN** compilation fails with a bounded diagnostic naming the importing document
- **AND** no path outside the project is exposed

### Requirement: Watch-driven invalidation

A file or dependency watch revision SHALL invalidate the affected compilation and refresh the preview without reloading the Documentation editor.

#### Scenario: Dependency changes on disk

- **WHEN** a watched file or dependency revision changes
- **THEN** the affected compilation is invalidated and the preview refreshes
- **AND** the Documentation editor is not reloaded

### Requirement: Ordinary browser capabilities

Executed MDX SHALL have ordinary browser capabilities inside its isolated context: React components and JavaScript expressions execute; HTTP and HTTPS requests follow the browser's normal networking, TLS, CORS, cookie, and mixed-content rules; external images, fonts, stylesheets, media, and other browser assets may load under the browser's normal content rules; form controls and JavaScript submit handlers work, and a handler may prevent the default submission, update application state, or make network requests; and timers, workers, and other supported browser-only APIs may run within the same isolated authority and resource policy.

#### Scenario: Network and asset loading

- **WHEN** rendered components fetch HTTP or HTTPS resources or load external images, fonts, stylesheets, or media
- **THEN** the requests follow the browser's normal networking, TLS, CORS, cookie, and mixed-content rules

#### Scenario: JavaScript form handler

- **WHEN** a JavaScript submit handler runs
- **THEN** it may prevent the default submission, update application state, or make network requests and completes normally

#### Scenario: Timers and workers

- **WHEN** MDX code starts timers or workers
- **THEN** they run within the same isolated authority and resource policy

### Requirement: Per-project preview storage partition

Browser-compatible component storage and cookie APIs SHALL belong to an isolated per-project preview partition. They SHALL persist across document reloads and project sessions until the user clears that project's preview data. On hosts using the opaque iframe fallback, these APIs SHALL be a validated host broker, and their cookie values SHALL NOT attach to HTTP requests because the opaque frame has no browser network cookie jar. A dedicated preview origin MAY provide normal network-cookie attachment without exposing Terminay's origin.

#### Scenario: Storage persists per project

- **WHEN** a preview writes storage or cookie values and the document is reloaded or the project session restarts
- **THEN** the values persist in that project's preview partition until the user clears that project's preview data

#### Scenario: Opaque iframe fallback

- **WHEN** the host uses the opaque iframe fallback
- **THEN** storage and cookie APIs are served by a validated host broker and cookie values do not attach to HTTP requests

#### Scenario: Cross-project isolation

- **WHEN** a preview in one project reads its storage
- **THEN** it cannot read another project's preview partition or Terminay application storage

### Requirement: Withheld application authority

The runtime SHALL NOT expose Node integration, Electron APIs, a preload bridge, Terminay application APIs, terminal contents, environment secrets, host credentials, arbitrary filesystem access, or another project's browser partition.

#### Scenario: Attempted privileged access

- **WHEN** executed MDX attempts to reach Node integration, Electron APIs, a preload bridge, Terminay application APIs, terminal contents, environment secrets, host credentials, arbitrary filesystem access, or another project's browser partition
- **THEN** the access is rejected

### Requirement: Navigation, link, form, and popup governance

The preview document SHALL NOT replace or navigate its top-level runtime away from the compiled document. Native form submission that would navigate SHALL be intercepted and blocked while JavaScript form handlers still run normally. `window.open`, popup creation, and creation of an ungoverned browser window SHALL be blocked. A project-relative link to an `.md` or `.mdx` document SHALL ask the host to open that document in Documentation mode after the server revalidates its project scope. Other project-relative resources SHALL remain inside the preview resource broker. HTTP and HTTPS links SHALL use Terminay's normal external-link policy rather than navigating the preview or application. Fragment navigation within the current rendered document SHALL remain available.

#### Scenario: Top-level navigation attempt

- **WHEN** the preview attempts to replace or navigate its top-level runtime
- **THEN** the navigation is blocked

#### Scenario: Native form submission

- **WHEN** a native form submission would navigate
- **THEN** it is intercepted and blocked while the JavaScript submit handler still runs

#### Scenario: Popup attempt

- **WHEN** the preview calls `window.open` or otherwise creates a popup or ungoverned browser window
- **THEN** the creation is blocked

#### Scenario: Project document link

- **WHEN** a user follows a project-relative link to an `.md` or `.mdx` document
- **THEN** the host is asked to open it in Documentation mode after the server revalidates its project scope

#### Scenario: External link

- **WHEN** a user follows an HTTP or HTTPS link
- **THEN** Terminay's normal external-link policy applies and neither the preview nor the application navigates

#### Scenario: Fragment navigation

- **WHEN** a link targets a fragment within the current rendered document
- **THEN** the fragment navigation works

### Requirement: Governed downloads

Browser-initiated downloads SHALL be intercepted by the client host before bytes are written. Desktop SHALL ask the user whether and where to save each download, and Cancel SHALL write nothing; the chosen destination SHALL be a client-host concern and SHALL NOT be presented to the MDX runtime as filesystem authority. A web client SHALL use its browser's governed download flow while preserving the same explicit user-initiation requirement. Downloads SHALL have bounded metadata and transfer limits, SHALL expose progress and failure, and SHALL NOT silently overwrite a destination.

#### Scenario: Desktop download prompt

- **WHEN** a preview initiates a download on Desktop
- **THEN** the host asks whether and where to save it before any bytes are written

#### Scenario: Download cancelled

- **WHEN** the user cancels a download prompt
- **THEN** no file is written

#### Scenario: Destination not exposed to MDX

- **WHEN** a download completes
- **THEN** the chosen destination is not presented to the MDX runtime as filesystem authority

#### Scenario: Download limits and overwrite

- **WHEN** a download runs
- **THEN** bounded metadata and transfer limits apply, progress and failure are exposed, and no destination is silently overwritten

### Requirement: Sandboxed execution context

Executable previews SHALL run outside Terminay's main renderer context in a sandboxed browser context with Node integration disabled and no preload bridge. Each context SHALL use the exact project's isolated browser partition and SHALL NOT read Terminay application storage, another project partition, or ambient authenticated application state.

#### Scenario: Preview context creation

- **WHEN** a preview context is created
- **THEN** it runs outside the main renderer with Node integration disabled, no preload bridge, and the exact project's isolated browser partition

### Requirement: Narrow host message contract

The host SHALL validate a narrow message contract for preview readiness, intrinsic size, diagnostics, project-document navigation, and lifecycle. Arbitrary preview messages SHALL NOT invoke application commands. Navigation, popup, permission, protocol, and download requests SHALL be denied by default unless explicitly allowed as a host-mediated path by this specification.

#### Scenario: Unrecognised preview message

- **WHEN** the preview sends a message outside the validated contract
- **THEN** it is rejected and invokes no application command

#### Scenario: Default deny

- **WHEN** the preview issues a navigation, popup, permission, protocol, or download request that is not an explicitly allowed host-mediated path
- **THEN** the request is denied

### Requirement: Runtime lifecycle and teardown

Closing the last presentation, changing project identity or environment, losing authorization, or detecting a compromised protocol SHALL tear down the context. A hung, crashed, or resource-exhausted preview SHALL be destroyed independently of the editor and SHALL be restartable. It SHALL NOT stall terminal input or another project workspace.

#### Scenario: Authority or identity change

- **WHEN** the last presentation closes, project identity or environment changes, authorization is lost, or a compromised protocol is detected
- **THEN** the preview context is torn down

#### Scenario: Hung or crashed preview

- **WHEN** a preview hangs, crashes, or exhausts resources
- **THEN** it is destroyed independently of the Documentation editor and can be restarted
- **AND** terminal input and other project workspaces are unaffected

### Requirement: Server-side ownership and remote clients

Compilation, dependency resolution, project resource authorization, and watch invalidation SHALL run on the exact project's environment adapter under Terminay Server. The isolated browser runtime SHALL run on the presenting client host. Remote and web clients SHALL receive bounded compiled and resource streams through the application protocol and SHALL NOT connect directly to the project machine's filesystem. Browser networking SHALL originate from the presenting client runtime. Disconnect SHALL cancel transfers and destroy or suspend the preview without discarding an editor draft.

#### Scenario: Remote client preview

- **WHEN** a remote or web client previews an MDX document
- **THEN** it receives bounded compiled and resource streams through the application protocol without connecting to the project machine's filesystem

#### Scenario: Preview network origin

- **WHEN** rendered MDX makes a network request
- **THEN** the request originates from the presenting client runtime

#### Scenario: Client disconnects

- **WHEN** the presenting client disconnects
- **THEN** transfers are cancelled and the preview is destroyed or suspended without discarding an editor draft

### Requirement: Security and privacy expectations

Browser sandboxing SHALL contain application authority and SHALL NOT promise that executed MDX is private; MDX JavaScript MAY send document data available to it to network destinations, just as a normal webpage can. Project files SHALL become visible to executed code only when they are imported or requested through an authorized project resource reference, and directory enumeration SHALL NOT be an implicit browser capability. Browser credentials and storage used by previews SHALL be separate from Terminay's own sessions and from other projects. Clearing preview data SHALL remove the project's preview cookies, storage, cache, and workers without deleting project files.

#### Scenario: Directory enumeration attempt

- **WHEN** executed MDX attempts to enumerate a project directory
- **THEN** no implicit enumeration capability is available

#### Scenario: Clearing preview data

- **WHEN** a user clears a project's preview data
- **THEN** its preview cookies, storage, cache, and workers are removed and project files are untouched

#### Scenario: Data sent to the network

- **WHEN** executed MDX sends data it holds to a network destination
- **THEN** the sandbox does not prevent it, matching normal webpage behaviour

### Requirement: Preview failure behaviour

Syntax, unsupported import, escaped path, missing dependency, CORS, network, asset, compilation-limit, and runtime failures SHALL produce distinguishable, bounded diagnostics. A failed preview SHALL leave the document editor usable and SHALL NOT discard or save an unrelated draft. The user SHALL be able to restart a failed runtime, and repeated crashes SHALL NOT create an unbounded restart loop.

#### Scenario: Distinguishable diagnostics

- **WHEN** a preview fails
- **THEN** the diagnostic distinguishes syntax, unsupported import, escaped path, missing dependency, CORS, network, asset, compilation-limit, and runtime failures

#### Scenario: Editor unaffected by failure

- **WHEN** a preview fails
- **THEN** the document editor remains usable and no unrelated draft is discarded or saved

#### Scenario: Repeated crashes

- **WHEN** a runtime crashes repeatedly
- **THEN** the user can restart it and no unbounded restart loop occurs

### Requirement: MDX runtime non-goals

The runtime SHALL NOT reproduce an arbitrary project's existing build pipeline or development server, provide Node, Electron, shell, terminal, secret, or unrestricted host filesystem APIs to MDX, allow an MDX document to navigate Terminay or create ungoverned windows, or treat a browser sandbox as a confidentiality boundary against network requests intentionally made by the rendered code.

#### Scenario: Project dev server expectation

- **WHEN** a project has its own build pipeline or development server
- **THEN** the MDX runtime does not reproduce it

#### Scenario: Sandbox confidentiality expectation

- **WHEN** rendered code deliberately makes a network request
- **THEN** the sandbox is not treated as a confidentiality boundary against it

### Requirement: MDX runtime protocol operations

The runtime SHALL expose exactly three application-protocol operations. `mdx.compile` SHALL be a binary query taking a project identity, a project-relative entry path, and an optional known revision, whose metadata identifies the runtime revision, entry module, bounded diagnostics, imported project resources, and completeness, and whose body carries compiled browser JavaScript. `mdx.resource` SHALL be a binary query taking a project identity, runtime revision, opaque resource id, offset, and length, returning a bounded content range with its MIME type and total length, and SHALL NOT accept a raw path from preview JavaScript. `mdx.dispose` SHALL be a command releasing compilation and resource state for one runtime id owned by the calling client. Source text and compiled bundles SHALL NOT be carried in an unbounded JSON envelope.

#### Scenario: Compiling an entry document

- **WHEN** a client issues a compile query for a project-relative entry path
- **THEN** it receives metadata naming the runtime revision, entry module, bounded diagnostics, imported project resources, and completeness
- **AND** the body carries compiled browser JavaScript

#### Scenario: Requesting a project resource

- **WHEN** a client requests a resource range by opaque resource id, offset, and length
- **THEN** it receives a bounded content range with its MIME type and total length

#### Scenario: Raw path in a resource request

- **WHEN** preview JavaScript attempts to request a resource by filesystem path rather than opaque resource id
- **THEN** the request is rejected

#### Scenario: Disposing a runtime

- **WHEN** a client disposes a runtime id it owns
- **THEN** that runtime's compilation and resource state is released

### Requirement: Authenticated project scope for runtime operations

Every runtime operation SHALL derive its project scope from the authenticated dispatcher context. A project identity carried in a request payload SHALL grant no authority on its own, and a request whose client, project, or runtime id does not match the authenticated scope SHALL be rejected.

#### Scenario: Payload project identity alone

- **WHEN** a request carries a project identity in its payload that the authenticated dispatcher context does not grant
- **THEN** the request is rejected and no compilation or resource data is returned

#### Scenario: Mismatched runtime id

- **WHEN** a client references a runtime id owned by another client or project
- **THEN** the request is rejected

### Requirement: Preview origin prerequisite

A preview document SHALL NOT combine script execution with same-origin access to Terminay's application origin. Where persistent cookies and storage require same-origin access, the preview SHALL be served from a dedicated preview origin that is cross-origin to Terminay and scoped to the canonical project, and that origin SHALL be established before same-origin access is enabled. A host that cannot provide such an origin SHALL report the preview capability as unavailable rather than weakening isolation.

#### Scenario: Host cannot provide a preview origin

- **WHEN** the host cannot serve a dedicated cross-origin preview origin
- **THEN** the preview capability is reported unavailable
- **AND** script execution is not granted same-origin access to Terminay's application origin

#### Scenario: Preview origin established first

- **WHEN** persistent cookies and storage require same-origin access
- **THEN** the dedicated project-scoped preview origin is established before same-origin access is enabled

### Requirement: Host-neutral preview implementations

Preview hosting SHALL be one host-neutral interface with a Desktop and a web implementation, and both SHALL satisfy the same capability expectations for execution, networking, external assets, storage isolation, JavaScript form submission, blocked navigation, blocked popups, and absence of Electron, preload, and parent authority. The preview component SHALL accept only compiled bytes and resource callbacks and SHALL NOT accept a filesystem path.

#### Scenario: Same expectations on both hosts

- **WHEN** the same preview is exercised on the Desktop and web implementations
- **THEN** both satisfy the same execution, networking, asset, storage-isolation, form, navigation, popup, and withheld-authority expectations

#### Scenario: Path offered to the preview component

- **WHEN** a caller attempts to give the preview component a filesystem path instead of compiled bytes and resource callbacks
- **THEN** the interface does not accept it

