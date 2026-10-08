# file-viewer Specification

## Purpose

Terminay opens project files into dockable file panels that share one server-owned draft, conflict, and watch lifecycle across Preview, Text, HEX, and Diff modes, with the server owning file identity, reads, saves, and Git diff generation.

## Requirements

### Requirement: Server-owned file authority

Terminay Server SHALL own file identity, metadata, reads, saves, watches, preview sources, draft coordination, and Git diff generation. Clients SHALL render the appropriate responsive viewer through the application protocol and SHALL NOT access the filesystem directly.

#### Scenario: Client renders through the protocol

- **WHEN** any Terminay client displays file content
- **THEN** it obtains identity, metadata, content ranges, and diffs from the server through the application protocol
- **AND** it performs no direct filesystem access of its own

#### Scenario: Local and remote clients share one contract

- **WHEN** a local desktop client and a remote browser client open the same file
- **THEN** both use the same server file contract

### Requirement: Environment-scoped file identity

The server SHALL route file identity and storage through the canonical project's environment. A file session SHALL remain bound to that environment, root, and revision. Identical path text on another machine SHALL be a different authority, and files with the same path text on different servers or project scopes SHALL NOT be the same identity.

#### Scenario: Same path text on a different environment

- **WHEN** a path with identical text exists under a different environment, server, or project scope
- **THEN** it resolves to a distinct file identity and session

#### Scenario: Cross-environment panel movement

- **WHEN** a client attempts to move a file panel across an environment boundary
- **THEN** the request is rejected

#### Scenario: Unavailable environment capability

- **WHEN** the exact environment cannot provide watch or Git capability
- **THEN** that capability degrades explicitly
- **AND** the operation never falls back to the Terminay Server filesystem

### Requirement: Opening files and folders

Double-clicking a file SHALL open it and double-clicking a directory SHALL expand or collapse it. Opening the same canonical path in the same project SHALL focus the existing panel rather than create a duplicate.

#### Scenario: Double-click a file

- **WHEN** a user double-clicks a file in the project explorer
- **THEN** a file panel opens for that canonical project path

#### Scenario: Double-click a directory

- **WHEN** a user double-clicks a directory
- **THEN** the directory expands or collapses

#### Scenario: Re-opening an already open file

- **WHEN** a user opens a canonical path that already has a panel in the same project
- **THEN** the existing panel is focused and no duplicate panel is created

### Requirement: Presentation selection for Markdown and MDX

The presentation of a Markdown (`.md`) or MDX (`.mdx`) file panel SHALL be chosen by the file type and the requested mode, never by which surface made the request. Every request SHALL either name a presentation, name a File Viewer mode, or name neither. A request that names a presentation SHALL use it. A request that names a File Viewer mode (Preview, Tasks, Text, HEX, or Diff) SHALL use the File Viewer presentation in that mode. When a new panel is opened by a request that names neither, a Markdown or MDX file SHALL use the Documentation presentation and any other file SHALL use the File Viewer presentation. When a request that names neither targets a file that already has a panel, the panel SHALL be focused and keep its current presentation. Both presentations SHALL share one canonical panel, file session, and draft; they SHALL NOT create competing file sessions or drafts.

#### Scenario: Opened from Documentation

- **WHEN** a user opens a Markdown or MDX file from the Documentation surface
- **THEN** the canonical panel uses the Documentation presentation with the same file session and draft lifecycle

#### Scenario: Opened from Explorer

- **WHEN** a user opens a Markdown or MDX file that has no panel from Explorer
- **THEN** a panel opens in the Documentation presentation

#### Scenario: Opened from a Folder tab or by drag

- **WHEN** a user opens a Markdown or MDX file that has no panel from a Folder tab, or drags it onto the tab area
- **THEN** a panel opens in the Documentation presentation

#### Scenario: Opened from a Markdown preview link

- **WHEN** a user follows a project-relative link to a Markdown or MDX file from a rendered Markdown preview
- **THEN** the linked file opens in the Documentation presentation

#### Scenario: Non-Markdown file from Explorer

- **WHEN** a user opens a file that is neither Markdown nor MDX from Explorer
- **THEN** a panel opens in the File Viewer presentation

#### Scenario: A File Viewer mode is requested

- **WHEN** a Markdown or MDX file is opened with a requested File Viewer mode, such as Diff from Git changes, Text from go-to-definition, or Tasks from a task card
- **THEN** the canonical panel uses the File Viewer presentation in that mode
- **AND** no second file session or draft is created

#### Scenario: Reopening a panel without a requested mode

- **WHEN** a Markdown file already open in the File Viewer presentation is opened again from Explorer
- **THEN** the existing panel is focused and stays in the File Viewer presentation

### Requirement: Panel workspace operations

File panels SHALL support close, focus, split, drag, reorder, and movement between server-owned workspace views. Desktop SHALL present view movement through native windows and web clients SHALL present it in-page. Panel movement SHALL preserve file identity, view mode, draft, dirty state, conflict state, and watch subscription.

#### Scenario: Moving a panel between workspace views

- **WHEN** a user moves a file panel to another server-owned workspace view
- **THEN** file identity, view mode, draft, dirty state, conflict state, and watch subscription are preserved

