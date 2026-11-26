## Context

Terminay renders bot avatars through a single component (`src/workspace/bots/BotAvatar.tsx`) across the Home sidebar roster, Home tab icons, Home overview widgets, Bots fleet cards, Bot tab headers, chat/transcript messages, reply bars, compact mobile rows, New Bot dialog, and Notifications dropdown. Currently every bot stores a single character or emoji in `BotProfile.avatar` and a colour in `BotProfile.colour`, and the Home sidebar shrinks `.home-sidebar__bot .bots-avatar` to 18×18 px inside a 30 px row.

`@markwylde/chara@0.1.0` and `@markwylde/chara-react@0.1.0` (MIT, zero runtime dependencies) deterministically generate allowlist-checked inline SVG elements from a name without `dangerouslySetInnerHTML`.

## Goals / Non-Goals

**Goals:**
- Use Chara's `critter` theme as the default bot avatar for all new and existing bots, while retaining single-character/emoji + colour as an explicit alternative.
- Double the Home sidebar bot avatars from 18×18 px to 36×36 px while keeping Home tab strip icons at 16×16 px.
- Keep `bots.json` state version 2 intact and non-destructive.

**Non-Goals:**
- Exposing other Chara themes (`mecha`, `sigil`), custom avatar seeds, or animated standalone characters.
- Changing the bot inspection tool allowlist (`runtimeInspect.ts`).

## Decisions

### 1. Optional `avatarStyle?: 'critter' | 'character'` on `BotProfile`
- **Choice**: Add `export type BotAvatarStyle = 'critter' | 'character'` and `readonly avatarStyle?: BotAvatarStyle` to `BotProfile` in `packages/protocol/src/bots.ts`. In `BotStore` (`packages/server-core/src/botService/store.ts`), missing `avatarStyle` defaults to `'critter'` on load and on save, matching the established pattern of `investigateFailures`, `terminayMcpAccess`, and `inspectOtherBots`.
- **Boundary crossed**: Protocol / server-owned persistence boundary (`@terminay/protocol` ↔ `@terminay/server-core` ↔ workspace UI). Only the server validates and persists `avatarStyle`; client renderers remain untrusted and validate/default defensively via `botAvatarStyle()`.
- **Why over a sentinel string in `avatar` + v3 schema migration**: Keeping `avatar` as the character/emoji field and adding `avatarStyle` switches every existing bot to `'critter'` immediately on upgrade without bumping `bots.json` to v3, without losing the user's prior character/colour if they switch back to Character, and without breaking existing server validation rules (e.g. rejecting multi-grapheme `avatar` strings like `'two'`). When saving a `'critter'` bot with an empty `avatar` string, `BotStore` falls back to `initialOf(name)` so saving never fails on an unused character field.

### 2. Render Chara Critter inline via `@markwylde/chara-react`
- **Choice**: Render `<Avatar name={bot.name} theme="critter" radius={0} />` inside `.bots-avatar` when `botAvatarStyle(bot) === 'critter'` (and no data-URI picture is set). Give `.bots-avatar--critter` a transparent background and apply `width: 100%; height: 100%; display: block; border-radius: inherit;` to `.bots-avatar > svg`.
- **Boundary crossed**: Renderer security boundary. `@markwylde/chara-react` renders real React SVG elements from an allowlist-validated node tree with no `dangerouslySetInnerHTML`, no scripts, and no external URLs, matching Terminay's renderer sandboxing (ADR-0005).
- **Why `radius={0}` + CSS `border-radius: inherit`**: `.bots-avatar` uses different corner radii across contexts (4 px in tabs, 6–9 px in cards/headers/sidebar) and positions its activity dot (`<i>`) outside its bottom-right edge (`right: -2px; bottom: -2px`), so `.bots-avatar` cannot clip with `overflow: hidden`. Clipping the `<svg>` directly with `border-radius: inherit` keeps exact radii everywhere while leaving the activity dot unclipped.

### 3. Home sidebar bot row geometry
- **Choice**: Increase `.home-sidebar__bot .bots-avatar` from `18px × 18px` to `36px × 36px` (`border-radius: 8px`, `font-size: 13px`, activity dot `9px × 9px`), and set `.home-sidebar__bot` height to `46px` (up from `30px` inherited from `.home-sidebar__section`), preserving clear vertical padding around the avatar and its protruding status dot.
- **Boundary crossed**: Pure UI presentation (`src/workspace/homeView.css`).

### 4. Profile & New Bot picker UX
- **Choice**: Offer a segmented control (`Critter` | `Character`) alongside a live `BotAvatar` preview in `BotProfilePanel` and `NewBotDialog`. Show the Character text input and Colour swatches only when `Character` is selected.
- **Boundary crossed**: Pure UI presentation.

## Risks / Trade-offs

- [Multiple identical bot avatars on one page share internal SVG gradient IDs] → Chara deterministically keys SVG IDs by `(theme, name, radius, variant, mono)`, so identical avatars reuse identical defs cleanly, and different bots get distinct IDs.
- [Notification rows and transcript bars pass narrowed bot objects] → Thread `avatarStyle?: BotAvatarStyle` through `NotificationBotProfile`, `BotNotificationRow`, `App.tsx`, `TerminalActivityOverview.tsx`, and `BotTranscript.tsx` so every surface agrees with the bot's saved style.

## Migration Plan

- On server load, existing bots in `bots.json` (which lack `avatarStyle`) automatically read as `avatarStyle: 'critter'` and render as Chara Critters.
- Rolling back to a prior server binary remains safe because `bots.json` remains version 2 and retains each bot's valid `avatar` and `colour` fields.
