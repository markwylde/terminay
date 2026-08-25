# Documentation sidebar and editor

## Summary

Each project exposes a Documentation pane that recursively discovers Markdown
and MDX files under the project root and presents them as a focused,
folder-grouped document tree. Opening a document creates a dockable
Documentation panel with a rich MDXEditor editing surface, live browser
preview, and debounced autosave.

Documentation is a distinct presentation from the general-purpose
[file viewer](./file-viewer.md), while reusing its server-owned file identity,
revision, draft, conflict, save, and watch guarantees. Executable previews use
the isolated [MDX browser runtime](./mdx-browser-runtime.md).

## Documentation pane

- Documentation joins Explorer, Agents, and Git in the persistent, reorderable,
  vertically resizable sidebar stack.
- It appears for every project. Its order, height, collapse state, and folder
  expansion state persist with that project without changing project files or
  another project's sidebar.
- The pane recursively lists `.md` and `.mdx` files beneath the exact project
  root. Extension matching follows the environment's filename case rules.
- Only folders containing a matching document at some descendant depth appear.
  Folders sort before documents; each group sorts by display title using a
  stable locale-aware order and canonical relative path as its tie-breaker.
- The tree respects the configured project file-ignore rules and skips `.git`,
  dependency, generated-output, hidden, and other configured ignored
  directories by default. Symlinks are never followed outside the canonical
  project scope.
- Folder rows expand and collapse without opening a tab. Document rows expose
  their project-relative location accessibly when the display title differs
  from the filename.
- A manual refresh remains available when filesystem observation is unavailable
  or when the user wants an immediate rescan.

## Discovery, metadata, and watches

- Recursive discovery, metadata extraction, ignore handling, and observation
  run on the exact project's environment adapter under Terminay Server. The
  renderer and browser clients never recursively inspect a host filesystem.
- Discovery is bounded by entry count, depth, bytes inspected, elapsed time,
  and cancellation. A partial result is explicit and remains navigable.
- The catalog reads only a bounded document prefix to determine metadata. YAML
  frontmatter `title` supplies the display title when it is a non-empty string.
  Other frontmatter fields remain intact and do not become filesystem or
  application authority.
- Without a usable frontmatter title, the filename without `.md` or `.mdx` is
  split on separators and common camel-case boundaries and displayed in title
  case. The underlying filename and canonical path never change implicitly.
- Malformed or oversized frontmatter falls back to the filename title and
  exposes a bounded diagnostic without hiding the document.
- Server-owned watch events incrementally add, remove, move, retitle, and
  regroup documents. Atomic saves, rename/delete, temporary root loss, watch
  overflow, and resync follow the existing Explorer observation contract.
- An external metadata or filename change preserves unrelated expanded folders,
  selection, and open panels.

## Opening and panel identity

- Selecting a document opens or focuses one canonical Documentation panel for
  that project file. Repeated opens do not create duplicate Documentation
  panels.
- A normal File Viewer panel and a Documentation panel for the same canonical
  file do not coexist. Opening the file through either surface focuses the
  existing canonical file panel and changes its presentation to the requested
  mode without replacing its server-owned file session or draft.
- Documentation panels support the normal Dockview focus, close, split, drag,
  reorder, native-window, and responsive web presentations allowed by the
  project's environment boundary.
- The tab title uses the current frontmatter title with the same filename
  fallback as the tree. A title change updates the tree and tab after the
  corresponding draft/save revision becomes authoritative.
- Project-relative `.md` and `.mdx` links open in Documentation mode. External
  links use the normal external-link policy.

## Rich editing

- The editing surface uses MDXEditor and provides the Markdown/MDX-safe
  capabilities represented by its supported plugins, including headings,
  emphasis, lists, quotes, thematic breaks, links, images, tables, code blocks,
  frontmatter, directives/admonitions, JSX, search/replace, undo/redo, Markdown
  shortcuts, Sandpack-style live code-block editors, and source/diff modes where
  supported. First-party MDXEditor capabilities are enabled when their required
  execution fits the MDX browser-runtime boundary.
