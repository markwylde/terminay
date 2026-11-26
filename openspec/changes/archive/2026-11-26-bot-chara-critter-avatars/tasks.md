## 1. Dependencies and Protocol

- [x] 1.1 Install pinned `@markwylde/chara@0.1.0` and `@markwylde/chara-react@0.1.0` in root `package.json` and `package-lock.json`. Verify with `node scripts/task20-supply-chain-audit.mjs` and `npm run check:boundaries`.
- [x] 1.2 Add `BotAvatarStyle = 'critter' | 'character'` and optional `avatarStyle?: BotAvatarStyle` to `BotProfile` in `packages/protocol/src/bots.ts`. Verify with `npx turbo run build --filter=@terminay/protocol && npx turbo run typecheck --filter=@terminay/protocol`.

## 2. Server Persistence and Validation

- [x] 2.1 Update `packages/server-core/src/botService/store.ts` to default missing `avatarStyle` to `'critter'` on load and save, validate explicit `avatarStyle` values, and fall back to `initialOf(name)` if `avatar` is empty while saving a `'critter'` bot. Verify with `npx turbo run build --filter=@terminay/server-core && node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-store.test.mjs packages/server-core/test/bot-inspect.test.mjs`.

## 3. Avatar Rendering and Workspace Surfaces

- [x] 3.1 Add `botAvatarStyle` helper to `src/workspace/bots/botsModel.ts` and update `src/workspace/bots/BotAvatar.tsx` and `src/workspace/bots/bots.css` to render Chara Critter SVGs via `@markwylde/chara-react` when `avatarStyle` is `'critter'` and character/colour badges when `'character'`. Verify via `scripts/bots-ui.test.mjs` and `src/workspace/bots/botsModel.test.ts`.
- [x] 3.2 Thread `avatarStyle` through every surface constructing narrowed bot objects (`src/workspace/publishedNotifications.ts`, `src/workspace/activityStates.ts`, `src/workspace/TerminalActivityOverview.tsx`, `src/App.tsx`, `src/workspace/bots/BotTranscript.tsx`). Verify via TypeScript typecheck and `npm run test:workspace-models`.
- [x] 3.3 Update `src/workspace/bots/BotProfilePanel.tsx`, `src/workspace/bots/NewBotDialog.tsx`, and `src/workspace/bots/botPanels.css` to offer the **Critter** (default) / **Character** selector with live avatar preview, showing the character input and colour swatches only for Character. Verify via `npm run test:bots-ui`.
- [x] 3.4 Update `src/workspace/homeView.css` so `.home-sidebar__bot .bots-avatar` is 36×36 px (double 18×18 px) with proportional border-radius, activity dot, and `.home-sidebar__bot` row height. Verify in headless Chromium via `npm run test:bots-ui` and screenshot inspection.

## 4. Verification and OpenSpec Completion

- [x] 4.1 Add unit and Chromium UI tests covering `avatarStyle` defaults/persistence, Critter vs Character switching in Profile and New Bot, live preview updates on rename, and 36×36 px Home sidebar bot avatars. Verify with `packages/server-core/test/bot-store.test.mjs`, `src/workspace/bots/botsModel.test.ts`, and `npm run test:bots-ui`.
- [x] 4.2 Run lint, workspace typecheck, supply-chain audit, boundary checks, production UI build, and `openspec validate --all`. Verify every command exits 0.
