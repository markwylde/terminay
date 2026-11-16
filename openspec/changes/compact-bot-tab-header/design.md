## Context

`BotTab` renders `.bots-ahead` as one flex row with fixed-width children and a
`flex: 1; min-width: 0` name column. Below about 600px the fixed children take
all the width, the name column shrinks to zero, and its unclipped `<b>` paints
over the status chip.

## Goals / Non-Goals

- Goal: a header that fits a phone, with every action still reachable.
- Non-goal: changing the wide header's layout or controls (beyond truncating
  the name), what any action does, or the chat body.

## Decisions

- **Container query on the tab, not a viewport media query.** The tab sets
  `container: bot-tab / inline-size` and the compact rules apply at
  `(max-width: 600px)`. A bot tab in a narrow split on a wide window has the
  same problem as a phone, so it gets the same header.
- **Both layouts are rendered; CSS picks one.** The wide controls and the
  settings button are siblings and the container query hides one of them.
  This needs no resize observer and no JS width state, and the mode buttons
  keep their existing `data-terminay-bot-mode-button` hooks.
- **The settings menu is a small popover inside the header, not
  `ContextMenu`.** `ContextMenu` portals to the document body with fixed
  coordinates and has no menu roles or focus handling. A popover positioned
  absolutely under the button lives inside the header, so the container query
  that hides the button also hides the menu, and it scrolls and resizes with
  the tab. It also closes when the layout widens, when the tab is hidden, on
  Escape, and on a pointer press outside it.
- **The menu is an ARIA menu.** The button is named "Bot settings" and carries
  `aria-haspopup="menu"` and `aria-expanded`. The menu has `role="menu"`;
  Chat and Configure are `menuitemradio` with `aria-checked` and a check mark
  on the current one; Enable bot or Disable bot is a `menuitem` after a
  separator, present only when the server supports sources. Opening focuses
  the checked mode; ArrowUp, ArrowDown, Home and End move focus; Escape closes
  and returns focus to the button; choosing an item closes the menu and
  returns focus to the button.
- **The status chip is visually hidden unless the bot is disabled.** The
  avatar's dot shows activity, so a "Stopped" or "Working" chip repeats it; it
  stays in the accessibility tree because the avatar is `aria-hidden`. The dot
  does not show availability, so a "Disabled" chip stays visible.
- **The name truncates at every width.** `<b>` gets `overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap`, which also fixes the overlap
  on mid-width windows.

## Risks / Trade-offs

- Switching modes on a phone takes two presses instead of one. The user picked
  this in exchange for a readable header.
- Narrow users lose the visible activity label and rely on the dot's colour.
  The user chose this; the label is still announced.
