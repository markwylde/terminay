# documentation-sidebar-and-editor Specification

## Purpose

Define the per-project Documentation pane that discovers Markdown and MDX files under the project root and the Documentation panel presentation that provides rich MDXEditor editing, isolated live preview, and debounced autosave over server-owned file identity.

## Requirements

### Requirement: Documentation capability scope

Each project SHALL expose a Documentation pane that recursively discovers Markdown and MDX files under the project root and presents them as a focused, folder-grouped document tree. Opening a document SHALL create a dockable Documentation panel with a rich MDXEditor editing surface, live browser preview, and debounced autosave. Documentation SHALL be a distinct presentation from the general-purpose file viewer while reusing its server-owned file identity, revision, draft, conflict, save, and watch guarantees. Executable previews SHALL use the isolated MDX browser runtime.

#### Scenario: Opening a document
- **WHEN** a user selects a document in the Documentation pane
- **THEN** a dockable Documentation panel opens with rich editing, live preview, and debounced autosave over the server-owned file session

### Requirement: Documentation pane placement and persistence

Documentation SHALL live in the Documentation sidebar group as a collapsible, vertically resizable pane. Additional panes in that group SHALL be reorderable with it, and its height and collapse state SHALL persist with the project. The pane SHALL appear for every project, and its order, height, collapse state, and folder expansion state SHALL persist with that project without changing project files or another project's sidebar.

#### Scenario: Resizing and collapsing
- **WHEN** a user resizes, collapses, or reorders the Documentation pane
- **THEN** the choice persists with that project and does not change project files or another project's sidebar

#### Scenario: Every project has the pane
- **WHEN** any project is opened
- **THEN** the Documentation pane is present in its Documentation sidebar group

### Requirement: Document tree contents and ordering

The pane SHALL recursively list `.md` and `.mdx` files beneath the exact project root, with extension matching following the environment's filename case rules. Only folders containing a matching document at some descendant depth SHALL appear. Folders SHALL sort before documents, and each group SHALL sort by display title using a stable locale-aware order with the canonical relative path as its tie-breaker.

#### Scenario: Folder with no documents
- **WHEN** a folder contains no `.md` or `.mdx` file at any descendant depth
- **THEN** it does not appear in the tree

#### Scenario: Sorting
- **WHEN** the tree renders a folder's children
- **THEN** folders sort before documents and each group sorts by display title in a stable locale-aware order, tie-broken by canonical relative path

### Requirement: Ignore rules and symlink containment

The tree SHALL respect the configured project file-ignore rules and SHALL skip `.git`, dependency, generated-output, hidden, and other configured ignored directories by default. Symlinks SHALL NEVER be followed outside the canonical project scope.

#### Scenario: Ignored directory
- **WHEN** a documentation file lies inside `.git`, a dependency directory, generated output, a hidden directory, or another configured ignored directory
- **THEN** it does not appear in the tree

#### Scenario: Escaping symlink
- **WHEN** a symlink points outside the canonical project scope
- **THEN** it is not followed

### Requirement: Tree row behaviour

Folder rows SHALL expand and collapse without opening a tab. Document rows SHALL expose their project-relative location accessibly when the display title differs from the filename. A manual refresh SHALL remain available when filesystem observation is unavailable or when the user wants an immediate rescan.

#### Scenario: Expanding a folder
- **WHEN** a user expands or collapses a folder row
- **THEN** no tab opens

#### Scenario: Title differs from filename
- **WHEN** a document's display title differs from its filename
- **THEN** its project-relative location is exposed accessibly

#### Scenario: Manual refresh
- **WHEN** observation is unavailable or a user requests a rescan
- **THEN** manual refresh is available

### Requirement: Server-side discovery

Recursive discovery, metadata extraction, ignore handling, and observation SHALL run on the exact project's environment adapter under Terminay Server. The renderer and browser clients SHALL NEVER recursively inspect a host filesystem.

