## Why

Every bot avatar is a still, full-colour Critter, so a glance at Home's sidebar
roster does not show which bots are doing something. The small activity dot is
the only cue. Chara can animate a standalone Critter by state (idle, thinking,
working, sleeping, …) and draw it in greys, and Terminay uses neither.

## What Changes

- While a bot is idle or stopped, every avatar that carries its activity dot is
  drawn in greyscale: a Critter in Chara's mono, a picture desaturated, and a
  Character tile in the grey of its colour's luminance. The dot keeps its
  colour.
- A Critter that carries an activity dot animates the bot's activity: working
  → `working`, queued → `thinking`, idle and needs-you → `idle`, stopped →
  `sleeping`.
- A new device setting, Accessibility › **Animate bot avatars** (on by
  default), draws them still when off. Chara already stands still for reduced
  motion.
- Avatars without an activity (chat messages, profile preview, New bot dialog)
  stay in colour and still.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: avatars reflect activity in colour and motion, with a
  setting to turn the motion off.

## Impact

- `src/workspace/bots/BotAvatar.tsx`, `src/workspace/bots/bots.css`,
  new `src/workspace/bots/useBotAvatarsAnimated.ts`.
- `src/types/settings.ts`, `src/terminalSettings.ts`,
  `src/hooks/useTerminalSettings.ts`; test
  `src/terminalSettings.botAvatars.test.ts` in `npm run smoke`.
