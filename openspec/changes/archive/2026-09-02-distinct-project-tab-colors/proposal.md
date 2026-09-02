## Why

Opening a second project tab often produces a colour that sits right next to the
first one on the hue wheel — a red project followed by a pinker red — so the tab
strip, panel strip, and sidebar band stop being a fast way to tell projects
apart. The default palette is 20 evenly spaced hues, but the picker walks it in
palette order from a hash of the project identity and stops at the first hue not
already taken, so neighbouring hues are the most likely outcome, not the least.

## What Changes

- Default project-tab colour selection maximises hue separation: a new project
  takes the palette hue furthest from every colour already in use in the
  workspace view, instead of the first free hue after a hash offset.
- The first project in an empty view keeps today's behaviour — an
  identity-seeded pick from the palette, so a fresh workspace still varies.
- Ties (several candidates equally far from the colours in use) resolve
  deterministically from project identity, so creation stays reproducible and
  rapid successive creation still commits distinct colours.
- Once every palette hue is taken, selection degrades gracefully: it keeps
  choosing the hue furthest from the colours in use, so repeats land as far from
  their neighbours as the palette allows rather than clustering.
- Colours the user has explicitly chosen, and colours already persisted on a
  project, are unchanged — this only affects the default assigned at creation.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities
- `workspace-and-project-tabs`: the default colour a newly created project tab
  receives must be visually distinct from the colours already in use in the
  view, not merely unused.

## Impact

- `src/workspace/projectTabModel.ts` — `getDeterministicProjectTabColor`,
  `getRandomProjectTabColor`, and the palette helpers.
- `src/workspace/useProjectCollection.ts` — unchanged call sites; it already
  passes the in-use and reserved colours that selection now needs.
- No server, protocol, persistence, or security-boundary change: colour
  selection stays in the workspace UI and the chosen colour is still committed
  atomically with the server-owned project.
- Unit tests covering default colour assignment.
