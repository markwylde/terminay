## 1. Defaults

- [x] 1.1 Set `convertEol: false` in `defaultTerminalSettings` (`src/terminalSettings.ts`) and update the setting's description to say it is off by default and only for sources that send bare LF expecting a new line. Verify with `grep -n "convertEol" src/terminalSettings.ts`.
- [x] 1.2 Set `convertEol: false` in `packages/server-core/src/settings/defaults.ts`. Verify with a server-core test asserting `DEFAULT_SERVER_SETTINGS.convertEol === false`.

## 2. Server settings migration

- [x] 2.1 Bump `SETTINGS_SCHEMA_VERSION` to 3 in `packages/server-core/src/settings/types.ts`, and change the shell-profile migration guard in `normalize.ts` to skip any snapshot whose `schemaVersion` is a number ≥ 2. Verify with the existing `shell-profile-normalize.test.mjs` passing.
- [x] 2.2 In `migrateServerSettings` only, not in `normalizeSettingsAndSecrets` or `normalizeServerSettings`, reset `convertEol` to `false` when the source `schemaVersion` is absent or below 3. Verify with new `settings.test.mjs` cases: a v2 snapshot with `true` migrates to `false`; a v2 snapshot with `false` stays `false`; a v2 snapshot without the key gets the default `false`; a legacy unversioned Electron JSON with `true` migrates to `false`; a v3 snapshot with `true` stays `true` and migrating it twice is idempotent; `normalizeServerSettings({ convertEol: true })` keeps `true`.
- [x] 2.3 Add a `ServerSettingsRepository` test. Loading a v2 snapshot backs it up and commits v3 with `convertEol: false`. Applying `convertEol: true`, then an unrelated settings change, then a reload from the committed state, leaves it `true`. Verify with `npm run test --workspace @terminay/server-core`.

## 3. Rendering regression

- [x] 3.1 Add `src/terminalLineFeed.test.ts`. It writes a raw-mode byte sequence modelled on `agy` (text, bare LF, more text relying on the column, CHA moves, half-block glyphs) into `@xterm/headless`, built with `buildTerminalOptions(defaultTerminalSettings)`, and asserts the expected screen rows. A second case with `convertEol: true` asserts the column-0 behaviour, which proves the test discriminates. Verify with `node --test --experimental-strip-types src/terminalLineFeed.test.ts`.
- [x] 3.2 Add the new test to the `smoke` script in `package.json` so CI runs it. Verify by running `npm run smoke`, or the exact `node --test` command it contains, and seeing the new test execute and pass.

## 4. Checks

- [x] 4.1 Run `npm run lint`, the server-core suite and the new test. All pass.
- [x] 4.2 Run `openspec validate --all`. This change validates, and no failure is added beyond the 7 pre-existing ones in other in-flight changes (add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, server-notification-manager, unified-settings-window).