#### Scenario: Presenting view movement per host

- **WHEN** a desktop client moves a panel between views
- **THEN** the movement is presented through native windows
- **AND** a web client presents the same movement in-page

### Requirement: Path validation against project scope

The server SHALL validate the path against the exact project and the final canonical filesystem scope before performing any file operation.

#### Scenario: Path outside the project scope

- **WHEN** a client requests a path that resolves outside the exact project's canonical scope
- **THEN** the request is rejected

### Requirement: View modes

The file viewer SHALL provide Preview, Text, HEX, and Diff modes, and Tasks for Markdown. Text and HEX SHALL be editable; Preview, Tasks, and Diff SHALL be read-only. Switching modes SHALL NOT discard a draft. When a requested mode is unavailable, Terminay SHALL show the file's default view, SHALL keep the view switcher visible, and SHALL explain why the requested mode is unavailable.

#### Scenario: Default mode

- **WHEN** a file panel opens without a requested view
- **THEN** the selected mode is the default view for the file's type

#### Scenario: Switching modes with unsaved edits

- **WHEN** a user switches between Preview, Text, HEX, and Diff while a draft exists
- **THEN** the draft is retained

#### Scenario: Requested mode unavailable

- **WHEN** a requested mode is unavailable for the file
- **THEN** Terminay shows the file's default view, keeps the view switcher visible, and explains why the requested mode is unavailable

#### Scenario: Diff requested for a text file with nothing to compare

- **WHEN** a text file is opened for its diff and no diff is available
- **THEN** the file opens in Text
- **AND** HEX is not shown

#### Scenario: Read-only modes

- **WHEN** a user attempts to edit in Preview or Diff
- **THEN** the mode accepts no edits

### Requirement: Published capability detection

The server SHALL publish normalized capabilities derived from path, metadata, bounded content inspection, project scope, and Git state, covering text-like or binary-like classification, safe preview type, Monaco suitability, HEX availability, Diff availability, large-file status, and preferred fallback mode. The client SHALL NOT infer extra filesystem authority from a filename extension.

#### Scenario: Capabilities published for a file

- **WHEN** a file panel resolves its capabilities
- **THEN** the server supplies the normalized text/binary classification, safe preview type, Monaco suitability, HEX availability, Diff availability, large-file status, and preferred fallback mode

#### Scenario: Unsupported or unsafe preview

- **WHEN** Preview is unsupported or unsafe for the file
- **THEN** the panel falls back to Text or HEX

### Requirement: Bounded capability snapshot

Before opening content, the server MAY publish a bounded capability snapshot for the canonical file containing normalized type, size, binary classification, Preview/Text/HEX availability, large-file status, and preferred fallback mode. The snapshot SHALL never include file bytes, and prefix inspection SHALL be bounded and cancellation-aware.

#### Scenario: Snapshot excludes bytes

- **WHEN** the server publishes a capability snapshot
- **THEN** the response contains classification and availability fields only and contains no file bytes

#### Scenario: Cancelled prefix inspection

- **WHEN** a capability request is cancelled during bounded prefix inspection
- **THEN** the inspection stops and no result is published

### Requirement: Bounded content surface

The content surface SHALL return only project-relative range records. Text and HEX reads SHALL carry bounded byte offsets and total size; Markdown, image, and PDF previews SHALL be capped asset reads. Concurrent reads SHALL be limited per server, cancellation SHALL be checked before and after storage access, and the response SHALL carry the server-authorized decoded-image pixel cap for the client renderer.

#### Scenario: Ranged text read

- **WHEN** a client reads a text range
- **THEN** the response carries bounded byte offsets and the file's total size

#### Scenario: Concurrent read limit

- **WHEN** concurrent content reads exceed the per-server limit
- **THEN** the excess reads are bounded rather than admitted

#### Scenario: Image pixel cap

- **WHEN** a client receives an image preview source
- **THEN** the response carries the server-authorized decoded-image pixel cap

### Requirement: Resumable ranged transfer

Ranged content transfer SHALL be resumable by acknowledged byte offset. Cancellation SHALL NOT advance that offset, and a retry MAY request the same bounded chunk. When a file watch cursor is too old and the server returns `resyncRequired`, the client SHALL discard stale transfer assumptions and restart from offset zero against a fresh bounded snapshot.

#### Scenario: Cancelled chunk retried

- **WHEN** a ranged transfer is cancelled mid-chunk
- **THEN** the acknowledged offset does not advance
- **AND** a retry may request the same bounded chunk

#### Scenario: Resync required

- **WHEN** the server returns `resyncRequired` for an over-old watch cursor
- **THEN** the client discards stale transfer assumptions and restarts from offset zero against a fresh bounded snapshot

### Requirement: File adapter identity binding

The protocol-facing file adapter SHALL bind file operations to one authenticated server, project, and session identity. `files.open` SHALL canonicalize a project-relative path and reuse the existing session for that canonical project path. `files.metadata`, `files.read-range`, and `files.read-text` SHALL revalidate the canonical path before reading. `files.edit`, `files.save`, `files.reload`, `files.keep-local`, and `files.close` SHALL require write scope plus ordered draft and disk revisions. A mismatched server, project, session, or canonical replacement SHALL be rejected at the adapter boundary.

