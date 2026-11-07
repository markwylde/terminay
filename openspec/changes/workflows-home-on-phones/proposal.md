## Why

On a phone, Home's Workflows section is hard to use. The toolbar's options wrap into a block that fills half the screen before a single workflow is visible, and the workflows sit in a sideways row of fixed-width columns, so one column shows with a sliver of the next cut off at the screen edge and every step list scrolls inside a box. The section was laid out for a desktop window and nothing changes when it is narrow.

## What Changes

- When the Workflows section is narrow (phone width, or a narrow Home tab), workflows are stacked one above another at the full width of the section and the section scrolls vertically. Groups stack the same way, with their workflows stacked inside them; Side by side and Rows look the same there, so the layout control is not offered.
- When narrow, the toolbar keeps the text filter (full width) and the status chips on screen, and folds the project filter, grouping, sort, notes, Show finished and Reset view behind one **View options** control. The control says when the view differs from the default. **Narrow columns** is not offered while narrow, because a stacked workflow already takes the full width.
- When narrow, the section scrolls as one page (header, toolbar, workflows), and toolbar, project filter, open and fold controls are at least 36px tall.
- No stored view option changes meaning; the device's remembered view is used unchanged at any width.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: adds requirements for when the Workflows section is narrow and how it stacks, folds its toolbar, sizes controls, and leaves the stored view alone; qualifies "Workflows section lists the window's workflows", "Workflows group layout" and "Workflows density" so the sideways row, layout choice and Narrow columns apply only when not narrow.

## Impact

- `src/workspace/workflows/WorkflowsHome.tsx` and `WorkflowsHome.css` (renderer only; no preload, server, or storage change).
- `e2e/home-workflows.spec.ts` gains narrow-width coverage.