- The toolbar exposes the supported rich editing actions with accessible names,
  keyboard operation, overflow behaviour, and a compact responsive layout.
- Inserting an admonition from the toolbar, including `info`, creates an
  editable directive using the matching registered rich-editor descriptor.
- Rich text uses the application's Open Sans reading face, a comfortable body
  line height, and deliberate vertical rhythm for headings, paragraphs, lists,
  quotes, code, and tables. Task-list controls remain visually distinct to the
  left of their labels with a consistent readable gutter. Its reading canvas
  uses a compact leading inset and expands fluidly at desktop widths without
  producing edge-to-edge prose, then tightens its type and
  margins at narrower breakpoints. After the final block, the canvas retains
  scrollable trailing space equal to 80% of the Documentation tab height.
  Editor controls and popup menus retain the same dark palette as the
  Documentation surface.
- Rich table cells use the Documentation palette and readable row sizing.
  Structural row, column, and add controls remain visually quiet until their
  relevant edge is hovered or focused instead of filling an empty table with
  persistent icons.
- The Documentation status bar reports the file size and sync state without
  labelling the rich editor as Monaco.
- Inserting a fenced code block opens a registered dark CodeMirror editor and
  never takes down the surrounding rich editor.
- Source constructs that have no rich visual editor remain losslessly editable
  in source mode or an appropriate structured placeholder. Switching rich,
  source, diff, and preview presentations does not discard a draft.
- Markdown documents do not gain MDX syntax merely by opening them. If the user
  introduces MDX-only syntax into a `.md` file, the editor explains the format
  mismatch and offers an explicit rename to `.mdx`; it does not silently rename
  or strip syntax.
- Relative project images and assets resolve from the document folder through
  server-authorized resource identities. Image insertion that creates or copies
  a project file is an explicit filesystem mutation with normal project scope
  validation. Rich-editor images preserve their intrinsic aspect ratio and are
  capped at the available width of the Documentation reading canvas.
- The executable preview is always rendered through the isolated MDX browser
  runtime. The MDXEditor editing surface never evaluates project imports inside
  Terminay's main renderer.

## Autosave and draft lifecycle

- Documentation mode autosaves after one second without an editor change.
  Continued typing resets the debounce; it does not create overlapping saves.
- Autosave uses the shared server-owned file session and declares the expected
  disk and draft revisions. It preserves atomic-write, canonical-path, size,
  authorization, and environment guarantees from the File Viewer.
- Routine autosave state is reported by the shared bottom status bar; the rich
  editor does not add a second `Saving`, `Saved`, or `Unsaved changes` row above
  its toolbar. Contextual notices remain available for conflicts, failures,
  preview diagnostics, and cancellable work. A successful save advances the
  base revision and clears dirty state.
- Blur, presentation changes, and an attempted close request an immediate flush
  of a pending debounce. Closing waits for the bounded in-flight result; a
  failure or conflict keeps the draft and asks whether to keep the panel open or
  close while retaining the server-owned draft.
- A slow save serializes later editor revisions and saves the newest pending
  revision next. An older completion cannot mark newer unsaved content saved.
- A successful autosave retains a bounded history of exact written file
  revisions while delayed filesystem observations settle. Duplicate delayed
  self-write events from an earlier save remain acknowledged after the user
  begins a later edit and never enter the external-conflict flow.
- An external change to a clean document refreshes the editor. An external
  change while local changes are dirty or saving enters the existing explicit
  conflict flow and never overwrites either version automatically.
- Normal File Viewer Text and HEX modes retain their existing explicit-save
  behaviour. Leaving Documentation mode flushes its pending autosave before the
  presentation changes; it does not turn general file editing into autosave.
