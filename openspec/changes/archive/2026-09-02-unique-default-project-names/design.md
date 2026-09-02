## Context

Default project names are derived in four places today:

| Site | Scheme |
| --- | --- |
| `src/workspace/projectTabModel.ts` `createProjectTab` | `Project ${index}` from a renderer counter |
| `src/App.tsx` pending environment tab | `Project ${projectCount + 1}` |
| `src/workspace/useProjectCollection.ts` server path | `Project ${projectCount + 1}` |
| `packages/server-core/src/projectEnvironment/operations.ts` | `Project ${projectCount + 1}` |

The count-based scheme is wrong on its own terms: it reuses a number the moment
any project is closed. The counter-based scheme drifts from the count-based one,
so two entry points in the same workspace disagree. Both are computed by a caller
that cannot see the authoritative project set — the renderer sees a snapshot that
may lag, and `operations.ts` reads state before the command is applied, so two
concurrent creations read the same count.

Every one of those paths ends at the same place: the `project.create` case of the
reducer in `packages/server-core/src/workspace.ts`, which runs inside the applied
command against authoritative state. That is the only point where the full set of
existing names is known and no interleaving is possible.

## Goals / Non-Goals

**Goals:**
- No two projects are created with the same default name.
- One numbering sequence regardless of which entry point creates the project.
- Concurrent and rapid creations cannot collide.

**Non-Goals:**
- Enforcing uniqueness on `project.rename`. A user may name two projects the same
  if they want to; only the assigned default is guaranteed unique.
- Renaming existing duplicate projects. This governs creation only.
- Changing the `Project N` wording or localising it.

## Decisions

**The reducer derives the default; the command's `name` becomes optional.**
`project.create` gains `readonly name?: string`. When it is absent or blank the
reducer calls a `nextDefaultProjectName(state)` helper before `boundedName`;
otherwise the supplied name flows through `boundedName` exactly as now. Deriving
inside the reducer is what makes rapid creation safe — the state it reads already
includes every previously applied creation, so no two applications can pick the
same number even when their callers read the same stale snapshot.

*Alternative considered — a shared pure helper called by all four callers.*
Keeps the command contract unchanged but leaves the check outside the applied
command, so two creations racing on the same snapshot still collide. It also
needs the helper duplicated or a new shared package, since `server-core` and the
renderer share no module today. Rejected: it fixes the symptom, not the race.

*Alternative considered — server rejects a duplicate name and the client retries.*
Turns an ordinary action into a retry loop and would break a legitimate rename to
a duplicate. Rejected.

**Lowest unused N, not highest-plus-one.** `nextDefaultProjectName` scans existing
names for the exact pattern `Project <digits>`, collects those integers, and
returns the smallest positive integer absent from that set. Closing "Project 2"
of three frees the number, so numbering stays tidy instead of climbing forever.
Names that merely start with "Project" (a user's "Project Apollo") do not parse
as a number and never reserve one.

**Uniqueness is server-wide, not per view.** `state.projects` is the server's
whole project set, which is what the current count already used, and a name that
repeats in another window reads as just as broken to the user.

**Clients stop deriving default names.** All three renderer sites and
`operations.ts` omit the name. The optimistic pending tab in `App.tsx` keeps a
provisional local title only until the server project replaces it — it is
presentation, never identity, so a brief provisional label is not a boundary
concern.

## Risks / Trade-offs

- *A client that still sends a computed default keeps the old behaviour* →
  removing all four call sites is part of this change, and the specs describe the
  server-derived name as the contract.
- *Making `name` optional widens the command's accepted input* → the reducer still
  runs `boundedName` on anything supplied, so the stored-name contract is
  unchanged; only the "absent" case is new.
- *Scanning every project on each creation* → project counts are small and this
  runs once per creation.
- *Lowest-unused means a closed project's number reappears on a new, unrelated
  project* → this is the intended tidy numbering, and names are not identity;
  project ids are.

## Migration Plan

None. Existing projects keep their stored names, duplicates included; the change
governs names assigned from now on. Rollback is reverting the reducer and the
call sites.

## Open Questions

None. No in-force ADR needs revisiting.
