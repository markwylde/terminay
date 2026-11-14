## 1. Shared status projection

- [x] 1.1 Move `projectStatus` and a structural `RemoteAccessStatus` into `apps/terminay-server/src/remote/remoteAccessStatus.ts`, taking `isRunning`, the pairing URL and hosted connections as inputs, and import it from `electron/remote/serverOwnedExposure.ts`. Verified by `npm run typecheck` and the existing Desktop remote exposure tests (`scripts/*remote*exposure*.test.mjs`) passing unchanged.

## 2. Standalone runtime exposure controller

- [x] 2.1 Add `apps/terminay-server/src/remote/standaloneRemoteAccess.ts` (design decisions 1, 3, 5 and 6): `expose`, `stop`, `createPairingLink`, `approveDevice`, `denyDevice`, `revokeDevice`, `closeConnection`, `status` and `onChange`, all on one operation queue, with a fresh shared rotator per exposure generation, the configured-modes policy, and stop that answers first and closes after a grace period. Verified by new `apps/terminay-server/test/standalone-remote-access.test.mjs` using fake pairing hosts. It covers: no-modes exposes hosted only; direct-only re-exposes direct only, with no hosted attempt; repeated stop and expose; a failing second mode closes the first and leaves status stopped with the error; create-pairing-link rotates once and awaits every mode, and fails when a mode fails; status stays running across a room rotation; stop resolves approvals as closed and closes hosts only after the returned status; and `onChange` fires for approval requested and resolved, peer connected and disconnected, handoff, and device persistence.
- [x] 2.2 `resetIdentity` (decision 7). Verified by the same file. A key-write failure changes nothing. While exposed, it revokes all devices, re-exposes under the new key, and reports running. While stopped, it revokes and stays stopped. A re-registration failure leaves it stopped with the error and the devices revoked.
- [x] 2.3 `expose` refuses without a configured UI renderer directory, with the startup message. Verified by the same file, and by `exposed-workspace-ui.test.mjs` updated to the new location of the guard.

## 3. Standalone composition

- [x] 3.1 In `cli.ts`, provision the hosted session origin only when no `--expose` mode and no explicit `--remote-origin` are given (decision 8), and drive startup exposure through the controller. Verified by the existing standalone hosted, direct and pairing-handoff tests, and by a new test that origin selection returns the provisioned origin for no-modes, the existing origin for `direct`-only, and the explicit origin when one is given.
- [x] 3.2 Register `remote-access.status` and the seven `remote-access.*` commands in the standalone operation registry, with Desktop's payload validation (`deviceId`, `connectionId`, `approvalId`) and an `admin`-scope check. Append `remote-access.changed` to the event journal on every controller change. Verified by a test that dispatches each operation through the standalone composition with an `admin` and a non-admin context, asserting the result, the refusal, and the event.
- [x] 3.3 Rebuild the approval-socket authority over the controller, so `approvals`, `approve`, `deny` and `pairing` share its state and fire its change events. Verified by the existing `approval-socket.test.mjs`, `pairing-approval.test.mjs` and `hosted-pairing-approval-flow.test.mjs`, and by a controller test in which an approval resolved through the socket authority is reflected in status.

## 4. Docs

- [x] 4.1 Update `docs/operations/standalone-server.md`. Admin clients can expose, stop, pair, approve and reset at runtime. Runtime changes do not persist and `--expose` is the standing decision. Runtime exposure uses the configured modes. Stopping from a remote client disconnects it. Verified by review against ADR-0120.

## 5. Verification

- [x] 5.1 `openspec validate standalone-server-remote-access` passes, and `openspec validate --all` adds no failure. Verified by both runs.
- [x] 5.2 `npx turbo run build --filter=@terminay/server...`, then the touched `apps/terminay-server/test` files and Desktop remote tests, each run as `timeout 600 node --test --test-force-exit --test-timeout=120000`, plus `npm run typecheck` and `npx biome check` on the touched files. Verified by exit status 0.
- [ ] 5.3 Pull request CI statuses on Gitea are all `success` or `skipped`, including the Docker-isolated E2E shards. Verified with `tea`.
