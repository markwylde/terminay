## 1. Saved-server detail

- [x] 1.1 In `SharedConnectionsRouteBody`'s settings presentation, render a **Connection** block (status, address, actions) and a **Danger zone** block with Forget and Revoke as described rows. Verify: the E2E test "A saved server says whether this window holds it…" asserts the two section titles.
- [x] 1.2 Turn the chosen danger row into an inline confirmation naming the server, with Cancel focused and a solid danger button. Verify: the E2E forget test asserts the "Forget Build box?" heading, the scope copy, Cancel focus, cancel, and confirm.
- [x] 1.3 Change the page-presentation confirmation heading to "Forget <name>?". Verify: `rg "local profile\?" src` prints nothing.

## 2. Saved-server status

- [x] 2.1 Carry `attached` and `status` from the host's profile summaries into the list and detail. Verify: the E2E test asserts "Connected · attached", "Saved · not attached", and the attached detail's pill and copy.

## 3. Verification

- [x] 3.1 Run `npm run test:e2e -- e2e/settings-remote-access.spec.ts` and attach its screenshots to the pull request. Verify: the run passes and the screenshots show the spaced, red-marked confirmation.
- [x] 3.2 Run `openspec validate --all`. Verify: it passes.
