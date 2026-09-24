## Why

The macOS About panel is the stock one: icon, name, version, copyright. It says
nothing about who makes Terminay, that it is open source, or where to find it,
and it looks nothing like the rest of the product. Windows and Linux have no
About entry at all.

## What Changes

- **About Terminay** opens Terminay's own About window instead of the native
  panel. On macOS it stays in the application menu; on Windows and Linux it is
  added to the Help menu.
- The window shows the logo, name, and running version over a quiet, slowly
  drifting line artwork in the five loading-spinner colours.
- It says Terminay is made by Mark Wylde, is open source under the GNU AGPL
  (v3.0 or later), and is built with a love for open source.
- It links to terminay.com, the GitHub repository, and the licence. Links open
  in the default browser; the window itself never navigates.
- Choosing About again while it is open focuses the open window.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds the About window.

## Impact

- `electron/aboutWindowDocument.ts`: the script-free About document and its
  link allowlist.
- `electron/main.ts`: the menu items and the window.
- `scripts/about-window-document.test.mjs`: document and allowlist tests.
