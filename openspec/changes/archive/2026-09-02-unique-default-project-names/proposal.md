## Why

Two project tabs regularly end up with the same name — a workspace showing
"Project 2", "Project 2", "Project 3", "Project 4" — so the tab strip and the
project switcher stop identifying projects. Default names are derived in four
places from three different schemes, and two of them use
`Object.keys(projects).length + 1`, which reuses a number as soon as any project
is closed: close "Project 2" of three, and the next project is named "Project 3"
alongside the existing one.

## What Changes

- The server assigns default project names and guarantees they do not collide:
  a new project takes the lowest positive `Project N` no existing project holds.
- `name` becomes optional on the `project.create` workspace command. When it is
  absent or blank the server derives the unique default; when a client supplies
  a name it is honoured unchanged.
- The three client-side default-name derivations stop computing a name and let
  the server decide, so the schemes cannot drift apart again.
- A name a user types, including one that duplicates another project, is still
  accepted. Uniqueness applies to the assigned default, not to renaming.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities
- `workspace-and-project-tabs`: a newly created project's default name must be
  unique among existing projects.
- `server-owned-workspace-state`: `project.create` accepts an absent name and the
  server derives the default.

## Impact

- `packages/server-core/src/workspace.ts` — `project.create` command type and
  reducer.
- `packages/server-core/src/projectEnvironment/operations.ts` — stops computing
  a name.
- `src/workspace/useProjectCollection.ts`, `src/App.tsx`,
  `src/workspace/projectTabModel.ts` — client default-name derivations.
- No security-boundary change: naming already ran through the server-owned
  workspace command, and this moves derivation to the side that holds the
  authoritative project set.
