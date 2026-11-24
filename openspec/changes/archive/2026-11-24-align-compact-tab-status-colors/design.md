## Context

The desktop status colours live in `AgentStatusIndicator.css` as literals:
working `#e8b931`, attention `#ee6258`, done `#45c874`, idle `#77818c`. Bots
repeat the same values in `bots.css`. The compact section page kit
(`compactSection.css`, added with the phone review) declares its own palette.
That palette maps `--c-accent` (blue `#4db5ff`) to working,
`--c-attention` (amber `#f2b44c`) to needs-you and `--c-done` (`#4cc38a`) to
done. `TabsCompactRow` draws a `StatusMark` from that palette. The result
contradicts the agent-status contract, which requires working to be amber and
waiting to be red.

No privilege, process or security boundary is crossed: this is renderer CSS
plus one component swap.

## Goals / Non-Goals

**Goals:**
- Tabs rows on phones show exactly the desktop indicator.
- Every compact status colour comes from the same source as desktop.

**Non-Goals:**
- Changing the desktop colours themselves.
- Restyling non-status accents (selected tab underline, links, info chips).
- Bot-specific text tints (`--bots-work`, `--bots-need`, …) that are lighter
  shades for text, not status dots.

## Decisions

1. **Shared status properties on `:root`.** `AgentStatusIndicator.css`
   declares `--status-working`, `--status-attention`, `--status-done` and
   `--status-idle`, and its state classes read them. `bots.css` aliases its
   `--bots-*-dot` properties to them, so bot avatars share the source. Bundling the CSS with the
   component guarantees the properties exist wherever the indicator does.
   *Alternative:* copy the hex values into `compactSection.css`. Rejected,
   because a copy is exactly how the two drifted.
2. **Tabs rows render `AgentStatusIndicator`.** The row draws the same
   component as the desktop dashboard (`showIdle`, `size="medium"`), so size,
   glyph, colours and breathing match the desktop card (cards use `medium`;
   the desktop list row uses `small`, so the card is the reference). Untracked
   rows show the kind icon, matching the desktop card, which shows no indicator
   for untracked items. Idle rows without an agent keep the kind icon they
   already show, so the row still says what kind of panel it is. *Alternative:* restyle `StatusMark`. Rejected for Tabs, because two
   implementations of one indicator drift again.
3. **The compact kit maps its tones to the shared properties.** In
   `compactSection.css`, `--c-attention` maps to `--status-attention` and
   `--c-done` to `--status-done`. New `--c-working` and `--c-idle` map to
   `--status-working` and `--status-idle`; `crow__mark--idle` uses
   `--c-idle`. `--c-muted` stays for ordinary muted text. `crow__mark--working` and `crow__chip--working` use
   `--c-working`. Tinted backgrounds use `color-mix` with the token instead of
   hard-coded rgba. `crow__mark--working` breathes with the indicator's
   keyframes and respects `prefers-reduced-motion`. `--c-accent` stays blue for
   non-status UI.

4. **Semantics stay with each page.** Pages already map failed and
   interrupted outcomes to `attention` and success to `done`. Those mappings
   are kept and now render red and green. A queued bot's chip moves from
   `working` to `info`, matching its blue "starting" avatar dot on desktop.

## Risks / Trade-offs

- [Other compact pages pick up red for "needs you" where amber was used] →
  This is intended, because desktop uses red for those items. Each page is
  checked visually.
- [The `@keyframes` are defined in `AgentStatusIndicator.css`] → the compact
  kit already loads alongside the dashboard, which imports the indicator. The
  kit also imports the CSS explicitly through `CompactRow.tsx`, so it does not
  depend on load order.

## Open Questions

_None._
