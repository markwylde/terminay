Tasks marked **(terminay.com)** are done in the sibling `terminay.com` repository, which owns the manager, its service worker, and the hosted services. All others are in this repository.

## 1. Spike on real devices

- [ ] 1.1 Build a throwaway PWA with one push subscription and a test sender, and install it on an iPhone (current iOS) and an Android phone (Chrome). Verified by a banner arriving on each with the app closed.
- [ ] 1.2 Measure silent pushes: send pushes whose handler shows no banner, on both phones, until the platform objects. Verified by a recorded count and outcome per platform (tolerated, generic banner shown, or subscription revoked).
- [ ] 1.3 Measure the badge: set and clear the application badge from the push handler with the app not running, on both phones. Verified by a photo of each Home Screen icon showing the count and then none.
- [ ] 1.4 Confirm a notification can be closed from the push handler by tag on both phones. Verified by a banner disappearing from the lock screen after a second push.
- [ ] 1.4a Block notifications in the browser's prompt on both phones, then allow them again in the device's settings, and note the exact path and whether the page sees the change without a restart. Verified by the recorded steps per platform and the observed permission value before and after.
- [ ] 1.5 Write the results to `openspec/adr/evidence/pwa-web-push-ios-android-spike.md` and settle design D10 and the two open questions it answers. Verified by the evidence file existing and `design.md` stating which installations accept silent state pushes.

## 2. Prerequisite

- [ ] 2.1 Confirm `server-notification-manager` is implemented and archived, so that `notification-manager` is a main spec and the published set exists to read. Verified by `openspec/specs/notification-manager/spec.md` existing and its change sitting under `openspec/changes/archive/`.
- [ ] 2.2 Settle whether the Show indicator for active tabs and Show indicator for finished tabs settings are readable by the server and apply to push. Verified by a line in `design.md` recording the answer and a unit test for each setting if they apply.

## 3. Protocol

- [ ] 3.1 Add the device-scoped operations to `packages/protocol`: enrol, withdraw, and report window visibility, plus the push-support flag in the protocol hello. Verified by protocol tests accepting valid messages and rejecting malformed, oversized, and unknown-field messages.
- [ ] 3.2 Define the sealed push format in `packages/protocol`: version, routing id, sequence, count, bounded outstanding identifiers, the optional notification, fixed padding, and the AES-256-GCM seal with associated data. Verified by round-trip tests, a test that two payloads of different kinds and title lengths seal to the same length, and tests that a wrong key, altered byte, or wrong routing id fails to open.
- [ ] 3.3 Add the three framed-host notification messages to `packages/protocol/src/host.ts`: enrolment request and reply, count report, and banner target. Verified by `packages/protocol/test/host.test.mjs` cases for valid and invalid forms of each, including the count bounds.

## 4. Server

- [ ] 4.1 Store a push enrolment on the device record in `packages/server-core/src/remote/deviceAuthentication.ts` and its persistence in both hosts. Verified by a test that an enrolment survives a restart and holds no endpoint or subscription key.
- [ ] 4.2 Accept enrol and withdraw only from a ticketed peer and only for the sending device. Verified by tests rejecting an unticketed peer and an attempt to change another device's enrolment.
- [ ] 4.3 Track whether each device is watching, from live connections and visibility reports. Verified by unit tests for visible, hidden, connection declared dead, and two windows of one device.
- [ ] 4.4 Add the push sender in `packages/server-core` as a consumer of the notification manager's published set: coalesce a burst, build and seal the current state per enrolment, carry a sent notification's title and body, and skip watching devices. Verified by tests asserting no push for a notification removed before publication, one push after a burst, no push to a watching device, and that the pushed state equals a connected client's notification snapshot.
- [ ] 4.5 Send the current state when a device stops watching and that state differs from the last sent. Verified by a test in which a notification arrives while watching and is pushed after the device reports hidden.
- [ ] 4.6 Post to the configured hosted push origin with bounded backoff, drop the enrolment when the service reports it gone, and send only current state after an outage. Verified by tests against a fake push service for success, refusal, gone, and outage then recovery.
- [ ] 4.7 Honour the installation's silent-push flag: send a state-only push only to installations that accept one. Verified by a test for each flag value on an acknowledgement.
- [ ] 4.8 Delete enrolments on device revocation and on server identity reset. Verified by tests asserting no push is sent to a revoked device and none after a reset.
- [ ] 4.9 Confirm push failure never reaches terminals or clients. Verified by a test in which the fake push service hangs and terminal output, activity deltas, and acknowledgement proceed unaffected.

## 5. Workspace UI

- [ ] 5.1 On connect in a framed session, request the enrolment from the host and send it to the server; withdraw when the host reports notifications off. Verified by an e2e scenario with a fake framed host asserting the enrol operation is sent once per connection and not at all without a host enrolment.
- [ ] 5.2 Report window visibility to the server on change. Verified by a unit test of the reporter and an e2e assertion that hiding the page sends the report.
- [ ] 5.3 Report the notification count to the framed host on mount and on change, alongside the existing Desktop report in `src/App.tsx`. Verified by an e2e scenario where a terminal finishing unviewed reports 1 and dismissing it reports 0.
- [ ] 5.4 Select and acknowledge a terminal when the host hands over a banner target, and leave the selection unchanged when the target no longer exists. Verified by e2e scenarios for an existing terminal in a background project and for a closed one.

## 6. Hosted push service (terminay.com)

