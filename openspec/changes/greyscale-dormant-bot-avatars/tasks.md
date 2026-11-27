## 1. Settings

- [x] 1.1 Add device setting `animateBotAvatars` (default on) to `TerminalSettings`, defaults, normalisation, and Accessibility › Readability as **Animate bot avatars** — verified by `src/terminalSettings.botAvatars.test.ts`
- [x] 1.2 `useBotAvatarsAnimated`: one shared settings subscription per client for every mounted avatar

## 2. Renderer

- [x] 2.1 `BotAvatar`: mark the avatar dormant while its activity is `idle` or `stopped`; Critter uses Chara `mono`, a Character tile uses the grey of its colour's luminance
- [x] 2.2 `BotAvatar`: animate a Critter with an activity, mapping working → `working`, queued → `thinking`, stopped → `sleeping`, idle and needs-you → `idle`, unless the setting is off
- [x] 2.3 `bots.css`: greyscale a dormant avatar's picture, leaving the activity dot in colour

## 3. Verification

- [x] 3.1 TypeScript, Biome lint, settings tests, and `openspec validate greyscale-dormant-bot-avatars --strict` pass (`--all` reports 13 failures, all in other changes)
- [ ] 3.2 Checked in the running app: idle/stopped bots grey, working bot animates in colour, setting off stills them
- [ ] 3.3 Every Gitea commit status on the pull request head SHA is `success` or `skipped`