#### Scenario: Opening reuses the canonical session

- **WHEN** `files.open` is called for a project-relative path
- **THEN** the path is canonicalized and the existing session for that canonical project path is reused

#### Scenario: Mismatched identity

- **WHEN** a call names a different server, project, session, or a canonical replacement
- **THEN** the adapter rejects it

#### Scenario: Write call without ordered revisions

- **WHEN** `files.edit`, `files.save`, `files.reload`, `files.keep-local`, or `files.close` is called without write scope or without ordered draft and disk revisions
- **THEN** the call is rejected

### Requirement: Adapter bounds and authorization claims

Range reads SHALL be bounded by the session limit, edit bytes SHALL be bounded by the draft limit, and JSON range responses SHALL carry bounded base64 bytes rather than exposing host filesystem handles. Read and write session calls SHALL require the authenticated project claim; an administrative host identity MAY explicitly select a project, and a project id supplied only in an untrusted payload SHALL never grant access.

#### Scenario: Oversized range request

- **WHEN** a range read exceeds the session limit
- **THEN** the response is bounded to that limit

#### Scenario: Project id from an untrusted payload

- **WHEN** a request supplies a project id only in its payload without an authenticated project claim
- **THEN** access is not granted

### Requirement: Canonical path resolution fails closed

Canonical file operations SHALL fail closed when a project root disappears. The resolver SHALL re-check the final real path so symlink escapes and case aliases cannot cross the project boundary. Catalog traversal SHALL apply bounded name-based ignore patterns before descending into a directory.

#### Scenario: Project root disappears

- **WHEN** a project root is no longer present at operation time
- **THEN** the file operation fails closed

#### Scenario: Symlink escape attempt

- **WHEN** a path resolves through a symlink or case alias to a real path outside the project
- **THEN** the resolver rejects it at the final path check

### Requirement: Atomic save on disk

Save SHALL declare the expected disk revision and write atomically using a temporary file plus replace. A failed write SHALL leave both the disk bytes and the retained draft unchanged.

#### Scenario: Successful atomic save

- **WHEN** a save with the expected disk revision succeeds
- **THEN** the target is replaced only after the bounded write succeeds

#### Scenario: Failed write

- **WHEN** the bounded write fails
- **THEN** the disk bytes and the retained draft are unchanged

### Requirement: Preview mode content types

Preview SHALL support Markdown, images, PDF, and HTML. Markdown links and relative assets SHALL resolve relative to the file's folder but SHALL remain within the server-authorized content path. Credential-free HTTP and HTTPS links SHALL open through the normal external-link policy. Raw HTML and active content in Markdown SHALL be sanitized. Images SHALL use bounded decoded dimensions and fit controls, and PDF pages SHALL render lazily. HTML SHALL render as a web page in a sandboxed webview.

#### Scenario: Relative Markdown asset

- **WHEN** a Markdown preview references a relative asset
- **THEN** it resolves relative to the file's folder and stays within the server-authorized content path

#### Scenario: Raw HTML in Markdown

- **WHEN** previewed Markdown contains raw HTML or active content
- **THEN** the content is sanitized before rendering

#### Scenario: External link in Markdown

- **WHEN** a user activates a credential-free HTTP or HTTPS link in a preview
- **THEN** it opens through the normal external-link policy

#### Scenario: Content too large for full preview

- **WHEN** content is too large or unsafe for a full preview
- **THEN** the panel uses an incremental path or falls back explicitly

#### Scenario: HTML file in Preview

- **WHEN** a user selects Preview on an HTML file
- **THEN** the page renders in a sandboxed webview

### Requirement: Text mode engines

Text mode SHALL provide a Monaco engine for normal files and an explicitly selected rich large-file path, and a Performant engine for ranged, virtualized access. Monaco SHALL provide language detection, syntax highlighting, and standard editing for a complete bounded text model through language tokenizers. No language service SHALL run in the client: the editor SHALL compute no diagnostics, completions, hovers, signature help, or semantic analysis.

#### Scenario: Normal file in Text mode

- **WHEN** a normal-sized file opens in Text mode
- **THEN** Monaco provides language detection, syntax highlighting, and standard editing over a complete bounded text model

#### Scenario: Source file with project-level references

- **WHEN** a source file that references other files, packages, or compiler configuration opens in Text mode
- **THEN** it is tokenized and highlighted
- **AND** the client computes no diagnostics, completions, hovers, signature help, or semantic analysis for it

### Requirement: Performant text engine behaviour

The Performant engine SHALL read text in ranges, render visible lines plus bounded overscan, support selection, cursor movement, editing, scrolling, and line numbers, SHALL NOT create one in-memory string for a multi-gigabyte file, and SHALL read and write through the shared draft model.

#### Scenario: Multi-gigabyte file

- **WHEN** a multi-gigabyte file is opened in Performant text mode
- **THEN** it is read in ranges with visible lines plus bounded overscan and no single in-memory string for the whole file

#### Scenario: Editing in Performant mode

- **WHEN** a user edits in Performant text mode
- **THEN** the edit reads and writes through the shared draft model

