## Why

Opening a project from the start chooser by keyboard takes extra steps. The search box is not focused when the chooser appears, so a person has to click or Tab to it before typing. Pressing ↓ from a recent folder lands on that folder's forget control instead of the next folder, and the focus outline covers only the folder text, not the row.

The intended flow is: ⌘P, type a query, ↓ to the first match, ↓ to the second, Enter.

## What Changes

- When the search box appears, it takes focus if focus is still on the first start or nowhere. In the compact layout it does not, so a phone's keyboard does not cover the chooser.
- The arrow keys skip forget controls and move from row to row. Tab still reaches each forget control, and the arrows from there return to the rows.
- A focused recent folder is outlined across its whole row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-start-chooser`: "Start chooser presentation" defines the arrow-key order and the row outline. "The chooser searches every recent folder" focuses the search box when it appears.

## Impact

- `src/workspace/ProjectStartChooser.tsx`: focus the search box when it appears, and take forget controls out of the arrow order.
- `src/workspace/projectStart.css`: outline the whole row.
- `scripts/project-start-chooser-ui.test.mjs`, `e2e/project-start-chooser.spec.ts`.
