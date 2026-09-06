## 1. Grok registry binding

- [x] 1.1 Select among matching `active_sessions.json` descendant pids instead of failing closed when more than one pid matches the issued PTY. Admit only eligible primary journals and, if several remain, the most recently modified. Verified by `extensions/agent-grok/test/provider.test.mjs` covering a PTY with two live Grok pids.
- [x] 1.2 Bind two Grok terminals independently from one shared registry file, each to its own primary journal. Verified by the same provider test asserting distinct `providerSessionId` values.

## 2. Later turn and host projection

- [x] 2.1 Map a `turn_started` after `turn_ended` to `turn.started` on the same root. Verified by the Grok mapper unit test.
- [x] 2.2 Keep two terminals of the same provider as independent active roots, including after a later turn on one of them. Verified by `packages/server-core/test/extension-agent-runtime.test.mjs`.

## 3. App coverage

- [x] 3.1 Give the native Grok e2e stub a pid-keyed session id so two concurrent stubs do not share one journal. Verified by reading the stub in `e2e/fixtures.ts`.
- [x] 3.2 Cover two live Grok CLIs in one project, a later turn after `done`, and `grok --resume` while the other Grok is still running. Verified by `e2e/extension-grok-agent-runtime.spec.ts`. Electron execution is `npm run test:e2e` in Docker.

## 4. Validation

- [x] 4.1 `openspec validate --all` succeeds for this change. Verified by running that command.