### Requirement: Encoding handling in ranged text

Incremental decoding SHALL preserve character boundaries between ranges and SHALL report invalid encoding without corrupting the file. Bounded text ranges SHALL return an `invalidEncoding` marker with replacement text for malformed UTF-8. Binary files SHALL remain available through HEX ranges and SHALL NOT be silently coerced into text. Large text SHALL still report its total size while only the requested range is transferred.

#### Scenario: Malformed UTF-8 in a range

- **WHEN** a bounded text range contains malformed UTF-8
- **THEN** the response carries an `invalidEncoding` marker with replacement text and the file is not corrupted

#### Scenario: Character split across ranges

- **WHEN** a multi-byte character spans a range boundary
- **THEN** incremental decoding preserves the character boundary

#### Scenario: Binary file requested as text

- **WHEN** a binary file is read
- **THEN** it remains available through HEX ranges and is not silently coerced into text

### Requirement: HEX mode

HEX mode SHALL be a virtualized byte editor providing offsets, configurable bytes per row, hexadecimal and ASCII columns, selection and byte editing, ranged reads, and the shared draft and dirty state. It SHALL render visible rows plus bounded overscan rather than one DOM node per byte, and SHALL be the preferred fallback for binary data that cannot be previewed safely.

#### Scenario: Editing bytes

- **WHEN** a user edits a byte in HEX mode
- **THEN** the change is applied to the shared draft and the panel becomes dirty

#### Scenario: Binary fallback

- **WHEN** binary data cannot be previewed safely
- **THEN** HEX is the preferred fallback mode

#### Scenario: Large binary rendering

- **WHEN** a large binary file is displayed in HEX mode
- **THEN** only visible rows plus bounded overscan are rendered

### Requirement: Diff mode

Diff mode SHALL be a read-only, lazy, virtualized HTML viewer supporting unified and side-by-side layouts. The default layout SHALL be a server preference shared across clients; changing it SHALL update later Diff panels as well as the current panel where practical.

#### Scenario: Changing the default layout

- **WHEN** a user changes the Diff layout preference
- **THEN** the server preference is updated for later Diff panels and, where practical, the current panel

#### Scenario: Diff is read-only

- **WHEN** a file is displayed in Diff mode
- **THEN** the viewer accepts no edits

### Requirement: Server-generated diff contract

The server SHALL determine repository membership, obtain the working tree versus `HEAD` diff, normalize hunks into bounded structured rows, and report missing Git, non-repository, binary, too-large, and no-diff states. Clients SHALL NOT receive raw Git command output as the rendering contract.

#### Scenario: File in a repository

- **WHEN** a tracked file is opened in Diff mode
- **THEN** the server returns the working tree versus `HEAD` diff normalized into bounded structured rows

#### Scenario: Diff unavailable states

- **WHEN** Git is missing, the file is outside a repository, the content is binary, the diff is too large, or there is no diff
- **THEN** the server reports that distinct state

#### Scenario: Too-large Git diff

- **WHEN** a bounded Git diff exceeds its limit
- **THEN** the server reports its explicit too-large state rather than disabling Diff mode

### Requirement: Large-file engine choice

Files larger than 100 MB SHALL be treated as large. When a Monaco-backed path is relevant, Terminay SHALL ask on each open whether to use Performant or Monaco. The choice SHALL be scoped to that open panel and SHALL NOT be remembered globally. Performant SHALL use ranged reads and virtualization, Monaco SHALL load a complete bounded model after the user chooses it, and a user SHALL be able to switch from Performant to Monaco from inside the panel.

#### Scenario: Opening a large file

- **WHEN** a user opens a file larger than 100 MB where a Monaco-backed path is relevant
- **THEN** Terminay asks whether to use Performant or Monaco

#### Scenario: Choice is not remembered

- **WHEN** the user opens the same large file again
- **THEN** Terminay asks again rather than reusing a remembered engine choice

#### Scenario: Switching to Monaco

- **WHEN** a user in Performant mode chooses Monaco from inside the panel
- **THEN** Monaco loads a complete bounded model for that panel

### Requirement: Shared file viewer client facade

The Performant viewer SHALL request bounded `file.text-metadata` and `file.text-lines` queries through the shared `FileViewerClient` over the selected server's application transport. Ranged text probes and sparse saves, including revision preconditions, SHALL use the same facade. Components SHALL NOT access preload APIs directly and Desktop SHALL NOT translate file operations.

#### Scenario: Performant viewer requests text

- **WHEN** the Performant viewer needs metadata or lines
- **THEN** it issues bounded `file.text-metadata` and `file.text-lines` queries through the shared client over the selected server's application transport

#### Scenario: Desktop host does not translate

- **WHEN** a desktop client performs a file operation
- **THEN** the operation travels the same server contract and Desktop does not translate it into a host preload call

### Requirement: Embedded Desktop file surface registration

The embedded Desktop composition SHALL register the complete file-session surface, Git-backed file diff projection, mutation-revision query, and bounded sparse save command before a connected panel is usable. These operations SHALL resolve the authenticated project-relative path against the server's canonical root.

#### Scenario: Panel becomes usable

