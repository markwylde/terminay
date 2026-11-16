## Why

The card that follows a server upgrade (Gitea issue #587) looks broken: its
title, "Upgrading Pop Terminay", wraps onto two lines while the version change,
"6.10.0-main.3420.canary → canary", is squeezed onto the same line beside it.
The card is the only thing on screen for the length of an upgrade, so it has to
read cleanly at a glance, with any server name and any version string, in both
light and dark appearance.

The cause is technical and small: the card's header lays the title and the
versions out as one row pushed apart, the versions refuse to wrap, and the card
has fixed dark colours.

## What Changes

- The card's header stacks two lines: the title on one line, then the from → to
  versions underneath as secondary text. With either version unknown, the
  version line is left out, as today.
- A title too long for the card — while running, upgraded or not upgraded — is
  cut with an ellipsis and its full text is given as a tooltip. The card's
  accessible name stays the full title.
- Long version strings wrap within their own line instead of widening or
  overflowing the card; the arrow between them is muted.
- The card's width, padding, spacing, step list and Close button (now with a
  visible focus ring) are retuned, and its colours follow the light or dark
  appearance in force.
- The shared in-page window frame gives its title, which it already cuts with an
  ellipsis, a full-text tooltip. The server-upgrade confirmation ("Upgrade
  <server>" and "Install latest on <server>") is drawn in that frame, so both
  upgrade surfaces treat a long server name alike.

- The upgrade surfaces name the server by its connection's current name. A
  connection renamed while attached kept its old name (often a bare host and
  port) in the confirmation, card and outcome, though the connection menu
  showed the new one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: adds requirements for the server-upgrade
  card's header, its appearance, and the confirmation's title.
- `in-page-windows`: adds a requirement that a window title stays on one line and
  offers its full text as a tooltip when cut.

## Impact

- `src/workspace/ServerUpgradeProgress.tsx` — header markup.
- `src/web/connectedRendererWorkspace.css` — card and backdrop styles, light and
  dark tokens.
- `src/shared/inPageWindow/InPageWindow.tsx` — the title is also its tooltip.
- `scripts/server-upgrade-ui.test.mjs` — header markup assertions.
- `e2e/server-upgrade.spec.ts` — layout and appearance assertions, and
  screenshots with short and long names in both appearances.
- No protocol, server, host, or privilege change.
