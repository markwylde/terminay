## Context

The main process owns one zoom level and publishes it as the replayable `terminal.zoom` host event. Only `TerminalPanel` subscribed, so the Documentation editor never saw it.

## Goals / Non-Goals

**Goals:**
- Each zoom step grows Documentation text by the same proportion it grows a default-sized terminal.

**Non-Goals:**
- Zooming editor toolbars, file chrome, or embedded MDX widgets, which keep fixed pixel sizes.
- Per-surface zoom levels.

## Decisions

- **Reuse `terminal.zoom`.** The event is already replayed to late subscribers, so a newly opened document starts at the current level without new IPC.
- **Scale, not offset.** A terminal step adds 1px to a 13px base; the canvas multiplies its base size by `(13 + level) / 13` through a `--documentation-zoom` custom property, keeping the same relative growth at the canvas's larger base. The helper shares the terminal's clamp so both surfaces stop at the same minimum.
- **Font size, not CSS `zoom`.** Scaling font size keeps Lexical and CodeMirror caret and selection geometry exact.

## Risks / Trade-offs

- Embedded MDX widgets do not grow with the text around them → acceptable; they are fixed-size previews.
