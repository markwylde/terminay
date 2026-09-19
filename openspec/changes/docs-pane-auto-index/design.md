## Context

The Documentation pane is fed by `DocumentationCatalogController`, created by
`useDocumentationController` and gated on `enabled: !project.isDocumentationPaneCollapsed`
(`src/App.tsx`). Two consequences follow from that single flag:

- A project whose stored `isDocumentationPaneCollapsed` is `true` — the normalized
  default — shows an empty, countless pane until the user clicks it open.
- Collapsing the pane, or switching to another sidebar group while the catalog is
  still being built, flips `enabled` to `false`, which disposes the controller,
  cancels the `docs.catalog` paging loop, and drops the root watch subscription.
  The next visit starts from nothing.

The catalog query itself is already server-owned and bounded (ADR-0020's
per-operation canonical root; discovery runs on the project's environment adapter,
never in the renderer). Terminay's own tree — 1020 documents — completes in well
under a second, so the work does not need progressive rendering; it needs to not
be thrown away, and it needs to be visible while it runs.

Answers recorded from `questionnaires/scope.yaml`: auto-expand on the first visit
per app session; indexing starts on that first visit and then lives for the
project; stop discards the run and keeps the previously loaded catalog.

## Goals / Non-Goals

**Goals:**

- The document tree is on screen, populated, one click after opening a project's
  Documentation sidebar group.
- An in-flight index is decoupled from pane visibility: sidebar group switches,
  sidebar hiding, and pane collapse do not cancel it.
- Indexing is visible and interruptible from the pane header.

**Non-Goals:**

- No change to `docs.catalog`, its bounds, paging, or the server-side discovery
  contract. This change is entirely renderer-side.
- No eager indexing at project open. A project whose Documentation group is never
  visited does no discovery work and opens no root watch for it.
- No progressive/streaming tree rendering, and no persisted catalog cache across
  app sessions.

## Decisions

**Auto-expand is session-scoped state, not persisted state.** The renderer keeps a
module-level set of project ids that have already been auto-expanded, living for
the lifetime of the workspace bundle instance. Selecting the Documentation sidebar
group for a project not in that set adds it and, if the pane is collapsed, patches
`isDocumentationPaneCollapsed: false` through the existing `onUpdateProject` path.
A subsequent manual collapse is therefore respected for the rest of the session,
and a reload expands again.

_Alternative rejected — force-expand on every visit:_ simplest, but it makes the
persisted collapse state unreachable; a user who wants the pane shut cannot keep
it shut. _Alternative rejected — a new persisted "auto-expanded once" project
field:_ it makes a transient UI nicety into server-owned workspace state and a
schema migration, for no behaviour the session-scoped set does not already give.

**Indexing enablement latches per project, and is separate from pane collapse.**
`useDocumentationController`'s `enabled` becomes a latch held in the project
workspace component: `false` until the Documentation group is first shown for that
project, then `true` for as long as that project component is mounted. The
component stays mounted across sidebar group switches, sidebar hiding, and pane
collapse, so the controller, its paging loop, and its root watch subscription all
survive them. The existing teardown on `client`, `projectId`, `scopeKey`, or
`observationClient` change is unchanged, which keeps the spec's "project, root, or
server changes" cancellation and ADR-0020's per-operation root discipline intact.

_Alternative rejected — hoisting the controller into a project-keyed registry
outside React:_ it would also survive the project tab being unmounted, which is
exactly the lifetime we do not want; a background index has no reason to outlive
the project tab it belongs to.

**Stop is a request-generation bump, not an abort signal.** `DocumentationCatalogController`
gains `stop()`: clear any pending coalesced timer, increment `requestId`, set
`loading` to `false`, and emit. The paging loop already re-checks
`request !== this.requestId` after every page and after the `catch`, so the
in-flight response is dropped rather than applied and `finally` cannot flip
`loading` back on. `catalogValue` is left untouched, so the last good tree — or an
empty tree when none had loaded — remains on screen, matching the answered
`stop_semantics`.

The root watch subscription is deliberately **not** torn down by `stop()`: it is
the mechanism ADR-0022 requires in place of polling, and losing it would leave the
tree silently stale. A watch event after a stop schedules a fresh coalesced
refresh, which is the correct response to the tree having actually changed.

**The header trades one control for two.** The pane's `actions` slot renders the
refresh button when idle, and a spinning progress indicator plus a stop button
while `loading` is true. Both new controls carry `aria-label`s
("Documentation indexing" / "Stop indexing documentation"), so the pane header
stays operable and announceable; the refresh button keeps its current label. The
count badge keeps showing the last known document count during a build rather than
blanking.

## Risks / Trade-offs

- [A stopped index restarts on the next watch event] → Accepted, and correct under
  ADR-0022: the alternative is a tree that is knowingly wrong with no way to
  notice. A user who stops a build on a huge tree and then edits a file will see
  it index again; the stop button remains available.
- [Auto-expanding overrides a collapse the user made in a previous session] → This
  is the answered decision. The pane is the only member of its sidebar group, so a
  collapsed pane there is an empty panel rather than a space saving.
- [Latched enablement keeps a root watch open for the project's lifetime once the
  group is visited] → One subscription per project, reusing the existing Explorer
  observation contract and no extra child processes, so ADR-0021's idle-cost
  measure is unaffected.
- [`loading` is also true for watch-driven refreshes] → The spinner and stop
  button will briefly appear during ordinary coalesced refreshes. That is honest
  reporting of a build in flight, and the 150 ms coalescing window keeps it rare.

## Migration Plan

None. Renderer-only behaviour change with no persisted schema, protocol, or
stored-state change; no rollback step beyond reverting the commit.

## Open Questions

None. No in-force ADR needs revisiting for this change.