#### Scenario: Building the catalog
- **WHEN** the document catalog is built
- **THEN** discovery, metadata extraction, ignore handling, and observation run on the project's environment adapter under the server, not in a client

### Requirement: Bounded discovery

Discovery SHALL be bounded by entry count, depth, bytes inspected, elapsed time, and cancellation. A partial result SHALL be explicit and SHALL remain navigable.

#### Scenario: Bound reached
- **WHEN** discovery exceeds its entry, depth, byte, or time bound, or is cancelled
- **THEN** the partial result is explicitly marked and remains navigable

### Requirement: Frontmatter title metadata

The catalog SHALL read only a bounded document prefix to determine metadata. YAML frontmatter `title` SHALL supply the display title when it is a non-empty string. Other frontmatter fields SHALL remain intact and SHALL NOT become filesystem or application authority.

#### Scenario: Valid title frontmatter
- **WHEN** a document's YAML frontmatter contains a non-empty `title` string
- **THEN** that value becomes the display title

#### Scenario: Other frontmatter fields
- **WHEN** frontmatter contains fields other than `title`
- **THEN** they remain intact and confer no filesystem or application authority

### Requirement: Filename title fallback

Without a usable frontmatter title, the filename without `.md` or `.mdx` SHALL be split on separators and common camel-case boundaries and displayed in title case. The underlying filename and canonical path SHALL NEVER change implicitly. Malformed or oversized frontmatter SHALL fall back to the filename title and SHALL expose a bounded diagnostic without hiding the document.

#### Scenario: No frontmatter title
- **WHEN** a document has no usable frontmatter title
- **THEN** its filename without extension is split on separators and camel-case boundaries and displayed in title case, leaving the filename and canonical path unchanged

#### Scenario: Malformed frontmatter
- **WHEN** frontmatter is malformed or oversized
- **THEN** the filename title is used, a bounded diagnostic is exposed, and the document is still listed

### Requirement: Incremental catalog updates

Server-owned watch events SHALL incrementally add, remove, move, retitle, and regroup documents. Atomic saves, rename and delete, temporary root loss, watch overflow, and resync SHALL follow the existing Explorer observation contract. An external metadata or filename change SHALL preserve unrelated expanded folders, selection, and open panels.

#### Scenario: External rename
- **WHEN** a document is renamed or retitled outside Terminay
- **THEN** the tree updates incrementally while unrelated expanded folders, selection, and open panels are preserved

#### Scenario: Watch overflow
- **WHEN** watch events overflow or the root is temporarily lost
- **THEN** the existing Explorer observation contract governs resync

### Requirement: Canonical Documentation panel identity

Selecting a document SHALL open or focus one canonical Documentation panel for that project file, and repeated opens SHALL NOT create duplicate Documentation panels. A normal File Viewer panel and a Documentation panel for the same canonical file SHALL NOT coexist: opening the file through either surface SHALL focus the existing canonical file panel and change its presentation to the requested mode without replacing its server-owned file session or draft.

#### Scenario: Reopening a document
- **WHEN** a user selects an already open document
- **THEN** the existing Documentation panel is focused rather than duplicated

#### Scenario: Opening from Explorer
- **WHEN** a file already open in Documentation mode is opened from Explorer
- **THEN** the existing canonical file panel is focused and switched to the requested presentation, keeping its server-owned file session and draft

### Requirement: Documentation panel presentation and title

Documentation panels SHALL support the normal Dockview focus, close, split, drag, reorder, native-window, and responsive web presentations allowed by the project's environment boundary. The tab title SHALL use the current frontmatter title with the same filename fallback as the tree, and a title change SHALL update the tree and tab after the corresponding draft or save revision becomes authoritative.

#### Scenario: Editing the frontmatter title
- **WHEN** a user changes the frontmatter title and the corresponding revision becomes authoritative
- **THEN** the tree entry and tab title update

### Requirement: Link handling

Project-relative `.md` and `.mdx` links SHALL open in Documentation mode. External links SHALL use the normal external-link policy.

