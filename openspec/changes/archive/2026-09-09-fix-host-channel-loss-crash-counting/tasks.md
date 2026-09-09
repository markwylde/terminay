## 1. Say why the write failed

- [x] 1.1 Change `ExtensionHost.send` to report `sent`, `channel-closed`, or `too-large` instead of a boolean. Verified by `npm run typecheck --workspace @terminay/server-core` passing with every call site updated.
- [x] 1.2 Keep `too-large` a protocol violation at every call site, with a diagnostic naming the size limit. Verified by a case in `packages/server-core/test/extension-host-diagnostics.test.mjs` asserting an oversized frame still terminates and records a violation naming the limit.
- [x] 1.3 Make `channel-closed` end the operation quietly, recorded as a closed channel rather than a violation. Verified by a case asserting no termination, no crash counted, and a record that does not mention a size limit.

## 2. Count the death, not its discoverers

- [x] 2.1 Count a failure only while the child for that incarnation is present, and record later failures for the same dead incarnation without opening a new crash. Verified by a case where several pending acknowledgements all fail after the child dies and exactly one failure is counted.
- [x] 2.2 Confirm a burst of failed acknowledgements no longer quarantines. Verified by a case with ten in-flight publications resolving after the child died, asserting the extension is `failed` with one consecutive failure rather than `quarantined`.
- [x] 2.3 Confirm genuinely repeated deaths still quarantine. Verified by the existing crash-window cases in `extension-host-diagnostics.test.mjs` and `extension-restart-supervisor.test.mjs` passing unchanged.

## 3. Keep the exit status the system reported

- [x] 3.1 Record the observed exit code or signal before any teardown detaches the child's listeners. Verified by a case where a child exits with a real code during an in-flight operation and the recorded exit carries that code rather than a synthetic signal.
- [x] 3.2 Make host-initiated termination record itself as the host's own termination, and not overwrite an exit already observed for that child. Verified by a case asserting one exit record per child, carrying the observed status where there was one.
- [x] 3.3 Confirm a child killed without reporting still leaves an exit record. Verified by the existing SIGKILL case in `extension-host-diagnostics.test.mjs` passing.

## 4. Discovery backs off instead of sweeping

- [x] 4.1 Grow the re-arm interval for a terminal that exhausts its fast window without binding, doubling from the topology poll interval to a ceiling. Verified by a new case in `packages/server-core/test/extension-agent-runtime.test.mjs` with an injected clock asserting the widening intervals.
- [x] 4.2 Reset the interval on new evidence — a changed topology signature, a foreground change, or a return to the shell. Verified by cases asserting the base interval is restored after a changed signature and after a shell return. The reset is implemented for all three; a bare foreground change over a live context is not separately asserted because the registry deliberately does not re-arm discovery for a non-matching name while a context is live, so a shell return is the path that observably exercises it.
- [x] 4.3 Confirm a journal that appears late still binds. Verified by the existing late-journal and topology-poll cases in `extension-agent-runtime.test.mjs` passing unchanged.

## 5. Verification

- [x] 5.1 Run the server-core workspace tests. Verified by them passing.
- [x] 5.2 Run `npm run test:agents`. Verified by it passing — 23 suites, zero failures. It fails first against a worktree's default resolution of `@terminay/extension-api`, which points at the main checkout's built `dist`; that build is older than its own source and lacks a field this repository already uses. Building that package and resolving it locally clears it, and CI builds from source.
- [x] 5.3 Run `npm run lint` and the server-core typecheck. Verified by both passing clean.
- [x] 5.4 Replay the recorded failure shape: assert that the burst which quarantined Claude Code — one child death with ten pending acknowledgements — now yields one failure, a real exit status, and a scheduled restart. Verified by the group 2 and 3 cases together.
