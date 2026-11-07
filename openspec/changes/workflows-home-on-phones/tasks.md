## 1. Narrow detection

- [x] 1.1 Measure the section's width with a `ResizeObserver` in `WorkflowsHome.tsx` and add `workflows-home--compact` at 600px or less (verified by 4.1 at 600px and 601px Home tab widths in a wide window, and at phone width)

## 2. Toolbar

- [x] 2.1 While compact, render the full-width text filter and status chips, then a View options disclosure button (`aria-expanded`, collapsed whenever the section mounts, visible and accessible "changed" mark when the view is not the default) that reveals the project filter, grouping, sort, notes, Show finished and Reset view (verified by 4.1)
- [x] 2.2 While compact, do not render the layout control or Narrow columns, and never write the view because of compactness (verified by 4.1's round trip through narrow, including a reload, keeping Project/Rows/Narrow columns)
- [x] 2.3 Give compact toolbar controls, project menu items, and column open and fold buttons a 36px minimum height (verified by 4.1 measuring bounding boxes)

## 3. Stacked layout

- [x] 3.1 Under `.workflows-home--compact`, make the section the single vertical scroll owner and stack columns and groups at full width with no fixed column height and no inner step-list scroll (verified by 4.1: column width equals body width, section `scrollWidth <= clientWidth`, the last step of a long workflow is reached by scrolling the section, and no column or step list has `scrollHeight > clientHeight`, ungrouped and grouped Side by side and Rows)

## 4. Verification

- [x] 4.1 Extend `e2e/home-workflows.spec.ts` with phone-width tests covering every scenario in the delta spec, including a short-screen check that Reset view is reachable with View options open, run through `npm run test:e2e`
- [x] 4.2 Capture phone-width screenshots (default, View options open, grouped) and a desktop screenshot showing the wide layout is unchanged
- [x] 4.3 `npm run lint`, `npm run typecheck:workspaces`, and `npm run test:workflow-ui` pass; `openspec validate workflows-home-on-phones --type change` passes (the seven other changes that fail `openspec validate --all` on main are pre-existing and out of scope)
