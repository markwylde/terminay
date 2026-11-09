## 1. Launch input and lifecycle

- [x] 1.1 Implement literal directory argument normalization for positional paths, local file URLs, both working-directory forms, and `--`; verify unit cases for relative paths, spaces, Unicode, shell characters, runtime switches, malformed options, invalid URLs, repeated/mixed options, and atomic syntax rejection.
- [x] 1.2 Add early native open-file capture, initial argv handling, ordered second-instance additional-data forwarding, and a serial readiness queue; verify cold/warm delivery, repeated intentional requests, error continuation, and no-operand focus, queue capacity, startup failure, and presentation timeout with unit/integration tests.
- [x] 1.3 Prevent updater and recovery relaunches from replaying original folder operands; verify relaunch arguments with focused tests.

## 2. Local server and presentation

- [x] 2.1 Resolve canonical local directories and reuse/create exact-root projects through server workspace authority; verify existing-project reuse, symlink identity, invalid paths, and no remote-server routing.
- [x] 2.2 Create a fresh terminal and durable panel at explicit cwd using server shell/profile policy; verify actual initial cwd, working-directory policy override precedence, repeated launches, and unchanged existing sessions.
- [x] 2.3 Present the project and terminal in an existing or new local workspace window; verify project/panel selection and that a focused remote window retains its server.
- [x] 2.4 Report bounded native launch errors and preserve server failure cleanup; verify missing/nondirectory operands and failed terminal creation leave no invisible live session; verify post-create presentation failure and window closure preserve a discoverable panel, empty-project retry, stderr output, and absence of an exposed native-launch IPC/protocol route.

## 3. Packaging and documentation

- [x] 3.1 Add alternate macOS folder document declarations without changing user defaults or claiming unsupported handlers; verify packaging contract and generated macOS Info.plist.
- [x] 3.2 Document `open -a Terminay`, direct executable positional arguments, working-directory options, literal delimiters, and supported scope; verify examples against parser tests.

## 4. Verification and delivery evidence

- [x] 4.1 Add end-to-end coverage for cold and warm folder requests and actual terminal cwd; run through `npm run test:e2e` in Docker and record results. Screenshots are unnecessary because no visual design changes.
- [x] 4.2 Run a packaged macOS native folder-open smoke check with isolated user data; verify early and already-running Launch Services delivery and actual cwd, recording any external blocker explicitly.
- [x] 4.3 Run appropriate type/build/lint checks and `openspec validate --all`; record baseline failures separately and resolve regressions from this change.
- [x] 4.4 Verify implementation against all scenarios and record evidence in the change; sync/archive completed deltas in this worktree according to the repository workflow, then validate archive content with `openspec validate --all --archived`.
