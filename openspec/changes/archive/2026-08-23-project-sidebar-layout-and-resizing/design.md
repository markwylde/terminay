## Context

See proposal.md. Existing tests did not exercise real vertical pointer resizing, title geometry, or
workspace command counts, so both defects were invisible to the suite.

The resize invariants from VS Code's `PaneView`/`SplitView` were used as design input, without
importing or recreating its general workbench framework.

## Goals / Non-Goals

Goals: one deterministic vertical layout model that keeps every pane title visible, places resize
handles at the top of the following title, and commits each completed resize exactly once.

Non-Goals: copying VS Code's full SplitView framework, adding unrelated workbench abstractions,
adding renderer persistence, or introducing global sidebar defaults as a write target.

## Decisions

1. One flat layout controller owns the ordered visible panes, container height, rendered title
   heights, expanded state, transient sizes, and preferred sizes.
2. The hard minimum for every visible pane is its measured title height. A collapsed pane has no
   body allocation. Expanded body allocations may shrink to zero when necessary to preserve every
   title.
3. One pure solver normalizes the whole stack: it reserves the complete title budget, distributes
   remaining pixels deterministically, and handles resize, restore, collapse, expansion, reorder,
   registration changes, and container changes without recursive constraints.
4. Starting a drag snapshots the rendered allocations. Movement distributes delta across the
   eligible panes on each side of the separator according to their available grow and shrink
   capacity, and never mutates canonical state.
5. Separators live in an absolute overlay, centred on the top edge of each non-first visible pane
   title. They have a compact visual rule and a reliable hit target and consume no layout pixels.
6. Preferred dimensions remain keyed by pane id. Temporary normalization does not rewrite them. A
   successful user resize updates every affected preference together; cancellation restores the
   snapshot.
7. A completed vertical resize submits one project sidebar patch containing all changed pane
   dimensions, and a completed width resize likewise submits once. Snapshot reconciliation cannot
   replace the live preview or regress a newer commit.

Title rows are measured through stable refs and observation, with relayout when a rendered height
changes and no measurement/render feedback loop. The stack and pane wrappers stay `overflow:
hidden` while each pane body keeps its own internal scrolling. Drags use pointer capture with
document and window completion safeguards, suppress text selection, and clean up listeners,
capture, and transient styles after pointer-up, cancellation, lost capture, and unmount.

Failure is bounded and recoverable: the last authoritative state is retained, the interaction ends
cleanly, the existing operation failure path is used, and a subsequent resize is permitted.

## Risks / Trade-offs

Several tempting shortcuts were explicitly rejected: debouncing the per-pointer durable update
while keeping the recursive model; independent nested split clamps or an approximate global header
constant; an outer sidebar scrollbar or clipped titles; automatic loss of a saved preference to
make a layout fit temporarily; a separator that consumes layout height or stays visually enabled
when it cannot move; persisting each affected pane in separate workspace commands; and using
source-pattern assertions as the primary evidence for resize behaviour.

The supported-host minimum-height invariant is defined explicitly, and an impossible title budget
is made explicit rather than relying on overflow or clipped content.

## Migration Plan

The governing feature specifications were updated to describe the shipped contract. Persistence
tests that expected project interaction to rewrite global Settings defaults were updated, and
source-regex resize tests were removed or replaced with geometry-exercising tests.