#### Scenario: Following a relative document link
- **WHEN** a user follows a project-relative `.md` or `.mdx` link
- **THEN** the target opens in Documentation mode

#### Scenario: Following an external link
- **WHEN** a user follows an external link
- **THEN** the normal external-link policy applies

### Requirement: Rich editing capabilities

The editing surface SHALL use MDXEditor and SHALL provide the Markdown/MDX-safe capabilities represented by its supported plugins, including headings, emphasis, lists, quotes, thematic breaks, links, images, tables, code blocks, frontmatter, directives and admonitions, JSX, search and replace, undo and redo, Markdown shortcuts, Sandpack-style live code-block editors, and source and diff modes where supported. First-party MDXEditor capabilities SHALL be enabled when their required execution fits the MDX browser-runtime boundary.

#### Scenario: Using a rich capability
- **WHEN** a user applies a supported MDXEditor capability such as a table, code block, or directive
- **THEN** the document is edited through that capability

#### Scenario: Capability requiring unsafe execution
- **WHEN** an MDXEditor capability would require execution outside the MDX browser-runtime boundary
- **THEN** it is not enabled

### Requirement: Toolbar behaviour

The toolbar SHALL expose the supported rich editing actions with accessible names, keyboard operation, overflow behaviour, and a compact responsive layout. Inserting an admonition from the toolbar, including `info`, SHALL create an editable directive using the matching registered rich-editor descriptor.

#### Scenario: Inserting an admonition
- **WHEN** a user inserts any admonition type, including `info`, from the toolbar
- **THEN** an editable directive is created from the matching registered descriptor without disrupting another panel or terminal

#### Scenario: Narrow toolbar
- **WHEN** the panel is narrow
- **THEN** the toolbar uses its compact responsive layout with overflow, keeping accessible names and keyboard operation

### Requirement: Reading canvas typography and rhythm

Rich text SHALL use the application's Open Sans reading face, a comfortable body line height, and deliberate vertical rhythm for headings, paragraphs, lists, quotes, code, and tables. Task-list controls SHALL remain visually distinct to the left of their labels with a consistent readable gutter. The reading canvas SHALL use a compact leading inset and SHALL expand fluidly at desktop widths without producing edge-to-edge prose, then SHALL tighten its type and margins at narrower breakpoints. After the final block, the canvas SHALL retain scrollable trailing space equal to 80% of the Documentation tab height. Editor controls and popup menus SHALL retain the same dark palette as the Documentation surface.

#### Scenario: Reading at desktop width
- **WHEN** a Documentation panel is wide
- **THEN** the reading canvas expands fluidly without edge-to-edge prose

#### Scenario: Task list rendering
- **WHEN** a Markdown task list is displayed
- **THEN** each checkbox sits to the left of, and is clearly separated from, its label by a consistent gutter

#### Scenario: Scrolling to the end
- **WHEN** a user scrolls past the final block
- **THEN** trailing space equal to 80% of the Documentation tab height remains scrollable

#### Scenario: Opening a toolbar dropdown
- **WHEN** a user opens an editor control or popup menu
- **THEN** it uses the same dark palette as the Documentation surface

### Requirement: Table presentation

Rich table cells SHALL use the Documentation palette and readable row sizing. Structural row, column, and add controls SHALL remain visually quiet until their relevant edge is hovered or focused instead of filling an empty table with persistent icons.

#### Scenario: Empty table
- **WHEN** a table has no hovered or focused edge
- **THEN** its structural row, column, and add controls stay quiet rather than showing persistent icons

### Requirement: Documentation status bar

The Documentation status bar SHALL report the file size and sync state and SHALL NOT label the rich editor as Monaco.

#### Scenario: Status bar contents
- **WHEN** a Documentation panel is open
- **THEN** the status bar shows file size and sync state without naming the editor as Monaco

### Requirement: Fenced code block editing

Inserting a fenced code block SHALL open a registered dark CodeMirror editor and SHALL NEVER take down the surrounding rich editor.

