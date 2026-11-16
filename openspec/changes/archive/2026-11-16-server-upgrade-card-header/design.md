## Context

`ServerUpgradeProgress` is the modal card the window shows while a server
upgrade runs (`server-upgrade-progress-checklist`). Its header is
`display: flex; justify-content: space-between` holding an `h2` title and a
`p` of versions with `white-space: nowrap`. In a 340 px card the versions keep
their full width, so the title is the item that shrinks and wraps. All colours
are hard-coded for a dark appearance.

The confirmation before the upgrade is an `InPageWindow` titled
`Upgrade <server>` or `Install latest on <server>`; the shared frame already
truncates its title with an ellipsis but gives no way to read the rest.

## Goals / Non-Goals

**Goals:** a header that is one title line plus one version line for any name
and version; full text reachable for a truncated title; the card reads cleanly
in light and dark appearance; the confirmation's truncated title is readable in
full the same way.

**Non-Goals:** changing the steps, their wording, the model, or when the card is
shown; restyling the connection menu's upgrade rows; a theme setting.

## Decisions

1. **Stacked header.** The header becomes a grid of one column: the title (`h2`)
   then the versions (`p`). The title is `white-space: nowrap; overflow: hidden;
   text-overflow: ellipsis` with `min-width: 0`, and carries `title={title}` so
   the full text is a tooltip. The section's `aria-label` stays the full title,
   so assistive technology is unaffected by the visual cut. The same holds for
   all three titles (running, upgraded, not upgraded).
   *Alternative:* let the title wrap. Rejected — the issue asks for one line, and
   a two-line title moves the step list as the outcome text changes length.

2. **Versions wrap, never truncate.** The from and to versions are the facts
   the person needs to check, so they are never cut. The line is
   `overflow-wrap: anywhere` and renders `from`, a muted `→`, and `to` as
   spans; its text content stays `"<from> → <to>"` so existing assertions and
   copy behaviour hold. With either version unknown the line is not drawn, as
   before.

3. **Appearance by `prefers-color-scheme`.** The card's colours become custom
   properties on `.server-upgrade-modal`, with dark values by default (the
   workspace is dark) and light values under
   `@media (prefers-color-scheme: light)`, matching how `src/index.css` themes
   the connecting screen that this card can sit over during the restart.
   *Alternative:* CSS `light-dark()` — equivalent in Electron 45's Chromium,
   but the repository's existing appearance rules use the media query, and the
   media query is directly emulable in Playwright for screenshots.

4. **Spacing.** Width `min(380px, 100vw - 32px)`, padding 18 px 20 px, a hairline
   divider under the header, 10 px between steps with a 16 px icon column, and a
   Close button with a `:focus-visible` ring. Values chosen to match the in-page
   window's density.

5. **Shared tooltip, specified on the frame.** `InPageWindow` sets `title` on its
   heading. Every in-page window gains the tooltip, so the behaviour is specified
   in `in-page-windows` (ADR-0053's shared frame) rather than only for the
   upgrade confirmation. It only adds information when the title is cut; the
   heading's text and accessible name are unchanged.

6. **The current name.** `serverUpgradeSources` labels each upgrade source with
   its remembered profile's label when the window has one — matched by profile
   id, by server id, or, for the window's primary connection, by the profile the
   host says the window shows (`currentProfileId`, as the connection menu
   marks it) — falling back to the attached connection's label. The connection keeps the label it was opened
   under, so a rename while attached never reached the upgrade surfaces, while
   the connection menu (which lists profiles) showed it. Found by the long-name
   e2e test, which renames the connection before upgrading.

## Boundaries

All changes are renderer presentation in the server-bundled workspace UI the
window runs (ADR-0047). No protocol, server, host or privileged boundary is
crossed; the server name shown is the same client-side connection label already
rendered.

## Risks / Trade-offs

- **Native tooltips are hover-only.** Touch users and sighted keyboard-only users
  cannot reveal a cut title through `title`. Accepted: the cut part is the tail
  of the person's own connection label, which they named and which is shown in
  full in the connection menu and Manage connections; screen readers get the full
  title through the accessible name. A tap- or focus-to-reveal interaction is out
  of scope for this fix.
- A light card over the dark workspace in a light system appearance → the
  backdrop dims everything beneath, so the card reads as a dialog, as the
  connecting screen already does.
- A tooltip on every in-page window title → a harmless duplicate of visible text
  when not truncated.

## Verification

Legibility in both appearances is checked in e2e by computing each text and icon
colour's contrast ratio against the card surface (≥ 4.5:1 for text, ≥ 3:1 for
icons and the focus ring), for every step state, a failure's detail and the
Close button. Screenshots are reviewed for: title on one line, versions on the
line beneath, nothing past the card edge, and every state distinguishable.
