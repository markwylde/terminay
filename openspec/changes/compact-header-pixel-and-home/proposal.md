## Why

The phone header spends two of its few slots on controls that are not used
often enough to earn them. Home is a destination like any project, yet it sits
on the row beside the breadcrumb that already opens the list of destinations.
The server glyph opens that same list a second way. Meanwhile Pixel, when it is
on, floats in the bottom-right corner over the terminal, where it covers output
and the input line.

## What Changes

- The Home control leaves the compact chrome row and becomes the first control
  in the unified switcher's toolbar.
- While Pixel is on, its dock takes the trailing slot of the compact row in
  place of the connection glyph, and Pixel is no longer docked in the corner at
  that width.
- While Pixel is off, the connection glyph stays on the trailing edge as now.
- With the glyph gone, an unreachable server or an available server upgrade is
  shown on the breadcrumb instead, so neither signal is lost.

Not changing: anything above 640px, the switcher's contents, the server list
and upgrade rows inside the switcher, and Pixel's behaviour once it is out.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the compact row loses its dashboard control,
  its trailing control is Pixel's dock while Pixel is on, and the switcher
  carries Home.
- `pixel-pet`: Pixel docks in the compact header at phone width. This delta
  must be archived after `add-agent-chat-and-pixel`, which introduces the
  capability.

## Impact

- `src/workspace/CompactChromeRow.tsx`, `src/workspace/CompactSwitcher.tsx`
- `src/pixel/Pixel.tsx`, `src/pixel/pixel.css`
- `src/App.tsx`, `src/App.css`
- `e2e/compact-chrome-switcher.spec.ts`, `e2e/pixel.spec.ts`
