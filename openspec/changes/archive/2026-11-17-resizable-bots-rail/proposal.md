## Why

The right-hand rail in the Bots section (the overview's engine summary and
Needs you list) and in a bot tab's Chat mode (the context rail with the desktop
thumbnail, sessions and triggers) is fixed at 300 pixels. Users with wide
windows cannot give the desktop thumbnail more room, and users on narrower
windows cannot give the conversation more room (Gitea issue #614). Every other
side pane in Terminay can be resized; the Bots rail should behave the same way
and reuse the same resizer rather than introduce a new one.

## What Changes

- The Bots rail gains a resize separator on its left edge, with the same drag,
  keyboard (Arrow Left / Arrow Right, 16 pixels), preview-then-commit, and
  cancel rules as the Home Pull Requests and Issues detail preview separator.
- The chosen rail width is remembered on the device (never on the server) and
  shared by the Bots overview rail and every bot tab's context rail.
- The width is bounded (240–560 pixels, default 300), and the drawn width
  shrinks so the main column keeps at least 420 pixels.
- When the window is 860 pixels wide or narrower the rail already stacks under
  the main column; it then has no separator.
- The Pull Requests and Issues preview separator becomes a shared pane-edge
  separator component used by Forge, Bots, and the terminal workflow panel
  (which had its own copy of the same gesture code), with no behaviour change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: adds requirements for a resizable, device-remembered Bots
  rail.

## Impact

- `src/forge/ForgeDetailSeparator.tsx` moves to a shared component under
  `src/components/`; `ForgeHome.tsx` uses it.
- `src/workspace/workflows/WorkflowPanel.tsx` and `WorkflowPanel.css` use the
  shared separator instead of their own copy.
- `src/workspace/localViewState.ts` gains a `botsRail` resizable column.
- `src/workspace/bots/BotsSection.tsx`, `BotChat.tsx`, `BotContextRail.tsx`,
  `bots.css`, and a new `botsRailWidth.ts` model.
- Unit tests in `scripts/local-view-state.test.mjs` and a new bots model test;
  E2E coverage in `e2e/bots.spec.ts`.
- Renderer-only; no server, protocol, or Electron main-process change.