#### Scenario: Inserting a code block
- **WHEN** a user inserts a fenced code block
- **THEN** a registered dark CodeMirror editor opens inside the surrounding rich editor, which continues to function

### Requirement: Lossless source handling

Source constructs that have no rich visual editor SHALL remain losslessly editable in source mode or an appropriate structured placeholder. Switching rich, source, diff, and preview presentations SHALL NOT discard a draft.

#### Scenario: Unsupported construct
- **WHEN** a document contains a construct with no rich visual editor
- **THEN** it remains losslessly editable in source mode or through a structured placeholder

#### Scenario: Switching presentation
- **WHEN** a user switches between rich, source, diff, and preview
- **THEN** the draft is retained

### Requirement: Markdown and MDX format boundary

Markdown documents SHALL NOT gain MDX syntax merely by being opened. If a user introduces MDX-only syntax into a `.md` file, the editor SHALL explain the format mismatch and SHALL offer an explicit rename to `.mdx`; it SHALL NOT silently rename the file or strip syntax.

#### Scenario: Opening a .md file
- **WHEN** a `.md` document is opened
- **THEN** no MDX syntax is introduced

#### Scenario: MDX syntax typed into a .md file
- **WHEN** a user introduces MDX-only syntax into a `.md` file
- **THEN** the editor explains the mismatch and offers an explicit rename to `.mdx` without silently renaming or stripping content

### Requirement: Project images and assets

Relative project images and assets SHALL resolve from the document folder through server-authorized resource identities. Image insertion that creates or copies a project file SHALL be an explicit filesystem mutation with normal project scope validation. Rich-editor images SHALL preserve their intrinsic aspect ratio and SHALL be capped at the available width of the Documentation reading canvas.

#### Scenario: Rendering a relative image
- **WHEN** a document references a relative project image
- **THEN** it resolves from the document folder through a server-authorized resource identity, preserving aspect ratio and capped at the canvas width

#### Scenario: Inserting an image file
- **WHEN** image insertion creates or copies a project file
- **THEN** it is an explicit filesystem mutation subject to normal project scope validation

### Requirement: Preview isolation

The executable preview SHALL always be rendered through the isolated MDX browser runtime. The MDXEditor editing surface SHALL NEVER evaluate project imports inside Terminay's main renderer.

#### Scenario: Previewing an MDX document
- **WHEN** an MDX document with project imports is previewed
- **THEN** evaluation occurs only in the isolated MDX browser runtime, never in Terminay's main renderer

### Requirement: Documentation autosave debounce

Documentation mode SHALL autosave after one second without an editor change. Continued typing SHALL reset the debounce and SHALL NOT create overlapping saves. Autosave SHALL use the shared server-owned file session and SHALL declare the expected disk and draft revisions, preserving atomic-write, canonical-path, size, authorization, and environment guarantees from the file viewer.

#### Scenario: Pausing typing
- **WHEN** a user stops editing for one second
- **THEN** an autosave runs against the shared server-owned file session declaring expected disk and draft revisions

#### Scenario: Continuous typing
- **WHEN** a user keeps typing
- **THEN** the debounce resets and no overlapping saves are issued

### Requirement: Autosave status reporting

Routine autosave state SHALL be reported by the shared bottom status bar, and the rich editor SHALL NOT add a second `Saving`, `Saved`, or `Unsaved changes` row above its toolbar. Contextual notices SHALL remain available for conflicts, failures, preview diagnostics, and cancellable work. A successful save SHALL advance the base revision and clear dirty state.

#### Scenario: Routine save
- **WHEN** an autosave succeeds
- **THEN** the shared bottom status bar reports it, the base revision advances, dirty state clears, and no duplicate status row appears above the toolbar

#### Scenario: Conflict or failure
- **WHEN** a save conflicts or fails
- **THEN** a contextual notice is presented

### Requirement: Flush on blur, presentation change, and close

