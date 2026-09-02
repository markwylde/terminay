## Context

Proposal.md states the goal. Three existing systems already own most of what this
needs and must not be duplicated: the file service owns bounded traversal, ignore
handling, and typed protocol errors; the observation adapter and watch registry
own server-owned watch subscription, overflow, and resync; and the file session
adapter is the only draft, edit, save, and conflict authority. The Documentation
work is a new presentation and a new catalog over those, not a parallel stack.

## Goals / Non-Goals

Goals:

- A watched, folder-grouped document tree per project that stays correct across
  external edits, renames, watch overflow, and reconnects.
- One canonical file identity per project path, shared by the Explorer and
  Documentation entry points.
- Autosave that is deterministic, serialized, and conflict-safe.

Non-Goals:

- Executing MDX imports. That belongs to the MDX browser runtime change; this
  change consumes it.
- Changing the normal file viewer's explicit-save behaviour.
- Any Desktop-only filesystem path for documentation.

## Decisions

1. **Documentation is a sidebar pane, not a second standalone sidebar.** It joins
   the existing pane registration, resize, collapse, and reorder machinery.
2. **The server returns a bounded document catalog.** The renderer never walks
   the filesystem by repeatedly expanding Explorer directories. Traversal is a
   focused service kept separate from UI types, uses the existing canonical
   resolver, includes only `.md` and `.mdx`, and does not follow symlinks.
3. **One reusable ignore parser.** The configured ignored-directory rules used by
   folder Markdown tasks plus the default hidden, dependency, and generated
   directories live in one module rather than copied string logic.
4. **A direct YAML parser dependency, reading a bounded named prefix.** A `title`
   is accepted only as a non-empty string; malformed, non-string, or truncated
   titles produce a bounded diagnostic and a filename fallback. Parsing is
   configured so aliases and hostile structures cannot create unbounded work, and
   no content is rewritten.
5. **Display text is separate from canonical identity.** One tested title-casing
   function handles separator and common camel-case splitting; the canonical
   filename and path are never derived from display text.
6. **Invalidation reuses the existing root observation.** A watch event schedules
   one coalesced catalog refresh; overflow or resync discards incremental
   assumptions and fetches a fresh catalog. A second host watcher is introduced
   only if the existing observation contract provably cannot represent a required
   state, and that limitation is documented with a test.
7. **One canonical panel per project path.** The file panel gains a presentation
   discriminator rather than a second panel map. Opening from either surface
   finds the canonical panel by project-relative identity, sets the requested
   presentation, and preserves session, draft, and panel identity, including
   across moves, reconnects, and native windows.
8. **MDXEditor edits the server file session's bounded UTF-8 draft.** Oversized,
   binary, or invalid-UTF-8 documents show a clear unsupported state and remain
   openable in the normal file viewer.
9. **Autosave is an ordered controller around the existing edit and save
   operations.** It is not ad-hoc timeouts inside toolbar callbacks and it is not
   a second save implementation. One pipeline runs at a time; a newer pending
   text supersedes and runs immediately after the current pipeline settles; an
   older completion can never mark newer content saved.
10. **Unsupported constructs are preserved losslessly.** Source mode or
    structured placeholders keep content that cannot round-trip, and the editor's
    error callback is used rather than allowing silent normalization.

## Risks / Trade-offs

- Autosave over a shared file session risks fighting the explicit-save file
  viewer. The mitigation is an explicit regression test that types in normal text
  mode, waits longer than the debounce, and asserts disk content is unchanged.
- Frontmatter parsing is attacker-adjacent input. It is bounded by prefix length,
  restricted in parser features, and always falls back to a filename title with a
  bounded diagnostic.
- A catalog refresh that clears the tree would lose expansion and selection on
  every watch event, so ordinary refreshes keep the last good tree and only
  overflow or resync replaces it.
- Adding MDXEditor is a substantial renderer dependency. Its plugin set is
  configured once in one module rather than per render, keeping the surface
  reviewable.
- Milestones before the runtime integration use a non-executable placeholder
  preview, so the change is not complete until the real runtime is wired in.

## Migration Plan

Stored settings and project snapshots that predate the Documentation pane
normalize to exactly one collapsed Documentation pane appended once, without
reordering existing panes. Folder expansion is persisted per project through the
same state ownership model as existing expanded sidebar entries and is never
written into project files.