- Autosave failure uses bounded retry with visible status and user-triggered
  retry. It never runs an unbounded write loop or silently drops a draft.
- Autosave metadata refreshes do not remount the rich editor: the active caret,
  selection, composition, and keyboard focus remain in place after a save.

## Preview and browser behaviour

- Markdown and MDX documents may display a live preview alongside or instead of
  the editor according to the selected responsive layout.
- `.mdx` imports, JSX expressions, project React components, and browser-safe
  dependencies execute in the isolated runtime without a trust prompt.
- Network connections, external assets, interactive controls, JavaScript form
  handlers, governed downloads, browser storage, and cookies behave according
  to the MDX browser-runtime contract.
- Preview navigation and popup attempts cannot replace the document, navigate
  Terminay, or create an ungoverned window.
- Compilation and runtime errors leave the editor and autosaved draft usable.
  Diagnostics identify the relevant source/import and offer preview restart.

## Ownership and boundaries

Document catalog, metadata, file sessions, drafts, saves, watches, compilation
inputs, and project resources are server-owned and scoped by authenticated
server/project/environment identity. Clients render the tree and editor through
the application protocol and never infer filesystem authority from an
extension, title, rendered link, or MDX import.

Panel moves preserve canonical file identity and draft state only where the
environment boundary permits. Disconnect preserves a dirty server-owned draft,
cancels in-flight catalog/resource transfers, and destroys or suspends client
preview execution. Reconnect obtains a fresh bounded snapshot or revision-based
resumption before editing or previewing.

## Failure behaviour

- Missing roots, unsupported observation, rejected paths, bounded partial
  traversal, malformed frontmatter, catalog failure, file conflict, save
  failure, compilation failure, and preview crash are distinguishable states.
- A catalog refresh failure retains the last successful tree and clears only
  its own stale failure after recovery.
- A vanished open document retains its draft and offers recovery appropriate to
  the existing File Viewer deletion/rename contract.
- Failure in one document or preview does not collapse the tree, close another
  panel, or interrupt a terminal.
- An unexpected rich-editor failure is contained to that Documentation panel.
  The panel retains its server-owned draft and offers an editor retry; it never
  replaces the application workspace with an empty renderer.

## Non-goals

- Replacing the general-purpose Explorer or File Viewer.
- Turning normal File Viewer editing into autosave.
- Executing MDX in Terminay's main renderer or reproducing arbitrary project
  development-server configuration.
- Treating frontmatter as application configuration or authorization.
- Following symlinks or imports outside the canonical project root.

## Acceptance outcomes

- The Documentation pane can be reordered and resized with the other sidebar
  panes and retains explicit collapse choices.
- The tree contains only non-ignored folders leading to `.md` or `.mdx` files,
  updates after external changes, and retains unrelated expansion and selection.
- Valid YAML `title` frontmatter controls tree and tab titles; malformed or
  absent metadata falls back to a title-cased filename without changing it.
- Opening the same file from Documentation or Explorer focuses one canonical
  file session and selects the requested presentation rather than producing
  competing editors.
- Rich edits autosave after one second of inactivity, serialize overlapping
  revisions, and visibly preserve a draft after failure or conflict.
- Each toolbar admonition type can be inserted and edited without disrupting
  another panel or terminal session.
- Rich text remains comfortably readable at normal desktop widths, and opening
  a toolbar dropdown never introduces a light-themed popup into the dark UI.
- Markdown task lists show each checkbox to the left of, and clearly separated
  from, its label.
- The final document block can scroll to roughly the top fifth of the
  Documentation tab, leaving 80% of the tab as trailing reading space.
- Normal File Viewer editing still requires its existing explicit Save command.
- An MDX document imports and renders a project TSX component with normal
  browser networking and external assets, while navigation, popups,
  Node/Electron access, and project-root escapes remain blocked.
- Local Desktop and remote/web clients use the same server-authorized catalog,
  file-session, watch, compilation, and resource contracts.
