## Why

Two pieces of tab chrome read as misaligned. On a phone the breadcrumb's
disclosure chevron floats immediately after the terminal title instead of
sitting on the pill's trailing edge, so it does not look like the dropdown
affordance it is, and it moves as titles change length. On a panel tab the
close control sits further from the tab's trailing edge than the title sits
from the leading edge, which reads as a stray gap after the `×`.

## What Changes

- The compact breadcrumb's disclosure chevron is pinned to the trailing edge of
  the pill. The project and terminal segments take the slack and keep the
  truncation order they already have.
- A panel tab's close control sits at the tab's trailing edge, inset to match
  the title's leading inset, so the `×` is optically balanced with the label.
- No behaviour changes: nothing new opens, closes, or moves.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: two added presentation requirements covering
  where the compact breadcrumb's chevron and a panel tab's close control sit.
  Written as ADDED requirements so they do not restate the compact-bar
  requirement that `compact-command-bar-entry` and `compact-switcher-close`
  are still carrying as unarchived deltas.

## Impact

- `src/App.css` — `.compact-breadcrumb__chevron` trailing placement and
  `.terminal-tab-content` trailing inset.
- `scripts/tab-chrome-trailing-alignment.test.mjs` — asserts both placements.
- `package.json` — the new suite joins `npm run smoke`.
- No renderer logic, protocol, or privileged surface is touched.
