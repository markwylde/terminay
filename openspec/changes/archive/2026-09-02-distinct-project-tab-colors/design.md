## Context

Project tab colours are assigned in the workspace UI. `src/workspace/projectTabModel.ts`
builds `DEFAULT_PROJECT_TAB_COLORS` as 20 evenly spaced hues (18° apart) at fixed
saturation 0.65 / lightness 0.6, and `getDeterministicProjectTabColor(identity, usedColors)`
hashes the identity (FNV-1a) into a palette index, then walks the palette in index
order until it finds an entry not in `usedColors`. Because the walk is sequential,
the colour most likely to be handed out is the immediate hue neighbour of the
starting index — a red followed by a pinker red. `useProjectCollection.ts` already
supplies the full in-use set (existing project colours plus `reservedProjectColorsRef`
for creations still in flight), so the information needed for a better choice is
already at the call site.

This change stays entirely inside the workspace UI. It crosses no privileged
boundary: the renderer picks a presentation default and the server still owns the
project record; the chosen colour is committed atomically with `createProject`,
which the existing "Atomic colour and icon commit" requirement covers. No ADR
currently in force constrains colour selection.

## Goals / Non-Goals

**Goals:**
- A newly created project's default colour is visually far from the colours
  already in use in its workspace view.
- Selection is deterministic for a given (identity, in-use set), so rapid
  successive creation and tests stay reproducible.
- Graceful, non-clustering behaviour once the palette is exhausted.

**Non-Goals:**
- Changing the palette itself (count, saturation, lightness) or the hex format.
- Recolouring existing projects, or overriding a colour a user chose.
- Moving colour selection to the server or persisting a per-view colour cursor.
- Perceptual (CIELAB/ΔE) distance. Hue distance on a fixed-S/L ring is enough
  and keeps the function pure and dependency-free.

## Decisions

**Farthest-point selection over sequential scan.** For each palette candidate,
compute the minimum circular hue distance to every in-use colour, and pick the
candidate whose minimum is largest (a max–min / farthest-point rule). With one
red in use this yields the hue ~180° away; with two in use it bisects the largest
gap, which is exactly the "spread them out" behaviour asked for.

*Alternative considered — golden-angle (137.5°) stepping from a per-view counter.*
Produces a well-spread sequence, but needs a durable per-view counter and breaks
down when projects are closed and reopened, since it does not look at what is
actually on screen. Rejected.

*Alternative considered — shuffled palette order per view.* Still allows adjacent
hues early. Rejected.

**In-use colours are matched to the palette by hue, not by string equality.**
A user-chosen colour, or a persisted colour from an older palette, will not equal
a palette entry. Distance is computed from each in-use colour's hue (parsed from
its hex, falling back to ignoring unparsable values), so custom colours still push
new defaults away from themselves.

**Ties resolve from project identity.** Several candidates are equally distant in
the common cases (an empty view; a view whose used hues are symmetric). Order the
tied candidates and index into them with the existing FNV-1a identity hash. This
preserves today's behaviour for the first project in an empty view — every
candidate ties, so the identity hash alone chooses — and keeps creation
reproducible without a mutable module-level cursor.

**Exhausted palette repeats the farthest hue.** When every palette entry is in
use, the max–min rule still returns the entry whose nearest in-use neighbour is
furthest away, so duplicates land in the sparsest region rather than clustering.
No special-case fallback path is needed, which removes the current
`hueToProjectTabColor(hash % 360)` off-palette escape hatch.

**Public surface is unchanged.** `getDeterministicProjectTabColor(identity, usedColors)`
and `getRandomProjectTabColor(usedColors)` keep their signatures, so
`createProjectTab` and both `useProjectCollection` creation paths need no edits.

## Risks / Trade-offs

- *Hue-only distance treats two colours with the same hue but different
  lightness as identical* → the palette is fixed-S/L, and user-chosen colours are
  only ever inputs to the distance, never candidates, so the effect is limited to
  pushing new defaults slightly harder away from a custom colour.
- *Determinism means two views in the same state assign the same colour* → this
  already holds today and is desirable for tests; per-view variety comes from the
  identity hash in the tie-break.
- *O(candidates × in-use) per creation* → 20 × project count, run once per project
  creation. Negligible.
- *Users who liked the previous hash-stable mapping from project index to colour
  will see different colours for new projects* → existing projects are untouched;
  only defaults assigned from now on change.

## Migration Plan

None. Colour selection runs at creation time only; persisted project colours are
read back unchanged, and there is no stored state to migrate. Rollback is
reverting the selection function.

## Open Questions

None. No in-force ADR needs revisiting.
