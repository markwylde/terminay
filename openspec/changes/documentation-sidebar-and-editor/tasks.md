## 1. Server document catalog

- [ ] 1.1 Add a focused catalog service beside the file service keeping traversal separate from UI types, verified by unit tests against a fixture tree
- [ ] 1.2 Recursively traverse the exact project storage through the existing canonical resolver, including `.md` and `.mdx` and never following symlinks, verified by a symlink-escape test
- [ ] 1.3 Put the configured ignored-directory rules and the default hidden, dependency, and generated directories in one reusable ignore module, verified by ignore-rule tests and by absence of duplicated string logic
- [ ] 1.4 Add a direct YAML parser dependency and read only a bounded named frontmatter prefix, accepting `title` only as a non-empty string and rewriting no content, verified per title case
- [ ] 1.5 Produce a bounded diagnostic and filename fallback for malformed, non-string, or truncated titles, and configure parsing so aliases and hostile structures cannot create unbounded work, verified by hostile-input tests
- [ ] 1.6 Implement and unit-test one title-casing function for separator and common camel-case splitting, keeping canonical filename and path separate from display text
- [ ] 1.7 Return only folders leading to at least one included document, sorted folders before documents then by display title with a canonical relative-path tie-break, verified by ordering and pruning tests
- [ ] 1.8 Enforce constants for traversal depth, entries, files, inspected bytes, result bytes, duration, and cancellation, marking partial results explicitly, verified per bound
- [ ] 1.9 Register `docs.catalog` with authenticated project authorization in local and extension-backed environment composition, verified by adapter-parity and cross-project rejection tests

## 2. Client and watched tree

- [ ] 2.1 Add `DocumentationClient` with strict metadata and body validation, cancellation, pagination, and tests in client-core
- [ ] 2.2 Construct it beside the file viewer client in the shared renderer server client and expose it through the shared context used by Desktop and web, verified by a construction test
- [ ] 2.3 Add a documentation controller owning catalog state, expanded folder ids, selection, loading, error, and partial state, and one coalesced refresh timer, verified by controller tests
- [ ] 2.4 Subscribe to the project root through the file observation client, refreshing without clearing the last good tree on ordinary events and fetching a fresh catalog on overflow or resync, verified per event class
- [ ] 2.5 Cancel subscriptions and timers when project, root, server, or component changes, verified by a cleanup assertion
- [ ] 2.6 Build a separate accessible documentation tree where folder rows only toggle and document rows open the canonical path in Documentation presentation, including accessible relative-path context when title and filename differ, verified by component tests
- [ ] 2.7 Verify initial load, refresh coalescing, add, remove, retitle, retained expansion and selection, partial results, stale-request rejection, and recovery after failure

## 3. Sidebar persistence

- [ ] 3.1 Add the Documentation pane id and explicit settings fields for its default collapsed state and default height, verified by settings tests
- [ ] 3.2 Update defaults, input normalization, stored-settings normalization, the settings UI where sidebar defaults are user-editable, project creation, restored project normalization, and server workspace serialization and hydration, verified per site
- [ ] 3.3 Normalize stored settings and project snapshots that lack the Documentation pane to one collapsed pane appended exactly once without reordering existing panes, verified by a normalization test
- [ ] 3.4 Register the pane in the sidebar item map, height and change commit branches, reorder handling, and feature-unavailable rendering, adding Refresh and document count where consistent with existing pane chrome, verified by component tests
- [ ] 3.5 Persist folder expansion per project through the same state ownership model as existing expanded sidebar entries and never into project files, verified by a persistence test
- [ ] 3.6 Prove default collapse, toggle, resize, reorder, restart hydration, stored-state normalization, and independence between two projects in E2E

## 4. Canonical Documentation presentation and MDXEditor

- [ ] 4.1 Extend the file panel parameters with a presentation discriminator without adding a second panel map, verified by type and routing tests
- [ ] 4.2 Change the open-file path to find the canonical panel by project-relative identity, set the requested presentation, activate it, and preserve session, draft, and panel identity, verified by a two-entry-point test
- [ ] 4.3 Update server-owned workspace panel serialization so moves, reconnects, and native windows preserve the presentation, verified by a round-trip test
- [ ] 4.4 Add the Documentation surface inside the file panel using the existing file viewer session opened by that panel, verified by a session-identity assertion
- [ ] 4.5 Load the complete bounded UTF-8 document through existing session reads before mounting the editor, with actionable states for too large, binary, invalid encoding, disappeared path, unavailable authority, and parser failure, verified per state
- [ ] 4.6 Install and configure MDXEditor and its stylesheet once, enabling the required first-party plugins in one module rather than per render, verified by a configuration test
- [ ] 4.7 Preserve unsupported constructs losslessly through source mode or structured placeholders and surface the editor error callback, verified by a round-trip test over unsupported source
- [ ] 4.8 Add the responsive toolbar and editor and preview layout, using a non-executable preview placeholder until the runtime is available
- [ ] 4.9 Recompute tree and tab title only after the relevant draft or save revision is authoritative and never rename the underlying file on a title change, verified by a title test
- [ ] 4.10 Route project document links to Documentation presentation and Explorer opens to the normal file viewer, with external links using existing host policy, verified per link kind

## 5. Ordered one-second autosave

- [ ] 5.1 Implement autosave as an independently tested controller storing the newest text and revision and resetting one 1000 ms debounce per real editor change, ignoring the editor's initial normalization callback, verified with fake timers
- [ ] 5.2 On timer fire call the edit operation with UTF-8 bytes and the expected draft revision then the save operation with the returned draft revision and current disk revision, verified against a fake client and the real file-session adapter
- [ ] 5.3 Permit one pipeline at a time, keep only the newest pending text, run it immediately after the current pipeline settles, and prevent an older completion from marking the newer draft saved, verified by edit-during-save and stale-completion tests
- [ ] 5.4 Expose deterministic idle, dirty, saving, saved, conflict, and failed states with the corresponding surface status and accessible error details and retry, verified per state
- [ ] 5.5 Cancel the debounce and start an immediate flush on blur, presentation switch, and close, with the close path waiting for the bounded in-flight flush and preserving the server draft on failure or conflict, verified per trigger
- [ ] 5.6 Use the existing conflict reload and keep-local actions and stop automatic saving on a stale disk or draft revision until the user resolves it, verified by a conflict test
- [ ] 5.7 Cancel timers and prevent state updates after unmount without closing or discarding the shared server file session on a presentation change, verified by an unmount test
- [ ] 5.8 Add a regression test that types in normal text mode, waits longer than one second, and confirms disk content did not change

## 6. Real preview integration and end-to-end acceptance

- [ ] 6.1 Replace the placeholder with the MDX browser runtime preview host, passing compiled bytes and opaque resource callbacks only and never a host path, verified by an interface assertion
- [ ] 6.2 Keep editor and preview lifecycles separate so compile, network, and runtime failures leave editing and autosave working and expose diagnostics and restart, verified by a failure test
- [ ] 6.3 Refresh the preview on dependency watch invalidation without remounting the editor or resetting selection or draft, verified by a watch test
- [ ] 6.4 Wire validated preview open-document, external-link, resize, diagnostic, and download messages to the runtime's host actions, verified per message
- [ ] 6.5 Add one representative fixture project with nested Markdown, YAML titles, MDX importing a project component, an external asset or network call, an interactive prevented form, and an ignored directory
- [ ] 6.6 Run the Docker Electron E2E through the full user journey and confirm the runtime security assertions still pass when embedded in Documentation
