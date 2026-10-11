## 1. Protocol

- [x] 1.1 Add the notification record, `notifications.snapshot`, `notifications.delta`, `notifications.dismiss`, and the `notifications.probe` event beside activity's wire types in `packages/server-core` and `packages/client-core`, with the id and exact project and session ids on dismiss, and the `notifications.v1` capability in `packages/protocol`. Verified by protocol tests accepting valid messages and rejecting malformed, oversized, and unknown-field messages, and by a test that every operation name is a valid wire operation name.
- [x] 1.2 Add the two control-endpoint operations for sending and dismissing a notification, with the title and body bounds. Verified by tests for a valid send, a replace by handle, an over-long body, and an over-long title.

## 2. Notification manager

- [x] 2.1 Add the manager to `packages/server-core` with `add`, `update`, and `remove`, records owned by a server-resolved project and session, and an injectable clock. Verified by unit tests that an add is pending, and that the manager exposes no pending record to its consumers.
- [x] 2.2 Implement the settle period: publish at five seconds if still present, never publish a record removed while pending, publish a published record's removal at once, and keep publication state across an update. Verified by fake-clock tests for removed at three seconds, present at five, a change at three published at five with the current kind, and a change after publication published at once.
- [x] 2.3 Arm one timer per pending record on add and cancel it on remove, with no interval sampling. Verified by a test asserting no timer exists while nothing is pending and exactly one per pending record.
- [x] 2.4 Feed the manager from the activity reducer: one activity record per terminal while it is unacknowledged and needs attention or has finished, with the kind taken from provider state or fallback signals. Verified by tests for each of the five kinds, for a working terminal producing none, and for waiting becoming finished updating the same record.
- [x] 2.5 Remove every record of a terminal on acknowledgement and on terminal close, and leave them on project activation. Verified by tests for typing, `activity.acknowledge` (which is what tab selection sends), and close; project activation sends the server nothing, which the existing project-dot e2e scenario covers.
- [x] 2.6 Publish snapshots and deltas on the ordered event journal with the activity projection's revision and resync rules, scoped by project. Verified by tests for a client connecting during a settle period, a replay gap requesting a snapshot, and a project-scoped client receiving only its own terminals' notifications.
- [x] 2.7 Handle `notifications.dismiss`: an activity record acknowledges its terminal, a message record removes only itself, and mismatched ids are refused. Verified by tests for each case and for a dismissal reaching a second connected client.
- [x] 2.8 Re-establish activity records after a restart and settle them again; restore no message record. Verified by a restart test for each.

## 3. Sent notifications

- [x] 3.1 Handle the send operation in the control endpoint's operation table: resolve the owner from the capability, strip control characters and escape sequences, enforce the bounds, add a message record without touching activity state, and return an opaque handle. Verified by tests for a send, markup and escape sequences in the body, and the terminal's activity snapshot being unchanged.
- [x] 3.2 Replace in place when given the handle of a notification the calling terminal sent. Verified by a test that the record keeps its id and publication state and no second record exists.
- [x] 3.3 Handle the dismiss operation, refusing a handle from another terminal and the terminal's own activity record as not found. Verified by a test for each refusal and for a successful dismiss.
- [x] 3.4 Enforce eight message records per terminal and a per-terminal send rate. Verified by tests for the ninth send failing with the eight unchanged and for the rate limit refusing a burst.
- [x] 3.5 Emit `notifications.probe` when a process sends a notification, and have the client whose user is interacting with that terminal answer with the activity acknowledgement. Verified by a test in which a real client answers the probe and the notification is never published.
- [x] 3.6 Leave `OSC 9` and `OSC 777` message bodies unused. Verified by a test that such a signal yields an attention record with no title or body.

## 4. MCP

- [x] 4.1 Add `send_notification` and `dismiss_notification` to the stdio adapter with descriptions that state the settle period, removal on interaction, and that a notification sent while the user is in the terminal is not shown. Verified by adapter tests for both tools and by the capability report listing them.
- [x] 4.2 Add the Notifications permission group to the server's operation table and its default to settings. Verified by tests that `send_notification` is evaluated under Notifications, that a fresh server has it Always Allow, and that Ask Permission prompts with the title and body and Never Allow refuses.
- [x] 4.3 Add the group's row to Settings > AI > Terminay MCP. Verified by an e2e scenario changing it from one client and reading the same value from another.
- [x] 4.4 Call the send operation over the control socket without an MCP client. Verified by a test that speaks the control protocol directly with a terminal's capability and observes the notification.
- [ ] 4.5 Extend the Docker-isolated provider compatibility test to call `send_notification` from a supported agent CLI. Verified by that test passing.

## 5. Workspace UI

- [x] 5.1 Add a client projection for notifications beside the activity projection, reusing its revision and resync handling. Verified by unit tests for contiguous deltas, a gap, and a resync replacing the projection.
- [x] 5.2 Render the header count and Notifications list from the published set, word activity headlines from the kind, and render sent notifications with their title, body, terminal, and project. Verified by the existing `scripts/notification-text.test.mjs` and `scripts/notifications-control.test.mjs` updated to the new source, plus a case for a sent notification row.
- [x] 5.3 Send `notifications.dismiss` from a row's dismiss control and from **Clear all**. Verified by e2e scenarios for dismissing one of two notifications on a terminal and for **Clear all**.
- [x] 5.4 Report the published count to Desktop for the icon badge. Verified by the existing badge e2e scenario, with the badge following the header after the settle period.
- [x] 5.5 Use the client-side derivation in `src/workspace/TerminalActivityOverview.tsx` only for a server that does not advertise `notifications.v1`, and confirm tab and project dots still come from activity state. Verified by the app typecheck passing and an e2e scenario where a tab indicator turns red at once and the header count rises after the settle period.
- [x] 5.6 Decide whether the sentence in `workspace-and-project-tabs` about project dots sharing the list's items needs rewording, and add the delta if so. Verified by the answer recorded in `design.md` and `openspec validate --all` passing.
  - Result: it does. The dots keep reading per-terminal indicator state while the list reads the published set, so the two no longer share items. `specs/workspace-and-project-tabs/spec.md` restates the requirement and adds that the dot does not wait for the settle period.

## 6. Tests that assumed an immediate count

- [x] 6.1 Find e2e scenarios that assert a header count or icon badge directly after a terminal finishes and move them to the test clock. Verified by `npm run test:e2e` passing for the notification, activity, and badge suites with no added sleeps.

## 7. Validation

- [x] 7.1 Run lint, typecheck, and the unit suites. Verified by each command exiting zero.
- [x] 7.2 Run `npm run test:e2e` for the affected suites. Verified by them passing.
- [ ] 7.3 Check by hand in a development run: an agent finishing in a background terminal turns its tab green at once and reaches the bell and Dock badge five seconds later; clicking the tab within five seconds leaves the bell untouched; an agent's `send_notification` appears with its text and clears when the terminal is typed in. Verified by a screen recording of the three cases.
- [ ] 7.4 Rebase this change's `agent-status-and-sidebar` delta if `one-window-one-server` has been archived first. Verified by `openspec validate --all` reporting no archive refusal for this change.
- [x] 7.5 Run `openspec validate --all`. Verified by it reporting no errors.
- [ ] 7.6 Open the pull request on `origin` with `tea` and read back every commit status. Verified by every status being `success` or `skipped`.
