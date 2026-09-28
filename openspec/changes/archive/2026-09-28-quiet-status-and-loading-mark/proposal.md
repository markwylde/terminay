## Why

The status bar's remote access indicator spells out `Exposed` or `Not exposed` next to a dot whose colour already says the same thing, so the words are noise. The loading mark draws the app icon's pure-black tile on the loading background, which reads as a dark border around the glyph.

## What Changes

- The remote access indicator shows only the dot when no devices are connected to the Desktop Local server. Device icons and the count label (`1 device`) are unchanged, as are the accessible name and tooltip.
- The loading state draws the Terminay mark as the white glyph alone, with no background tile, in the native loading document, the server UI's initial document, and the renderer's connection loading state. The packaged app icon, favicon and browser metadata keep the square black mark.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-status-bar`: the remote access indicator carries no text label when no devices are connected to the Desktop Local server.
- `connections-and-client-hosts`: the loading state mark is the glyph without its black tile.

## Impact

- `src/workspace/workspaceStatusBarModel.ts`, `src/workspace/WorkspaceStatusBar.tsx` and its test: empty label, rendered only when present.
- `electron/startupLoadingDocument.ts`, `server.html`, `src/web/main.tsx`, `src/web/index.css`: remove the black tile and its rounded clip from the loading mark.
- No protocol, security-boundary or packaging changes.
