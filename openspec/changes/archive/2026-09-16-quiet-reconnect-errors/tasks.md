## 1. Classify transport failures

- [x] 1.1 Add `isTransportFeatureFailure` and `clearTransportFeatureFailure` to `src/shared/featureQueryAuthority.ts`, and record `transport` on `VisibleFeatureFailure`, sharing the `disconnected` / `unavailable` / `deadline` boundary `describeFeatureFailure` already uses. Verified by `npx tsx --test src/shared/featureQueryAuthority.test.ts` covering a wrapped `disconnected` cause, the other two codes, a `forbidden` refusal, and a plain error.
- [x] 1.2 Add `isConnectionReconnecting` beside `ConnectionPhase` in `src/shared/connections/connectionRegistry.ts`. Verified by the banner suite importing it through the bundle.

## 2. Quiet the workspace banner

- [x] 2.1 In the project workspace, read the owning connection's phase through `useServerConnection(serverId)`, skip a transport failure while reconnecting, and retire a transport notice already visible when the phase flips to reconnecting, without changing `reportFeatureFailure`'s identity. Verified by `node --test scripts/git-banner-reconnect-recovery.test.mjs`, which models the banner exactly as `App.tsx` drives it and asserts: no banner for a refresh that fails while reconnecting, a pre-flip outage notice retired on the flip, and a `forbidden` refusal left visible through both.

## 3. Quiet the terminal panel

- [x] 3.1 In `TerminalPanel`, read the owning connection's phase the same way and render the connection error and **Retry connection** only when the connection is not reconnecting, leaving `failServerTransport` and the rebind path untouched. Verified by `npx tsc --noEmit` and by reading that the rebind effect still clears the error on the replacement client.

## 4. Checks

- [x] 4.1 Run `openspec validate --all`, `npm run lint`, `npx tsc --noEmit`, `node --test scripts/git-banner-reconnect-recovery.test.mjs`, and `npx tsx --test src/shared/featureQueryAuthority.test.ts`. Verified by all five reporting clean.
- [ ] 4.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped` before calling it green. Verified by the status listing itself.
