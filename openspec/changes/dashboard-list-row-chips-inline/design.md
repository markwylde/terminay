## Context

`.workspace-dashboard__row--panel` is a CSS grid with
`grid-template-columns: 14px 3px 15px minmax(0, auto) minmax(0, 1fr)` and a
fixed `height: 28px`. `PanelRow` renders up to seven children: the status
indicator, swatch, kind icon, title, detail, `WorktreeChips` and the server
label. Children past the fifth go to an implicit grid row, starting again in
the 14px status column. They overflow below the row, and the chip's text is
cut to its first letters. Cards (Board and Projects) are flex columns and are
unaffected. The bug appeared once dashboard chips shipped (e3edfd09) and a
folder's worktree had a pull request.

This is renderer CSS only. No privilege or process boundary is crossed.

## Goals / Non-Goals

**Goals:** chips and the server label stay on the row's line, whatever
combination of detail, chips and server a row has. The detail, then the
title, shrink before the chips are clipped.

**Non-Goals:** changing the chips' content, or changing the cards and the
compact Tabs page.

## Decisions

1. **Give every cell a fixed column.** The template becomes
   `14px 3px 15px minmax(0, auto) minmax(0, 1fr) auto auto`, and the detail,
   worktree chips and server label are placed explicitly in columns 5, 6 and
   7 (`grid-column`). Every child keeps its intended sizing whether or not
   the cells before it are rendered. The detail stays the flexible track and
   surrenders width first; the title (`minmax(0, auto)`) gives way next. Empty
   `auto` tracks are zero wide; only their 7px gaps remain, at the row's end.
   *Alternative:* `grid-auto-flow: column` with implicit columns. Rejected:
   with no detail, the chips would fall into the flexible detail track and
   the server label into the chips' place, so sizing would depend on which
   children happen to render.
2. **Chips are never clipped.** On a List row the worktree container gets
   `min-width: max-content` and `overflow: visible`, so its `auto` track is at
   least as wide as its chips. The server label is a short connection name
   with `white-space: nowrap`, and sits in its own `auto` track. This keeps
   "Rows are single unwrapped lines": the detail and title truncate with an
   ellipsis, and the facts stay whole.

## Risks / Trade-offs

- [Very long detail on a narrow window] → the detail is `minmax(0, 1fr)` with
  an ellipsis, so it shrinks to zero before the chips are squeezed.
- [Extremely narrow window with long title and both chips] → the title
  truncates to its ellipsis. The row stays one line, and the list's existing
  horizontal clipping applies only past that point.
- [E2E cannot easily seed a real forge pull request] → the layout test adds a
  chip element to a real dashboard row and measures it. That exercises the
  CSS contract, which is what this change alters; the chips' data path is
  unchanged.

## Open Questions

_None._
