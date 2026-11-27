## Context

`BotAvatar` renders every bot avatar. Callers that know the bot's activity pass
it, and the avatar draws the activity dot as a child `<i>`. Critters come from
`@markwylde/chara-react`'s `<Avatar variant="standalone">`, which also accepts
`animated`, `state` and `mono`.

## Goals / Non-Goals

- Goal: a bot's avatar shows at a glance whether it is busy or dormant.
- Goal: anyone who finds the motion distracting can turn it off.
- Non-goal: changing activity states or dot colours, or animating avatars that
  have no activity.

## Decisions

- **Dormant means `idle` or `stopped`.** Those draw in greys. `working`,
  `queued` and `needs-you` stay in colour.
- **Activity → Chara state.** working → `working`, queued → `thinking`,
  stopped → `sleeping`, idle → `idle`. needs-you → `idle`: Chara's `error`
  would misreport a bot that is only waiting, and the red dot already asks for
  attention.
- **Greys without greying the dot.** A filter on the whole badge would grey
  the dot too. Critters use Chara's `mono`; pictures get `filter:
  grayscale(1)` on the `<img>`; a Character tile's background is replaced with
  the grey of its Rec. 709 luminance (non-hex colours fall back to the idle
  grey).
- **Device setting.** `animateBotAvatars` is a top-level boolean, default on,
  not server-owned, so each device chooses. It lives under Accessibility ›
  Readability.
- **One subscription for many avatars.** A roster, tab strip and header can
  show a dozen avatars; each calling `useOptionalTerminalSettings` would fetch
  settings per avatar. `useBotAvatarsAnimated` keeps one shared store per
  settings client via `useSyncExternalStore`, subscribed while any avatar is
  mounted.

## Risks / Trade-offs

- An idle bot no longer shows its chosen colour in the roster until it works.
- Changing `mono` rebuilds the Critter's SVG; this happens only when a bot
  moves between dormant and active.