Blur, presentation changes, and an attempted close SHALL request an immediate flush of a pending debounce. Closing SHALL wait for the bounded in-flight result; a failure or conflict SHALL keep the draft and SHALL ask whether to keep the panel open or close while retaining the server-owned draft.

#### Scenario: Closing with pending changes
- **WHEN** a user closes a Documentation panel with a pending debounce
- **THEN** the save flushes immediately and the close waits for the bounded in-flight result

#### Scenario: Close-time save failure
- **WHEN** the flushed save fails or conflicts on close
- **THEN** the draft is retained and the user is asked whether to keep the panel open or close

### Requirement: Save serialization

A slow save SHALL serialize later editor revisions and SHALL save the newest pending revision next. An older completion SHALL NOT mark newer unsaved content saved.

#### Scenario: Editing during a slow save
- **WHEN** a user edits while a save is in flight
- **THEN** the newest pending revision is saved next and the older completion does not mark it saved

### Requirement: Self-write event reconciliation

A successful autosave SHALL retain a bounded history of exact written file revisions while delayed filesystem observations settle. Duplicate delayed self-write events from an earlier save SHALL remain acknowledged after the user begins a later edit and SHALL NEVER enter the external-conflict flow.

#### Scenario: Delayed self-write event
- **WHEN** a delayed filesystem event for an earlier autosave arrives after the user has begun a later edit
- **THEN** it is acknowledged from the bounded revision history and does not enter the external-conflict flow

### Requirement: External change handling

An external change to a clean document SHALL refresh the editor. An external change while local changes are dirty or saving SHALL enter the existing explicit conflict flow and SHALL NEVER overwrite either version automatically.

#### Scenario: Clean document changed externally
- **WHEN** a document with no local changes changes on disk
- **THEN** the editor refreshes

#### Scenario: Dirty document changed externally
- **WHEN** a document changes on disk while local changes are dirty or saving
- **THEN** the explicit conflict flow starts and neither version is overwritten automatically

### Requirement: Autosave scope and failure retry

Normal file viewer Text and HEX modes SHALL retain their existing explicit-save behaviour. Leaving Documentation mode SHALL flush its pending autosave before the presentation changes and SHALL NOT turn general file editing into autosave. Autosave failure SHALL use bounded retry with visible status and user-triggered retry and SHALL NEVER run an unbounded write loop or silently drop a draft.

#### Scenario: Leaving Documentation mode
- **WHEN** a panel switches away from Documentation mode
- **THEN** the pending autosave flushes first and the new presentation retains explicit-save behaviour

#### Scenario: Repeated autosave failure
- **WHEN** autosave keeps failing
- **THEN** retry stays bounded with visible status and a user-triggered retry, and the draft is not dropped

### Requirement: Editor state preserved across saves

Autosave metadata refreshes SHALL NOT remount the rich editor: the active caret, selection, composition, and keyboard focus SHALL remain in place after a save.

#### Scenario: Save during typing
- **WHEN** an autosave completes while the user is editing
- **THEN** caret, selection, composition, and keyboard focus are unchanged

### Requirement: Live preview presentation

Markdown and MDX documents MAY display a live preview alongside or instead of the editor according to the selected responsive layout. `.mdx` imports, JSX expressions, project React components, and browser-safe dependencies SHALL execute in the isolated runtime without a trust prompt. Network connections, external assets, interactive controls, JavaScript form handlers, governed downloads, browser storage, and cookies SHALL behave according to the MDX browser-runtime contract.

#### Scenario: Rendering a project component
- **WHEN** an MDX document imports a project React component
- **THEN** it renders in the isolated runtime with normal browser networking and external assets and without a trust prompt

### Requirement: Preview navigation containment

Preview navigation and popup attempts SHALL NOT replace the document, navigate Terminay, or create an ungoverned window.

#### Scenario: Preview attempts navigation
- **WHEN** preview content attempts navigation or a popup
- **THEN** the document is not replaced, Terminay does not navigate, and no ungoverned window is created

### Requirement: Preview error containment

