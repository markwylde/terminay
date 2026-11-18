## 1. Protocol: hosted endpoints value

- [x] 1.1 Add `packages/protocol/src/hostedEndpoints.ts` with `PRODUCTION_HOSTED_ENDPOINTS`, `parseHostedEndpoints`, `sessionOriginFor`, `sessionIdFromOrigin` and `isAppServerOrigin`, exported from the package index. Verified by new unit tests in `packages/protocol/test/hosted-endpoints.test.mjs` covering production and preview pairs, round-trip of the session id, and every rejection rule: placeholder count and position, a manager that matches the template, HTTP on a public host, path/query/fragment/credentials, and label length.
- [x] 1.2 Rework `hostedPairingUrl.ts` (`formatHostedPairingUrl`, `parseHostedPairingUrl`, `classifyPairingOrigin`, `managerOriginFromSessionOrigin`) to take a `HostedEndpoints` argument, defaulting to production, and delete `managerHostnameFromSessionHostname`, `sessionHostnameFromManagerHostname`, the `app.` check in `isManagerHostname`, and the `.terminay.com` branch of `sessionIdFromHostname`. Verified by `packages/protocol/test/hosted-pairing-url.test.mjs`, extended with preview-endpoint cases and with a check that a link from a non-configured manager is not treated as a manager link.
- [x] 1.3 Make `managerOrigins.ts` read the App Server from `HostedEndpoints`, keeping `TERMINAY_MANAGER_ORIGIN` as the production default only. Verified by `packages/protocol/test/manager-origins.test.mjs` and by a repo grep showing no remaining `app.` or `.terminay.com` string derivation in `packages/protocol/src`.

## 2. Server: configuration and session origin

- [x] 2.1 Replace `--hosted-domain` / `TERMINAY_HOSTED_DOMAIN` with `--app-server` / `TERMINAY_APP_SERVER` and `--session-server` / `TERMINAY_SESSION_SERVER` in `apps/terminay-server/src/cliOptions.ts`, validated through `parseHostedEndpoints`. A legacy value of `terminay.com` is ignored; any other legacy value fails startup and names the new options. Verified by `apps/terminay-server/test/cli-options.test.mjs` cases for defaults, precedence, invalid pairs, and both legacy-value paths.
- [x] 2.2 Key `remote/sessionOrigin.ts` to the endpoints: reuse the persisted origin only while it matches the template, otherwise mint `sessionOriginFor(endpoints, uuid)`. Verified by a session-origin test where a production origin survives restart and a template change mints a new origin.
- [x] 2.3 Thread the endpoints through `cli.ts` (manager origin, `pairingUrlFormatForOrigin`), `remote/hostedPairingSecrets.ts` (`hostedSessionId`), `remote/directSessionId.ts` (`relaySessionId`), `remote/publicPairingUrl.ts` and `remote/hostedPairingHost.ts` (`classifySignalingHost`). Verified by `apps/terminay-server/test/public-pairing-url.test.mjs`, `standalone-pairing-handoff.test.mjs` and `signaling-host-boundary.test.mjs`, extended with a preview pair, and by grep showing no `.terminay.com` / `app.terminay.com` literal left in `apps/terminay-server/src` outside the protocol defaults.

## 3. Daemon CLI

- [x] 3.1 Replace `--hosted-domain` with `--app-server` and `--session-server` in `apps/terminay-cli/src/args.ts`, `layout.ts`, `unit.ts` and `commands/install.ts`, writing `TERMINAY_APP_SERVER` and `TERMINAY_SESSION_SERVER` to the environment file. Verified by `apps/terminay-cli/test/args.test.mjs`, `unit.test.mjs` and `install.test.mjs`.

## 4. Desktop

- [x] 4.1 Replace `remoteAccess.webRtcHostedDomain` with `remoteAccess.appServer` and `remoteAccess.sessionServer` in `src/terminalSettings.ts` and `packages/server-core/src/settings/defaults.ts`, including the migration from a stored hosted domain described in design.md. Verified by a `src/terminalSettings` unit test covering default, `terminay.com`, `localhost:<port>` and custom-domain migrations, and rejection of an invalid pair.
- [x] 4.2 Show **App Server** and **Session Server** fields in Settings › Remote Access, with the validation message on an invalid value. Verified by the settings UI unit tests and a Docker E2E check (`npm run test:e2e`) that the two fields render with the production defaults.
- [x] 4.3 Pass the endpoints from `electron/remote/service.ts` into `electron/remote/webrtc.ts` (`createChannelUrl`, pairing URL) and `electron/remote/desktopPairing.ts`, deleting the separate loopback hosted-domain path. Verified by the existing desktop pairing tests (`scripts/desktop-pairing*.test.mjs`, `scripts/desktop-hosted-pairing-url.test.mjs`) passing, plus a preview-endpoint case.

## 5. Web host

- [x] 5.1 Make `apps/terminay-web/src/index.ts` (`WEB_MANAGER_ORIGIN`, `parsePwaPairingUrl`, `requireStableOrigin`) and `framedConnectionHost.ts` take the configured App Server rather than the constant. Verified by `apps/terminay-web/test` passing, with a preview-manager case.

## 6. Verification and spec sync

- [x] 6.1 Run the affected suites with bounded `node --test --test-force-exit --test-timeout=120000`, after `npx turbo run build --filter=<package>...`, plus `npm run lint`. Verified by their output being green.
- [x] 6.2 Run `openspec validate --all`, then archive the change so its deltas fold into `openspec/specs/`. Verified by validate passing and by the specs no longer mentioning a hosted domain.
- [ ] 6.3 Open the pull request on `origin` (Gitea, `tea`) and read back every commit status on the head SHA until all are `success` or `skipped`. Verified by the status list.
