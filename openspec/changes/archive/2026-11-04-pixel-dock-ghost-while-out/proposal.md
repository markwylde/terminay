## Why

When Pixel leaps out of its dock, the dock still shows a full Pixel icon, so
the workspace appears to hold two Pixels at once. The dock should read as
Pixel's empty home while Pixel is out.

## What Changes

- While Pixel is out of its dock, from the moment it leaps out until it has
  landed back, the dock shows a dim, ghosted Pixel icon.
- Once Pixel is back in its dock, the dock shows the full icon again.
- This applies to every dock: the status bar, the corner, and the compact
  header.

Not changing: the dock's working and attention badge, its accessible name, or
what activating it does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pixel-pet`: the dock ghosts its icon while Pixel is out. This delta must be
  archived after `add-agent-chat-and-pixel`, which introduces the capability.

## Impact

- `src/pixel/Pixel.tsx`, `src/pixel/pixel.css`
- `e2e/pixel.spec.ts`