Compilation and runtime errors SHALL leave the editor and autosaved draft usable. Diagnostics SHALL identify the relevant source or import and SHALL offer preview restart.

#### Scenario: MDX compilation error
- **WHEN** a document fails to compile or throws at runtime
- **THEN** the editor and autosaved draft remain usable and a diagnostic identifies the source or import and offers preview restart

### Requirement: Server-owned Documentation state

The document catalog, metadata, file sessions, drafts, saves, watches, compilation inputs, and project resources SHALL be server-owned and scoped by authenticated server, project, and environment identity. Clients SHALL render the tree and editor through the application protocol and SHALL NEVER infer filesystem authority from an extension, title, rendered link, or MDX import.

#### Scenario: Client authority
- **WHEN** a client renders the tree or editor
- **THEN** it derives no filesystem authority from an extension, title, rendered link, or MDX import

#### Scenario: Local and remote parity
- **WHEN** Local Desktop or a remote web client uses Documentation
- **THEN** both use the same server-authorized catalog, file-session, watch, compilation, and resource contracts

### Requirement: Panel moves and disconnect behaviour

Panel moves SHALL preserve canonical file identity and draft state only where the environment boundary permits. Disconnect SHALL preserve a dirty server-owned draft, SHALL cancel in-flight catalog and resource transfers, and SHALL destroy or suspend client preview execution. Reconnect SHALL obtain a fresh bounded snapshot or revision-based resumption before editing or previewing.

#### Scenario: Disconnect with unsaved work
- **WHEN** a client disconnects with a dirty Documentation draft
- **THEN** the server-owned draft is preserved, in-flight catalog and resource transfers are cancelled, and client preview execution is destroyed or suspended

#### Scenario: Reconnect
- **WHEN** a client reconnects
- **THEN** it obtains a fresh bounded snapshot or revision-based resumption before editing or previewing

### Requirement: Distinguishable failure states

Missing roots, unsupported observation, rejected paths, bounded partial traversal, malformed frontmatter, catalog failure, file conflict, save failure, compilation failure, and preview crash SHALL be distinguishable states. A catalog refresh failure SHALL retain the last successful tree and SHALL clear only its own stale failure after recovery. A vanished open document SHALL retain its draft and SHALL offer recovery appropriate to the existing file viewer deletion and rename contract.

#### Scenario: Catalog refresh fails
- **WHEN** a catalog refresh fails
- **THEN** the last successful tree is retained and only that failure clears after recovery

#### Scenario: Open document deleted
- **WHEN** an open document vanishes from disk
- **THEN** its draft is retained and recovery follows the existing file viewer deletion and rename contract

### Requirement: Failure isolation

Failure in one document or preview SHALL NOT collapse the tree, close another panel, or interrupt a terminal. An unexpected rich-editor failure SHALL be contained to that Documentation panel; the panel SHALL retain its server-owned draft and SHALL offer an editor retry, and SHALL NEVER replace the application workspace with an empty renderer.

#### Scenario: Rich editor crashes
- **WHEN** the rich editor fails unexpectedly in one panel
- **THEN** the failure is contained to that panel, its server-owned draft is retained, an editor retry is offered, and the workspace is not replaced by an empty renderer

#### Scenario: One preview fails
- **WHEN** one document's preview fails
- **THEN** the tree does not collapse, other panels stay open, and terminals are uninterrupted

### Requirement: Documentation non-goals

Documentation SHALL NOT replace the general-purpose Explorer or file viewer, SHALL NOT turn normal file viewer editing into autosave, SHALL NOT execute MDX in Terminay's main renderer or reproduce arbitrary project development-server configuration, SHALL NOT treat frontmatter as application configuration or authorization, and SHALL NOT follow symlinks or imports outside the canonical project root.

#### Scenario: Frontmatter as configuration
- **WHEN** frontmatter contains configuration-like fields
- **THEN** they confer no application configuration or authorization

#### Scenario: Import outside the project root
- **WHEN** an MDX import or symlink resolves outside the canonical project root
- **THEN** it is not followed