- **WHEN** a connected file panel is presented in an embedded Desktop composition
- **THEN** the file-session surface, diff projection, mutation-revision query, and bounded sparse save command are already registered

### Requirement: Per-mode resource limits

All modes SHALL apply independent limits for range size, concurrent reads, decoded image dimensions, Markdown work, diff work, and client memory. Cancellation and backpressure SHALL follow the application protocol.

#### Scenario: Limit reached in a mode

- **WHEN** any of range size, concurrent reads, decoded image dimensions, Markdown work, diff work, or client memory reaches its limit
- **THEN** the mode applies that limit independently and follows protocol cancellation and backpressure

### Requirement: Shared draft session

One server-owned file session SHALL coordinate the on-disk base revision and draft edits for the panel. Text and HEX SHALL mutate that same draft. A clean file SHALL match its confirmed disk revision and a dirty file SHALL differ from it. Dirty panels SHALL show an accessible dirty indicator.

#### Scenario: Editing in Text then HEX

- **WHEN** a user edits in Text mode and then switches to HEX mode
- **THEN** both modes mutate the same server-owned draft

#### Scenario: Dirty indication

- **WHEN** a draft differs from the confirmed disk revision
- **THEN** the panel shows an accessible dirty indicator

### Requirement: Bounded session metadata response

The server-owned session metadata response SHALL contain only the canonical path, bounded disk metadata (size and optional host identity, mtime, and mode), ordered disk and draft revisions, and dirty, conflict, and watch state. It SHALL never return file bytes or an uncanonicalized client path, and unknown host metadata SHALL be omitted rather than invented.

#### Scenario: Metadata requested

- **WHEN** a client requests file session metadata
- **THEN** the response carries the canonical path, bounded disk metadata, ordered revisions, and dirty/conflict/watch state, and no file bytes

#### Scenario: Unknown host metadata

- **WHEN** host identity, mtime, or mode is unknown
- **THEN** the field is omitted rather than invented

### Requirement: Save dispatch and semantics

Save SHALL be available through the keyboard command. The active file panel SHALL register its current save handler with its project workspace, and menu or keyboard save dispatch SHALL resolve that registry by active panel identity rather than depending on a mutable Dockview parameter snapshot. A successful save SHALL advance the base revision and clear dirty state; a failed or conflicting save SHALL preserve the draft. File lists workspace creation and management surfaces and SHALL NOT duplicate Save.

#### Scenario: Keyboard save

- **WHEN** a user issues the save keyboard command with a file panel active
- **THEN** dispatch resolves the active panel's registered save handler by panel identity

#### Scenario: Successful save

- **WHEN** a save succeeds
- **THEN** the base revision advances and dirty state is cleared

#### Scenario: Failed or conflicting save

- **WHEN** a save fails or conflicts
- **THEN** the draft is preserved

### Requirement: Authoritative draft revisions

Clients MAY use optimistic local editing, but the server SHALL remain authoritative for the ordered draft revision. A stale client edit SHALL receive a conflict or resync response rather than overwriting newer edits. This contract coordinates Terminay clients and is not simultaneous collaborative text editing.

#### Scenario: Stale client edit

- **WHEN** a client submits an edit against a draft revision older than the server's
- **THEN** the server returns a conflict or resync response and does not overwrite newer edits

### Requirement: File watches

Open clean files SHALL be watched on the server. An external change to a clean file SHALL advance the disk revision and refresh connected clients. An external change to a dirty file SHALL stop auto-refresh and create a conflict.

#### Scenario: External change to a clean file

- **WHEN** an open clean file changes on disk
- **THEN** the disk revision advances and connected clients refresh

#### Scenario: External change to a dirty file

- **WHEN** an open dirty file changes on disk
- **THEN** auto-refresh stops and a conflict is created

### Requirement: Conflict resolution actions

The conflict banner SHALL offer **Reload from disk** and **Keep local edits**. Reload SHALL discard the draft only after explicit confirmation. Keep local edits SHALL rebase or retain the draft against the new disk revision and SHALL require an explicit later save.

#### Scenario: Reload from disk

- **WHEN** a user chooses Reload from disk on a conflict
- **THEN** the draft is discarded only after explicit confirmation

#### Scenario: Keep local edits

- **WHEN** a user chooses Keep local edits
- **THEN** the draft is rebased or retained against the new disk revision and an explicit later save is required

### Requirement: Recoverable filesystem states

Rename, delete, atomic replace, temporarily unavailable roots, and watch overflow SHALL produce distinct recoverable states.

#### Scenario: File renamed or deleted externally

- **WHEN** an open file is renamed, deleted, atomically replaced, its root becomes temporarily unavailable, or its watch overflows
- **THEN** the panel presents the corresponding distinct recoverable state

### Requirement: Initial load failure surface

A failed initial metadata request SHALL replace the loading state with an accessible error and retry action and SHALL NOT leave an indefinite spinner.

#### Scenario: Metadata request fails

- **WHEN** the initial metadata request for a file panel fails
- **THEN** the loading state is replaced with an accessible error and a retry action

### Requirement: Bounded watch history

