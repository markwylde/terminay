## Why

A bot often posts several replies in a row. Chat folds them under a single avatar and name, with no times, so it is hard to tell where one reply ends and the next begins, when each arrived, or which of them are new since you last looked. The context rail's Upcoming list has the opposite problem: a trigger that fires every minute fills all three rows with the same name.

## What Changes

- Every chat message carries its own avatar, author and the time it was posted.
- Chat marks where unread bot messages begin with a labelled divider, and opens there when the unread run is taller than the viewport.
- Messages count as read once the user leaves Chat: switching to Configure, closing or switching away from the bot tab, or hiding the window. The read position is per device.
- The rail's Upcoming list shows each trigger once, at its next firing, with a repeat mark when that trigger fires again within the window.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: Communication UI gains per-message identity and time, an unread divider and read-on-leave.
- `bot-triggers`: the context rail's upcoming list shows distinct triggers.

## Impact

Renderer only: `src/workspace/bots/BotChat.tsx`, `BotTranscript.tsx`, `BotContextRail.tsx`, `triggersModel.ts`, `useServerBots.ts`, `src/workspace/localViewState.ts` and the bots stylesheet. No protocol or server change; message `createdAt` and `sequence` already exist.
