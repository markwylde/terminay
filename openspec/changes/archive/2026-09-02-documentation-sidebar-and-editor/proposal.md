## Why

A project's Markdown and MDX documents are only reachable by expanding the file
Explorer directory by directory, and they open in the plain text file viewer.
Projects need a dedicated watched document tree and a rich editing presentation
with frontmatter titles, debounced autosave, and a live sandboxed preview.

## What Changes

- Add a Documentation pane to every project sidebar, backed by a server-owned
  bounded document catalog rather than recursive Explorer expansion.
- Add a `docs.catalog` binary query returning catalog revision, scan counts,
  partial reason, next cursor, and a bounded list of folder and document records
  with project-relative path, extension, display title, and title source.
- Reuse the existing root observation subscription for invalidation: a watch
  event schedules one coalesced catalog refresh, and overflow or resync fetches a
  fresh catalog.
- Add a `DocumentationClient` in client-core, constructed in the shared renderer
  server client, and a controller owning catalog state, expansion, selection, and
  the coalesced refresh timer.
- Add explicit settings for the Documentation pane's default collapse state and
  default height, and normalize stored sidebar and project state that predates
  the pane to exactly one collapsed pane without reordering the others.
- Give the file panel a presentation discriminator so one canonical panel, file
  session, and draft serves both Explorer and Documentation entry points.
- Add the MDXEditor surface with its first-party plugin set, lossless handling of
  unsupported constructs, and actionable unsupported-document states.
- Add a one-second debounced autosave controller over the existing edit and save
  operations, with serialized saves and deterministic status.
- Integrate the isolated MDX browser runtime as the executable preview.
- **BREAKING** Opening a file already open in the other presentation focuses the
  existing canonical panel and switches its presentation rather than opening a
  second panel.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `documentation-sidebar-and-editor`: adds the document catalog protocol query,
  its coalesced watch-driven refresh contract, and the Documentation pane's
  default and stored-state normalization rules.

## Impact

- New server-core documentation catalog service with a shared reusable ignore
  parser and a direct YAML parser dependency for bounded frontmatter reading.
- New `docs.catalog` protocol operation registered with authenticated project
  authorization in local and extension-backed environment composition.
- New `DocumentationClient` in client-core and a documentation controller and
  tree in the workspace renderer.
- Sidebar panel ids, settings defaults and normalization, project creation,
  restored project normalization, and server workspace serialization.
- File panel parameters, `openFile` routing, and server-owned panel
  serialization gain a presentation discriminator.
- New MDXEditor dependency and its stylesheet, configured once.
- Depends on the MDX browser runtime change for the executable preview; earlier
  milestones may use a non-executable placeholder.
