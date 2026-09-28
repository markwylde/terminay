## Context

The remote indicator's label comes from `remoteIndicatorState` in `workspaceStatusBarModel.ts`. The loading mark is drawn in three places across the startup handoff: the native loading document, the server UI's `server.html` (which used the `terminay.svg` app icon as an `<img>`), and the renderer's connection loading state.

## Goals / Non-Goals

**Goals:**
- A dot-only indicator when nothing is connected to Local, keeping the accessible name and tooltip.
- The same tile-less glyph through every stage of the loading handoff, so nothing flashes.

**Non-Goals:**
- Changing the app icon, favicon or About window mark.
- Changing the `No devices` label on non-Local servers.

## Decisions

- **Empty label, not a removed field.** `label` stays on `RemoteIndicatorState` so the connected case keeps its count; the view renders the label span only when the string is non-empty.
- **Inline the glyph in `server.html`.** The loading mark no longer depends on the app icon file, so the icon can keep its black tile for packaging and browser metadata.

## Risks / Trade-offs

- A sighted user loses the words and relies on the dot colour → the tooltip and accessible name still state the exposure state.