Watch cursors SHALL replay only bounded history. A reconnect whose cursor is older than retained history SHALL receive `resyncRequired` and SHALL fetch a fresh bounded file snapshot rather than receiving an unbounded event backlog.

#### Scenario: Reconnect with an over-old cursor

- **WHEN** a client reconnects with a watch cursor older than retained history
- **THEN** the server returns `resyncRequired` and the client fetches a fresh bounded snapshot

### Requirement: Panel close releases resources

Closing the final panel for a file SHALL release its watch and bounded draft resources after normal close and dirty confirmation.

#### Scenario: Closing the last panel for a dirty file

- **WHEN** a user closes the final panel for a file
- **THEN** normal close and dirty confirmation runs and the watch and bounded draft resources are then released

### Requirement: Multi-client file coordination

Every command SHALL name the exact server, project, panel or file session, and expected revision. Connected clients SHALL receive ordered disk, draft, save, and conflict events. A client SHALL reconnect from known revisions or request a fresh bounded snapshot. Client disconnect SHALL NOT discard a server-held dirty draft. Another client SHALL NOT save, reload, or close a dirty file without the same authorization and explicit conflict rules.

#### Scenario: Ordered events to connected clients

- **WHEN** a disk, draft, save, or conflict change occurs
- **THEN** every connected client receives the ordered event

#### Scenario: Client disconnects with a dirty draft

- **WHEN** a client holding a dirty file disconnects
- **THEN** the server-held dirty draft is preserved

#### Scenario: Second client acts on a dirty file

- **WHEN** another client attempts to save, reload, or close a dirty file
- **THEN** it must satisfy the same authorization and explicit conflict rules

### Requirement: File security boundaries

Filesystem operations SHALL use canonical server-side path validation at the final operation boundary. Symlinks, worktrees, case rules, deleted roots, and replacements SHALL be revalidated rather than trusted from an earlier client response. Preview rendering SHALL be sandboxed. Markdown, image, PDF, and text previews SHALL NOT execute file-provided script. An HTML preview SHALL execute file-provided script only inside an opaque-origin frame that has no Terminay authority and no network access. File contents and paths SHALL never pass through the hosted signaling service. Protocol responses SHALL be bounded and SHALL reveal no data outside the authorized project scope. Save, reload, delete-related, and conflict actions SHALL reject stale or cross-server identities.

#### Scenario: Revalidation at the operation boundary

- **WHEN** a client submits a path validated by an earlier response
- **THEN** the server revalidates symlinks, worktrees, case rules, deleted roots, and replacements at the final operation boundary

#### Scenario: Script in previewed content

- **WHEN** a Markdown, image, PDF, or text preview contains script
- **THEN** the sandboxed preview does not execute it

#### Scenario: Script in an HTML preview

- **WHEN** an HTML preview contains script
- **THEN** the script runs only inside the opaque-origin frame
- **AND** it has no Terminay authority and no network access

#### Scenario: Remote client file transfer

- **WHEN** a remote client reads or writes file content
- **THEN** the contents and paths do not pass through the hosted signaling service

#### Scenario: Stale or cross-server action

- **WHEN** a save, reload, delete-related, or conflict action names a stale or cross-server identity
- **THEN** it is rejected

### Requirement: File viewer non-goals

The file viewer SHALL NOT run a language service in the client, nor provide an IDE contract beyond the editor's built-in highlighting and editing features together with the language features the server provides, editing in Preview or Diff, simultaneous collaborative editing, a remembered large-file engine choice, or a redesigned full file tree.

#### Scenario: Language server requested

- **WHEN** diagnostics, completions, hovers, or definitions are expected from the file viewer
- **THEN** they come from the server's language intelligence capability when a contributed language server serves the file, and are absent otherwise
- **AND** the client runs no language service of its own

#### Scenario: Two users editing one file

- **WHEN** two clients edit the same file at once
- **THEN** they are coordinated by ordered draft revisions and conflicts, not by simultaneous collaborative editing

### Requirement: TypeScript and JavaScript React files highlight as their base language

Text mode SHALL highlight `.tsx` files with the TypeScript grammar and `.jsx` files with the JavaScript grammar, because those grammars cover JSX syntax.

#### Scenario: TypeScript React file

- **WHEN** a `.tsx` file opens in Text mode
- **THEN** it is highlighted with the TypeScript grammar, including its JSX syntax

#### Scenario: JavaScript React file

- **WHEN** a `.jsx` file opens in Text mode
- **THEN** it is highlighted with the JavaScript grammar, including its JSX syntax

### Requirement: The workspace bundle carries no client language workers

The server-served workspace UI bundle SHALL contain no TypeScript, CSS, HTML, or JSON language worker and no language mode that starts one. Only the editor's base worker SHALL be emitted. A build check SHALL fail when any such language worker or language mode is emitted into the bundle.

#### Scenario: Language worker emitted into the bundle

- **WHEN** a build emits a TypeScript, CSS, HTML, or JSON language worker or language mode into the workspace UI bundle
- **THEN** the build check fails

### Requirement: Text mode consumes server language features

