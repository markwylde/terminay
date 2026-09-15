## Context

Both defects are layout-only and live in one stylesheet.

`.compact-breadcrumb` is a flex row of swatch, project name, separator,
terminal title, and chevron. Every child is sized by content, so the row's
free space collects after the last child: the chevron ends up adjacent to the
terminal title and drifts as titles change length.

`.terminal-tab-content` is the panel tab rendered by `DockTabChrome`. It had a
symmetric `padding: 0 10px`, but the trailing child is a 20px close button
drawn around a 10px glyph, so the button contributes another 5px of its own
inset. The `×` therefore sat ~15px from the tab edge against the title's 10px.
The gap is most visible on the active tab, where the solid chip makes the edge
readable.

Neither surface crosses a security or architectural boundary: this is renderer
presentation only, with no privileged call, protocol message, or host
capability involved (ADR-0011, ADR-0018).

## Goals / Non-Goals

**Goals:**

- The chevron is pinned to the breadcrumb's trailing edge.
- The close control's trailing inset matches the title's leading inset.
- Both are asserted by a test, so the alignment is a contract rather than a
  value someone re-tunes by eye.

**Non-Goals:**

- No change to truncation order, hit targets, close behaviour, or close
  protection.
- No change to the project tab strip's own close control, which has its own
  spacing and is not what either report is about.

## Decisions

- **Chevron: `margin-left: auto` rather than `justify-content: space-between`
  or a spacer element.** `auto` margin moves only the chevron and leaves the
  swatch/name/separator/title pacing and their `flex` basis untouched.
  `space-between` would redistribute space between every segment and break the
  crumb reading; a spacer element would put layout in the markup.
- **Close control: trim the container's trailing padding to 4px rather than
  give the button a negative margin.** The button keeps its full 20px target
  and its hover background stays a square around the glyph; only the container
  stops double-counting the inset. 4px container padding plus the button's 5px
  around the glyph is the 9px that reads level with the title's 10px.

## Risks / Trade-offs

- [The 4px/5px split is two numbers that must stay in step — a later change to
  the close button's box would silently unbalance the tab.] → The added test
  asserts both the container's trailing padding and the button's box, so the
  pair fails loudly instead of drifting.

## Migration Plan

None. Presentation-only; it takes effect on next render.

## Open Questions

None.
