## Why

The active project tab runs down into the panel tab strip below it so the project colour reads as one band. A project waiting on its start chooser has no panel tab strip, so the tab ran down into the empty dark workspace and looked broken.

## What Changes

- While the active project shows its start chooser, its project tab is drawn as a closed rounded pill, like an inactive tab's shape, in the active colour.
- Once the project starts and its panel tab strip exists, the tab joins the strip as before.
- The server folder browser keeps a path the person typed while its first listing was loading, instead of replacing it with the listed folder. Found when this change's CI reordered the start chooser E2E cases.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the joined chrome band requirement says the active tab joins the panel tab strip only when that strip is shown.

## Impact

- `src/App.css` — one rule keyed on the active start chooser.
- `src/workspace/RootFolderBrowser.tsx` — a landing listing fills the path field only if the person has not edited it since the last navigation.
- `e2e/project-start-chooser.spec.ts` — a case covering both states.