Text mode SHALL present the server's language intelligence for the open file. `language.diagnostics` events SHALL be applied as editor markers keyed by the document revision they were computed against. Completion, hover, and definition SHALL be provided through the editor's provider hooks, which SHALL call a language gateway that is the only client code naming the language operations. Every request SHALL carry the current draft revision, and a result for a stale revision SHALL be dropped rather than applied. When no provider serves the file, or the language session is unavailable, Text mode SHALL fall back to highlighting and editing with no error surfaced. Choosing a definition result SHALL open the target file through the ordinary file-viewer open path.

#### Scenario: Diagnostics arrive

- **WHEN** a `language.diagnostics` event arrives for the open file at the current draft revision
- **THEN** its diagnostics are applied as editor markers

#### Scenario: Stale result

- **WHEN** a completion, hover, definition, or diagnostics result names a revision older than the current draft revision
- **THEN** the result is dropped and the editor is left unchanged

#### Scenario: Go to definition

- **WHEN** the user follows a definition result that names another project file
- **THEN** that file opens through the ordinary file-viewer open path

### Requirement: Switching a Markdown file panel into Documentation

The File Viewer toolbar SHALL offer an accessible **Open as document** action for Markdown and MDX files, and for no other file. The action SHALL switch the same canonical panel to the Documentation presentation. The panel SHALL keep its server-owned file session, draft, and dirty state.

#### Scenario: Switching to the document view

- **WHEN** a user activates Open as document on a Markdown file panel in the File Viewer presentation
- **THEN** the same panel shows the Documentation presentation with its existing draft

#### Scenario: Not offered for other files

- **WHEN** a File Viewer panel shows a file that is neither Markdown nor MDX
- **THEN** the toolbar offers no Open as document action

### Requirement: Default view by file type

A file panel SHALL open in the view that suits the file's server-published classification, unless the open request names a view or a custom extension default applies. Text, including text recognised only by its content, SHALL open in Text. Markdown, images, and PDFs with a safe preview SHALL open in Preview. Binary data with no safe preview SHALL open in HEX. A custom extension default that names a view the file cannot show SHALL give way to the file's default view.

#### Scenario: Source file

- **WHEN** a user opens a TypeScript file
- **THEN** Text is the selected view

#### Scenario: Text with no recognised extension

- **WHEN** a user opens a file named `Dockerfile` whose content is valid text
- **THEN** Text is the selected view

#### Scenario: Image

- **WHEN** a user opens a PNG image
- **THEN** Preview is the selected view

#### Scenario: Unrecognised binary data

- **WHEN** a user opens a file whose content is binary and has no safe preview
- **THEN** HEX is the selected view

### Requirement: View switcher follows file type

The view switcher SHALL list as tabs only the views that can show the file, ordered with the default view's family first: Text, Preview, Diff for text; Preview, Tasks, Text, Diff for Markdown; Preview, HEX for a previewable image or PDF; HEX for other binary data. A view that can show the file but is not listed as a tab SHALL be reachable from a More views menu beside the tabs; HEX is such a view for every text file. A view chosen from that menu SHALL appear as a tab for as long as it is selected. Diff SHALL remain listed for a text file with nothing to compare, disabled, with the reason available from the tab. Views that cannot show the file SHALL NOT be listed.

#### Scenario: Text file tabs

- **WHEN** a source file with a safe preview is open
- **THEN** the switcher lists Text, Preview, and Diff
- **AND** HEX is offered from the More views menu

#### Scenario: Choosing HEX for a text file

- **WHEN** a user chooses HEX from the More views menu
- **THEN** HEX is shown and appears as the selected tab
- **AND** returning to Text removes the HEX tab

#### Scenario: Image tabs

- **WHEN** a PNG image is open
- **THEN** the switcher lists Preview and HEX only

#### Scenario: Nothing to compare

- **WHEN** a text file that Git does not track is open
- **THEN** Diff is listed, cannot be selected, and gives its reason

### Requirement: File panel chrome

A file panel SHALL carry no status bar of its own and SHALL NOT display the name of its text engine. Unsaved state SHALL be shown on the panel's tab. Text and Preview SHALL present the same file on the same surface colour with the same syntax palette and the same type size and line height.

#### Scenario: No in-panel status bar

- **WHEN** a file panel is open
- **THEN** the panel shows its view switcher and its content and no path, size, engine, or sync strip beneath them

#### Scenario: Switching between Preview and Text

- **WHEN** a user switches a source file between Preview and Text
- **THEN** the background, token colours, and text size are the same in both

### Requirement: HTML preview kind

The server SHALL classify files with the extensions `.html`, `.htm`, and `.xhtml` as text with the preview kind `html`, and SHALL publish that kind only when the file is within the preview size limit. The file viewer SHALL offer both Text and Preview for such a file. A client SHALL NOT treat a file as an HTML preview on the strength of its extension when the server has published a different classification.

#### Scenario: HTML file classification

- **WHEN** the server classifies a file named `index.html`, `page.htm`, or `doc.xhtml` whose content is valid text within the preview size limit
- **THEN** it publishes the preview kind `html`, reports the file as text, and reports Preview as safe

#### Scenario: Tabs offered for an HTML file

- **WHEN** a user opens an HTML file
- **THEN** the view switcher offers both Text and Preview

#### Scenario: HTML file over the preview limit

