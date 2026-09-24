## Context

Both the ungrouped and the grouped Board render their columns by iterating `DASHBOARD_BOARD_COLUMNS` in `src/workspace/dashboardViewMode.ts` (column headers, grouped column headers, and per-lane cells in `WorkspaceDashboard.tsx`). Classification (`boardColumnFor`) and the column keys are independent of that order. The requirements being modified are introduced by the unarchived `dashboard-views-and-agent-detail` and `dashboard-board-group-by-project` changes.

## Goals / Non-Goals

**Goals:**
- Board columns read Idle, Working, Needs you, Done in both the ungrouped and grouped Board.

**Non-Goals:**
- Renaming the "Needs you" column, re-classifying any state, or changing the column keys and `data-terminay-dashboard-column` values.
- Reordering the header summary chips, the List, or the Projects view.
- Making column order user-configurable.

## Decisions

- **Reorder the one constant.** Change `DASHBOARD_BOARD_COLUMNS` to `['idle', 'working', 'attention', 'done']`. Every Board surface already derives its order from it, so header and lanes cannot drift. Alternative — a CSS `order` on columns — was rejected: it splits visual and DOM/keyboard order, which harms screen readers and tab order.
- **Keep the "Needs you" label.** The request wrote "Needs Me"; the label is addressed to the user and matches the "need you" summary chip, so it stays.
- **Archive ordering.** This change's delta MODIFIES requirements that exist only in the two dashboard changes above. It is archived after both, so the MODIFIED headers resolve against the main spec.

No security or process boundary is crossed; this is renderer-only presentation.

## Risks / Trade-offs

- [This change archives before its prerequisites] → Archive fails because the MODIFIED requirements are not yet in the main spec. Mitigation: tasks require archiving both prerequisite changes first.
- [Users used to "Needs you" on the left lose muscle memory] → Accepted; the header chip still leads with "need you" for at-a-glance attention.
