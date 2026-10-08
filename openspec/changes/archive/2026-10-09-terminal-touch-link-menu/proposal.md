## Why

On a phone or in the installed PWA, tapping a terminal link opens it straight
away. A stray tap while reading output navigates away, and there is no way to
copy a link or its text on touch. The PWA also opens every link in an in-app
browser sheet rather than the user's own browser, where their sessions and
passwords live.

## What Changes

- A touch tap on a terminal link shows a link menu instead of opening it:
  **Copy Text**, **Copy Link**, **Open Link**, and, on iOS and Android,
  **Open in Browser**.
- **Copy Text** copies the link's visible text, which differs from the URL for
  an OSC-8 hyperlink. **Copy Link** copies the URL.
- **Open Link** opens the URL as a tap does today.
- **Open in Browser** hands the URL to the platform browser app through its
  URL scheme (`x-safari-https://` on iOS, a Chrome `intent://` on Android),
  escaping the PWA's in-app sheet. This is best effort: neither scheme is a
  web standard.
- A tap on a link no longer raises the software keyboard.
- Mouse and trackpad behaviour is unchanged: modifier-click opens, and
  right-click keeps its Copy Link item.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: "Terminal link and input safety" gains the touch link
  menu.

## Impact

- `src/components/terminalLinkInteraction.ts` — touch activation no longer
  opens; adds the platform browser-handoff URL builder.
- `src/components/terminalTouchSelectionInteraction.ts` — the tap link lookup
  reports whether it found a link.
- `src/components/TerminalPanel.tsx` — tracks the hovered link's visible text
  and renders the touch link menu.
- `scripts/terminal-link-interaction.test.mjs`,
  `scripts/terminal-touch-selection-and-links.test.mjs` — cover the above.
- No protocol, server, or privileged surface is touched.
