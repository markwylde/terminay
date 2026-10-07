## 1. Server: one live peer per window

- [ ] 1.1 Accept an optional, validated `windowId` on `application-auth`, and treat its absence as the empty window id. Verified by unit tests of the parser for a valid id, an absent one, an over-long one, and one with characters outside the id pattern.
- [ ] 1.2 Key `HostedLivePeerRegistry` by device and window, replace only the same window's peer, and keep the per-device ordering of cleanup before attach. Verified by `apps/terminay-server/test/hosted-pairing-host-liveness.test.mjs`: a second window stays beside the first, a reconnect replaces only its own window, a window id used by another device closes nothing, and two connections with no window id still replace each other.
- [ ] 1.3 Refuse a ninth live window of a device with a typed error, without closing any live peer, and do not count a reconnect of an existing window. Verified by unit tests at the bound.
- [ ] 1.4 Close every live peer of a device, in both pairing hosts, when the device is revoked. Verified by a test that revokes a device with windows on the hosted and the direct host and finds none left, and other devices untouched.

## 2. Server-core: each window is its own client

- [ ] 2.1 Carry the device id beside the client identity in `AuthenticatedClient`, and have the pairing host attach a peer with a client identity made from device and window. Verified by a connection test that `server_hello` reports the window's client identity and that authorization reads the device's scope.
- [ ] 2.2 Confirm terminal attachments, input authority, presentation leases, and checkpoints of two windows of one device no longer collide. Verified by `packages/server-core/test/connection-scoped-lifecycle.test.mjs`: two windows attach one terminal and both stream; closing one releases only its own attachment, lease, and checkpoint.
- [ ] 2.3 Audit every durable or cross-connection use of the client identity in server-core (macro run owner, extension idempotency, app-window held responses, automations, settings) and key by device anything that must outlive a window. Verified by a written list in the pull request and a test for each one changed.
- [ ] 2.4 Fire `device.connected` only when a device's live-window count goes from zero to one, across both pairing hosts. Verified by an automations trigger test with a second window and a reconnect.

## 3. Desktop

- [ ] 3.1 Generate a window id per native window in main, keep it across that window's reloads and reconnects, and send it with `application-auth`. Verified by `scripts/desktop-hosted-connection.test.mjs` asserting the id is stable across a reconnect and differs between windows.
- [ ] 3.2 Open one connection at a time to a given server profile in main. Verified by a unit test that two concurrent opens to one profile run in sequence and both succeed.
- [ ] 3.3 Present a refused ninth window as a stated reason and do not retry it automatically. Verified by a unit test of the connect-attempt classification and a component test of the message.

## 4. Live connections

- [ ] 4.1 Add the device id to each live-connection entry of the status projection, and group the lists in Settings, the connection menu, and Remote Control by device with a window count. Verified by model and component tests with one device holding three windows.
- [ ] 4.2 Make closing from the list close every window of the device, and make it work for hosted connections. Verified by a test that the action closes the device's live peers and leaves the device trusted.

## 5. End to end

- [ ] 5.1 Electron E2E through `npm run test:e2e`: two connections of one device to a standalone server, with different window ids, stay live together and both stream a terminal; reconnecting one leaves the other. Verified by the suite passing in pull-request CI.
- [ ] 5.2 Update the E2E and tests that pin takeover (`e2e/connection-reconnect-cycles.spec.ts`, the source-text checks in `hosted-pairing-host-liveness.test.mjs`). Verified by `npm run test:ci`.

## 6. Browser client

- [ ] 6.1 In the `terminay.com` repository, generate a window id per document and send it with `application-auth`, and update `specs/remote.md` there. Verified by that repository's tests and a two-tab check against a server built from this change.

## 7. Documentation

- [ ] 7.1 State in `docs/operations/standalone-server.md` that each live window takes ports from a pinned ICE range, with the windows a span of four and of sixteen serve. Verified by `npm run test:documentation`.

## 8. Close out

- [ ] 8.1 Remove the one-window-per-remote-server and no-remote-tear-off limits from `one-window-one-server`. Verified by `openspec validate --all` on that branch.
- [ ] 8.2 `openspec validate --all` passes. Verified by its output.
- [ ] 8.3 Open the pull request on `origin` and read back every commit status. Verified by each being `success` or `skipped`.