- **WHEN** an HTML file exceeds the preview size limit
- **THEN** the server does not publish the preview kind `html`
- **AND** the file opens in Text

### Requirement: HTML files open in Preview

A file whose server-published preview kind is `html` SHALL open in Preview, unless the open request names a view or a custom extension default applies.

#### Scenario: Opening an HTML file from the sidebar

- **WHEN** a user opens `index.html` from the file explorer
- **THEN** Preview is the selected view
- **AND** Text is available in the view switcher

#### Scenario: Open request names a view

- **WHEN** an open request for an HTML file names Text
- **THEN** Text is the selected view

### Requirement: HTML preview renders in a sandboxed webview

Preview SHALL render a file of preview kind `html` as a web page inside a frame with an opaque origin, nested in the Terminay sandbox proxy document. The frame SHALL be the same on Terminay Desktop and in a remote browser client. The page, including its script, SHALL have no preload, no host IPC, no application protocol access, no Terminay storage, and no access to the workspace document. A page SHALL NOT replace the document in its frame by navigating; a frame that loads a second document SHALL be removed. A host on which the proxy cannot be framed SHALL report the HTML Preview unavailable with the reason and SHALL NOT render the page by any other means.

#### Scenario: Page renders

- **WHEN** a user selects Preview on an HTML file
- **THEN** the page is rendered as a web page rather than as source text

#### Scenario: Page script runs without authority

- **WHEN** the previewed page contains script
- **THEN** the script runs inside the opaque-origin frame
- **AND** it cannot reach the workspace document, the preload API, the application protocol, or Terminay storage

#### Scenario: Remote browser client

- **WHEN** a remote browser client selects Preview on an HTML file
- **THEN** the page renders in the same sandboxed frame as on Terminay Desktop

#### Scenario: Page navigates itself

- **WHEN** the previewed page navigates its own frame to another document
- **THEN** the frame is removed and the foreign document is not shown as the preview

#### Scenario: Proxy cannot be framed

- **WHEN** the host cannot frame the sandbox proxy
- **THEN** Preview is reported unavailable for the HTML file with the reason
- **AND** the file opens in Text

### Requirement: HTML preview resources stay within the project

An HTML preview SHALL load a resource the page references by relative path — a stylesheet, script, image, font, or media file named in its markup, or a resource named by a `url()` or `@import` in such a stylesheet — when that path resolves, relative to the file's folder, to a file within the server-authorized project scope. Each resource SHALL be obtained through bounded server file reads, and the number and total size of resources for one preview SHALL be bounded. A reference that resolves outside the authorized scope, that exceeds a bound, or that cannot be read SHALL NOT load, and the rest of the page SHALL still render. The page SHALL have no network access: its content security policy SHALL allow no external origin, so a resource addressed to an external origin SHALL NOT load, a fetch, XMLHttpRequest, WebSocket, EventSource, or beacon from page script SHALL be refused, a form SHALL NOT submit, and the policy SHALL ask for WebRTC to be blocked.

#### Scenario: Relative stylesheet and image

- **WHEN** a previewed page references `./style.css` and `img/logo.png` beside it in the project
- **THEN** the stylesheet is applied and the image is shown

#### Scenario: Resource named inside a stylesheet

- **WHEN** a stylesheet loaded by the previewed page names a project font or image with `url()`
- **THEN** that resource loads

#### Scenario: Reference outside the project scope

- **WHEN** a previewed page references `../../outside/secret.css` resolving outside the server-authorized project scope
- **THEN** the resource does not load
- **AND** the rest of the page renders

#### Scenario: External resource

- **WHEN** a previewed page references a script, stylesheet, or image on an external HTTP or HTTPS origin
- **THEN** the resource does not load

#### Scenario: Script attempts a network request

- **WHEN** script in the previewed page attempts a network request
- **THEN** the request is refused

#### Scenario: Resource bounds exceeded

- **WHEN** a previewed page references more resources, or more resource bytes, than the preview bound allows
- **THEN** resources beyond the bound do not load
- **AND** the panel states that some resources were not loaded

### Requirement: HTML preview follows the draft

An HTML preview SHALL render the file's current draft. When the draft changes, the preview SHALL re-render after a short debounce, without a save. A watched change to a referenced project resource is not required to re-render the preview.

#### Scenario: Unsaved edit

- **WHEN** a user edits an HTML file in Text and switches to Preview without saving
- **THEN** Preview renders the edited content

#### Scenario: Edit while Preview is visible

- **WHEN** the draft of an HTML file changes while its Preview is visible
- **THEN** the preview re-renders with the new content after a short debounce

### Requirement: External links in an HTML preview

A link in an HTML preview that the user activates SHALL open through the normal external-link policy when it is a credential-free HTTP or HTTPS link, and SHALL be honoured only on a user gesture recorded in the page. A link to another project file SHALL NOT replace the previewed document.

#### Scenario: User activates an external link

- **WHEN** a user clicks a credential-free HTTPS link in an HTML preview
- **THEN** it opens through the normal external-link policy

#### Scenario: Script opens a link without a gesture

- **WHEN** script in the previewed page requests that a link be opened and there has been no user gesture in the page
- **THEN** the request is refused
