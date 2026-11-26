## Why

Bots in the Home sidebar currently display tiny 18×18 px monochrome-letter badges, making it hard to tell bots apart at a glance. Giving every bot a distinct generated character avatar with `@markwylde/chara`'s Critter theme by default — and doubling the sidebar bot avatar size to 36×36 px — makes the bot roster immediately recognisable while keeping the single character or emoji with colour as an explicit option.

## What Changes

- Add `@markwylde/chara` and `@markwylde/chara-react` to render deterministic SVG avatars using Chara's `critter` theme from each bot's name.
- Extend `BotProfile` and `BotStore` with an optional `avatarStyle` (`'critter' | 'character'`), defaulting to `'critter'` for new bots and for existing saved bots that do not specify a style.
- Update `BotAvatar` so bots using `'critter'` render the Chara Critter SVG filling the avatar frame (preserving the activity dot), while bots using `'character'` keep their character/emoji and background colour.
- Update `BotProfilePanel` and `NewBotDialog` to let the user choose between **Critter** (default) and **Character** (with character/emoji input and colour swatches), with a live avatar preview.
- Double the Home sidebar bot avatar size from 18×18 px to 36×36 px and adjust sidebar bot row sizing so avatars and activity dots fit cleanly without clipping or overlap.

## Capabilities

### New Capabilities

<!-- None -->

### Modified Capabilities

- `terminay-bots`: Bot profiles default to Chara Critter avatars (including existing bots with no stored avatar style) and offer Character (emoji or single character with colour) as an alternative.
- `workspace-dashboard`: Bot rows in the Home sidebar render 36×36 px bot avatars sized cleanly inside their rows.

## Impact

- `package.json`, `package-lock.json`: add pinned `@markwylde/chara` and `@markwylde/chara-react` dependencies.
- `packages/protocol/src/bots.ts`: add `BotAvatarStyle` and optional `avatarStyle` on `BotProfile`.
- `packages/server-core/src/botService/store.ts`: validate and default `avatarStyle` to `'critter'`, tolerating empty `avatar` when saving a `'critter'` bot.
- `src/workspace/bots/BotAvatar.tsx`, `BotProfilePanel.tsx`, `NewBotDialog.tsx`, `botsModel.ts`, `bots.css`, `botPanels.css`: render Chara Critter avatars and avatar style picker UI.
- `src/workspace/homeView.css`: double `.home-sidebar__bot .bots-avatar` from 18 px to 36 px and adjust `.home-sidebar__bot` row height.
- `src/workspace/publishedNotifications.ts`, `src/workspace/activityStates.ts`, `src/workspace/TerminalActivityOverview.tsx`, `src/App.tsx`, `src/workspace/bots/BotTranscript.tsx`: thread `avatarStyle` into every `BotAvatar` surface.
- Tests: `packages/server-core/test/bot-store.test.mjs`, `src/workspace/bots/botsModel.test.ts`, `scripts/bots-ui.test.mjs`, and `e2e/bots.spec.ts`.
