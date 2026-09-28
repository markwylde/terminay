## 1. Setting

- [x] 1.1 Add `exposeOnStartup: boolean` to `RemoteAccessSettings`, default `false` in both the renderer and server-core defaults, and normalize non-boolean input to the default. Verified by typecheck and the settings tests.
- [x] 1.2 Add the **Automatically expose server on startup** boolean field to the `remote-access-host` Settings section. Verified by the field appearing in Settings → Remote exposure.

## 2. Startup exposure

- [x] 2.1 Add `electron/remote/exposeOnStartup.ts`: when enabled and exposure is not running, call `toggle()` once; otherwise do nothing. Verified by 3.2.
- [x] 2.2 In `electron/main.ts`, call it after `ui-handoff` in `completeDesktopStartup` without awaiting it. Verified by typecheck and the E2E suite.

## 3. Verification

- [x] 3.1 `npm run lint`, typecheck and `openspec validate --all` pass. Verified by command output.
- [x] 3.2 Add `scripts/expose-on-startup.test.mjs` (`npm run test:expose-on-startup`, included in `smoke`) covering: on exposes once, off does nothing, an already-exposed server is never toggled off, and the setting defaults to off and accepts only booleans. Verified by the test passing.
