## 1. Reducer

- [x] 1.1 Add a `settled` flag to the reducer session, set on user input, command executing, and non-zero progress. Verified by reducer unit tests reading acknowledgement after those signals.
- [x] 1.2 Guard raw output, foreground busy-to-idle, lone command-finished, and progress-zero acknowledgement clearing behind `settled`, leaving status derivation and bell or notification attention untouched. Verified by new reducer tests for start-up noise, first command after typing, lone finished marker, structured settlement, and bell before settlement.

## 2. Tests

- [x] 2.1 Update any existing reducer or service tests that assumed finished from raw or foreground evidence with no prior input, preserving their intent by adding an input or executing marker. Verified by `npm test` in `packages/server-core` passing.

## 3. Verification

- [x] 3.1 Run `npm run lint` and the server-core test suite. Verified by both green.
- [x] 3.2 Confirm the end-to-end activity suites still pass in the Docker-isolated runner (`npm run test:e2e`). Verified by CI or a Docker host; not runnable on this machine.
