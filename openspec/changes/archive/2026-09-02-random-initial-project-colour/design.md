## Context

`getDeterministicProjectTabColor(identity, usedColors)` scores every palette entry
by its minimum hue distance to the colours in use and takes the furthest, breaking
ties with an FNV-1a hash of the project identity. When `usedColors` is empty every
entry scores `Infinity`, so the whole palette ties and the identity hash alone
decides. The identity is `<colorScope>:project-<n>`, and `colorScope` is the server
id with a constant `desktop-local` fallback (`src/App.tsx:5299`), so a desktop
workspace with no server connection always starts on hue 0.

Reproducibility is worth keeping wherever a colour has to agree with something
already on screen: rapid successive creation reserves colours before the server
round-trip, and tests assert exact sequences. None of that applies to the very
first colour, which has nothing to agree with.

## Goals / Non-Goals

**Goals:**
- A fresh workspace does not always start on the same hue.
- The spread and reproducibility of every subsequent colour are unchanged.
- Tests can pin the randomness.

**Non-Goals:**
- Randomising the tie-break once colours are in use. That would make rapid
  creation non-reproducible for no visible gain, since the max-min rule already
  determines the interesting part of the spread.
- Changing the palette, or seeding from machine or workspace identity — the user
  asked for genuine variety, not a different fixed value.

## Decisions

**Randomise only the empty case.** The empty set is the one call where every
candidate is equally correct, so it is the only place randomness costs nothing.
The branch is explicit — `usedHues.length === 0` returns a random palette entry —
rather than emergent from randomising ties, which keeps the reproducibility
guarantee for every other call exactly as it was.

*Alternative considered — randomise all ties.* Adds variety later too (the third
project choosing between +90 and -90), but breaks the "same project, same
workspace state, same colour" contract the existing requirement states, and makes
the reserved-colour path during rapid creation harder to reason about. Rejected.

*Alternative considered — seed the hash from a machine or install id.* Keeps full
determinism and does vary per machine, but a given machine still starts on the
same hue forever, which is the complaint. Rejected.

**The random source is a parameter, defaulting to `Math.random`.** A third
optional argument `randomSource: () => number = Math.random` lets tests pin the
sequence and keeps the function pure with respect to its inputs. No module-level
mutable state and no global seeding.

**Rename to `getProjectTabColor`.** The name asserted determinism the function no
longer has in the empty case. Leaving it would mislead the next reader at exactly
the point the subtlety lives. Three call sites move.

## Risks / Trade-offs

- *A fresh workspace can now start on a hue the user dislikes, differently each
  time* → all twenty palette entries are equally valid defaults, and the colour
  remains editable.
- *A test that asserted the first colour now needs the random source pinned* →
  the tests in this change pin it; the parameter exists for that.
- *Two fresh workspaces can still collide by chance, 1 in 20* → they are separate
  workspaces, so a shared starting hue is not visible in one tab strip.

## Migration Plan

None. Persisted colours are read back unchanged and only newly assigned first
colours differ. Rollback is reverting the empty-case branch.

## Open Questions

None. No in-force ADR needs revisiting.
