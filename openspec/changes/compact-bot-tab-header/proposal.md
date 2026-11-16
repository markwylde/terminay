## Why

On a phone a bot tab's header tries to fit the avatar, name, agent line,
status chip, Disable bot, and the Chat/Configure switch into one 390px row.
The name column is squeezed to nothing: the agent line collapses to a stray
character and the status chip is drawn over the bot's name. Most of those
controls are rarely used, and the activity the status chip names is already
shown by the avatar's dot.

## What Changes

- When a bot tab is 600px wide or narrower, its header holds only the avatar
  with its activity dot, the bot's name on one line, and a settings button.
- The settings button opens a menu with Chat, Configure, and, when the server
  supports it, Enable bot or Disable bot. The current mode is marked and
  announced. Choosing an item closes the menu.
- The agent/model/container line is not drawn at that width. The status chip
  is drawn only while the bot is disabled, since the avatar's dot shows
  activity but not availability; otherwise it is hidden visually and still
  announced.
- The bot's name truncates with an ellipsis instead of overlapping anything,
  at every width.
- Wider bot tabs keep their layout and controls; only the name's overflow
  changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: a compact bot tab header with a settings menu.

## Impact

- `src/workspace/bots/BotTab.tsx`, `src/workspace/bots/botPanels.css`.
- E2E: `e2e/bots.spec.ts` gains a narrow-tab case.