- [ ] 6.1 Generate the VAPID key pair, hold the private key as a server secret, and publish the public key to the manager build. Verified by the manager subscribing with that key and the private key appearing in no repository or client bundle.
- [ ] 6.2 Add the enrolment table: token hash, sealed subscription, expiry, and nothing else. Verified by a test that reads the table's columns from the live schema and asserts they are exactly those three.
- [ ] 6.3 Add register, replace, and delete endpoints that take a token and a manager-sealed subscription. Verified by tests for each, and a test that the stored rows of one installation's three enrolments share no value.
- [ ] 6.4 Add the push endpoint: find the row by token hash, open the subscription in memory, apply Web Push encryption and the VAPID signature, forward, and delete the row when the vendor reports it gone. Verified by a test against a fake vendor push service and a test that a wrong token opens nothing.
- [ ] 6.5 Reject any payload not of the exact sealed length and any destination outside the vendor push-host allowlist. Verified by tests for a short payload, a long payload, and a subscription naming an arbitrary host, asserting no outbound request.
- [ ] 6.6 Rate-limit registrations and pushes per token hash and expire unused rows. Verified by tests that the limit refuses one token and not another, and that an expired row is deleted and its token refused.
- [ ] 6.7 Assert the service logs nothing sensitive. Verified by a test that runs deliveries and rejections and searches captured logs for payload bytes, tokens, and endpoints.

## 7. Manager and service worker (terminay.com)

- [ ] 7.1 Add the always-visible Notifications control to the manager with its six states (not yet asked, on, blocked, needs the installed app, not supported, could not be set up), the per-server switch, and the manager's own explanation shown before the browser's prompt. Verified by browser tests for each state, for **Not now** followed by a second ask, for a dismissed browser prompt, and for a server without push support.
- [ ] 7.1a Write the blocked-state steps for each platform (installed PWA on iOS, installed PWA on Android, desktop Chrome, Edge, Firefox, Safari) and select them by platform. Verified by a test per platform asserting the right steps are shown, and by following each set of steps by hand on that platform.
- [ ] 7.1b Re-read the permission on start, on return to the foreground, and on the browser's change event; subscribe and enrol automatically when blocked becomes allowed, and end enrolments when allowed becomes blocked. Verified by browser tests that flip the permission in each direction and assert the control and the enrolments follow with no further input.
- [ ] 7.1c Show a failed subscription or registration as could not be set up with **Try again**, and add **Send test notification**. Verified by a test with a failing registration that then succeeds on retry, and a test that the test banner is shown by the service worker.
- [ ] 7.2 Generate and store each server's routing id, push key, and push token keyed by session origin, seal the subscription, and register it. Verified by a test that two servers' enrolments share no value and that the request body contains no readable endpoint.
- [ ] 7.3 Answer the framed session's enrolment request from `event.origin` alone. Verified by a test in which a session names another origin and receives only its own enrolment.
- [ ] 7.4 Add the `push` handler: select the key by routing id, open and verify, enforce the sequence, update that server's count, show the banner titled with the device's label, close banners no longer outstanding, and show the fixed unattributed line where the platform requires one. Verified by service-worker tests for a valid push, a forged routing id, an altered payload, a replay, and a forgotten server.
- [ ] 7.5 Build the banner body from the fixed headline table and plain-text titles, and keep titles out of the banner's data and all storage. Verified by a test inspecting IndexedDB, `localStorage`, and the notification's data after a banner is shown.
- [ ] 7.6 Add the `notificationclick` handler and the manager route that frames the banner's origin and hands the identifiers to that session once connected. Verified by a browser test that activating a banner for server B while server A is framed frames B and posts the target only to B's origin.
- [ ] 7.7 Keep one count per saved server, accept count reports only for the reporting origin within bounds, show each count in the profile list, and set the icon badge to the sum. Verified by tests for three servers with two each showing 6, an out-of-bounds report rejected, and a report from one origin leaving the others unchanged.
- [ ] 7.8 Reconcile a server's banners and count when its session connects. Verified by a test in which a stale banner is closed on opening that server.
- [ ] 7.9 Handle `pushsubscriptionchange` and manager start-up by re-sealing and replacing every enrolment's row. Verified by a test that a replaced subscription updates all rows without any session being framed.
- [ ] 7.10 On forget and on notifications off, delete the server's key, token, count, banners, and hosted row, and withdraw from the server when reachable. Verified by tests for a reachable and an unreachable server.
- [ ] 7.11 Title notifications raised through the framed-host `notification.show` message with the device's label for that origin, with the session's text in the body. Verified by a test in which a session supplies another server's name as its title.

## 8. Operations and documentation

- [ ] 8.1 Document push in `docs/operations/`: the hosted push origin a server must reach, what it sends, and that a server without that route sends nothing. Verified by the runbook naming the origin and the failure mode.
- [ ] 8.2 Add push to the remote-access section of `docs/product-overview.md`. Verified by the overview describing banners, the icon badge, and the content-blind hosted service.

## 9. Validation

- [ ] 9.1 Run lint, typecheck, and the unit suites in both repositories. Verified by each command exiting zero.
- [ ] 9.2 Run `npm run test:e2e` for the affected suites. Verified by them passing.
- [ ] 9.3 End-to-end on real phones with two paired servers: a banner from each under its own label, the icon showing the sum, a clear made on Desktop reaching the phone, and opening a banner landing on its terminal. Verified by screenshots of each step on an iPhone and an Android phone.
- [ ] 9.4 Attempt the forgery: from one paired server, send a push naming the other's routing id. Verified by no banner naming the other server and its count unchanged.
- [ ] 9.5 Run `openspec validate --all`. Verified by it reporting no errors.
- [ ] 9.6 Open the pull request on `origin` with `tea` and read back every commit status. Verified by every status being `success` or `skipped`.
