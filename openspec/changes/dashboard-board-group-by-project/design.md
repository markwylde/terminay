## Context

`dashboard-views-and-agent-detail` gave Home three arrangements of one model.
The Board builds `DashboardBoardItem`s — one per root agent, one per agent-free
panel — and buckets them into four columns with `groupBoardItemsByColumn`. Each
item already carries its project and server, so grouping by project needs no
new data, only a second bucketing.

In-force ADRs that constrain this: ADR-0018 (the dashboard is host-neutral
workspace-bundle code; per-device hints live in this origin's `localStorage`),
ADR-0017 (every project keeps the server that owns it; nothing merges across
servers), ADR-0011 (the renderer is untrusted; no new privileged call).

## Goals / Non-Goals

**Goals:**

- See the four status columns and the project grouping at the same time.
- Grouping is a re-arrangement: the same cards, none added, none lost.
- The preference survives a reconnect on the device that set it.

**Non-Goals:**

- A fourth view mode. Grouping refines the Board; it is not a peer of List,
  Board, and Projects, and the spec's "exactly three view modes" stays true.
- Collapsing lanes, reordering lanes, or dragging cards between them. The
  dashboard carries no action but activation.
- Showing a lane for a project with nothing in any column. The inventory views
  own "never omit a project"; the Board is a triage view either way.

## Decisions

### Swimlanes, not groups inside columns

Lanes run across all four columns, with the column names stated once above
them. The alternative — project sub-headings inside each tall column — keeps
today's layout but scatters one project over four places, which is the problem
being solved. Mark chose swimlanes when asked.

### Lanes are built from the existing items

`buildDashboardBoardLanes` calls `buildDashboardBoardItems` per project group
and `groupBoardItemsByColumn` on the result. There is one rule for what a card
is, so the grouped and ungrouped Board cannot disagree about it. Lanes keep the
order groups arrive in, which is the window's tab order per server, and are
keyed by the server-scoped group key, so two servers with equal project ids
stay two lanes (ADR-0017).

### A checkbox beside the mode switcher, only on the Board

The control has no meaning in List or Projects, so it is not rendered there. It
is a native checkbox in a label, which is keyboard-reachable for free.

### Remembered as its own per-device hint

A separate `localStorage` key beside the view-mode key, read as `=== 'true'` so
anything unreadable is the ungrouped Board. It crosses no boundary: nothing is
written to server-owned workspace state, and no protocol message is added
(ADR-0018).

### Narrow windows

Below 900px four cells do not fit side by side. The shared column header is
hidden, each cell shows its own column name, cells reflow to two and then one
per row, and an empty cell is hidden. No card is ever hidden.

## Risks / Trade-offs

- Many projects make a tall Board that scrolls as one surface, where the
  ungrouped columns scroll independently. Accepted: the header row is sticky,
  and the ungrouped Board is one click away.
