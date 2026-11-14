## 1. Protocol and server

- [x] 1.1 Add `server.upgrade.check` to `SERVER_UPGRADE_OPERATIONS` and the `cannot-check` and `check-failed` refusals. Verified by `packages/server-core/test/server-upgrade-protocol.test.mjs` asserting both sides agree on the operation names and capability.
- [x] 1.2 Add `ServerUpgradeService.checkNow()`: shares a running check, answers from a good one under ten seconds old, refuses a failed one with `check-failed` and a server without an upgrader with `cannot-check`. Verified by `packages/server-core/test/server-upgrade-service.test.mjs`.
- [x] 1.3 Register the command at `admin` scope with an empty payload. Verified by `server-upgrade-protocol.test.mjs` cases for a paired device, a non-empty payload, and a read-only connection.

## 2. Client

- [x] 2.1 Add `ServerUpgradeClient.checkForServerUpgrade()`, applying the reply to the status store.
- [x] 2.2 Add `requestServerUpgradeCheck`, `upgradeCheckErrorText` and `upgradeCheckResultText` to `serverUpgradeModel.ts`, and keep a menu row for every server whose status names a channel. Verified by `src/workspace/serverUpgradeModel.test.ts`.
- [x] 2.3 Offer **Check for updates** in each connection-menu row and on a server's Updates page, with the result line. Verified by `scripts/server-upgrade-ui.test.mjs`, `scripts/settings-updates-ui.test.mjs`, and `e2e/server-upgrade.spec.ts` through `npm run test:e2e`.
