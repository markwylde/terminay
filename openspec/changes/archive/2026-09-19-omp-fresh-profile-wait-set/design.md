## Context

Discovery is driven by directory watches: a provider's `not-bound` names the
directories whose change should re-run observation, and the host opens no
watch and no timer for a result that names nothing. The omp provider named
its sessions root as a tree and its breadcrumb directory shallowly, but only
when they existed. A fresh profile has neither until omp writes the first
one, so the first omp launch on a clean machine named nothing and discovery
ended for that incarnation.

The wait set is built from directory handles the terminal context's file
observation broker issued, and only from those. Walking up to an ancestor
asks the same broker for shallower home-relative or environment-relative
paths; every handle still comes from the broker, still lives beneath the
terminal's own home or declared environment root, and still resolves to a
canonical directory the host registered. No boundary moves.

## Goals / Non-Goals

**Goals:**

- A first-run omp binds without the terminal being reopened.
- Nothing wider than needed is watched.

**Non-Goals:**

- Changing how the host watches or damps re-observation.
- Other providers. The helpers are available to them, but their wait sets
  are their own changes.

## Decisions

**Ancestors are watched shallowly; only the real sessions root is a tree.**
The first version of this change wrapped whatever the ancestor walk
returned in a tree watch. For a home with no `.omp` yet that is a recursive
watch on the whole home directory, which is exactly the cost the watch-driven
design exists to avoid. A shallow watch on the ancestor is enough: the entry
that creates the next segment changes that directory, observation re-runs,
and the wait set moves one level deeper. The tree watch is used only once the
sessions root itself exists, as before.

**The walk ends at the home directory or the variable's root, not at
nothing.** A home with no omp directory at all is still watched, shallowly,
because that is where `.omp` will appear. The broker already accepts `.` as a
home-relative directory.

## Risks / Trade-offs

- A profile whose directories appear one level per omp write costs one
  re-observation per level. That is a handful of runs on first launch and
  nothing afterwards.
