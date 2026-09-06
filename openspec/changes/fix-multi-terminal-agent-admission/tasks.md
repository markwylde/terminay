# Tasks

No task is ticked until the stated verification has been run and its output
seen. "Skipped" is not "passed".

## 1. Reproduce before fixing

- [x] 1.1 Add a failing test to `packages/server-core/test/extension-agent-runtime.test.mjs` that admits two terminal sessions of one provider against one host and asserts both are admitted. **DONE.** The existing doubles in that file never enforced the host's uniqueness rule, so a second admission had never been attempted; the new double refuses a repeated context id the way `ExtensionHost.admitAgentTerminal` does. Against unmodified `extensionAgentRuntime.ts` the admitted terminals were `['terminal-1']` where `['terminal-1', 'terminal-2']` was expected — the second terminal is never admitted.
- [x] 1.2 Add a failing test asserting the shipped default context-id function returns different identifiers for two identities at the same incarnation. **DONE.** The test passes no `contextId` option, so it exercises the shipped default. Both terminals report `terminalIncarnationId` `"1"`; before the fix the set of distinct context ids was `1`, expected `2`.
- [ ] 1.3 Confirm the same refusal reaches the Agents pane: an Electron spec driving two stub-CLI terminals in one project that expects two rows and sees one. Verified by the spec failing on unmodified code, with the diagnostic line from the app log quoted in the failure.

## 2. Fix the host

- [x] 2.1 Derive the default context id from `serverId`, `projectId`, `sessionId` and `incarnation` together, keeping the registry nonce prefix. **DONE.** The identity is folded in as a nonce-keyed SHA-256 digest with NUL separators, so the id stays opaque and cannot collide by construction. 1.1 and 1.2 pass; `extension-agent-runtime.test.mjs` is 32 pass / 0 fail; the full `packages/server-core` suite is 762 pass / 0 fail / 0 skipped with no other test changed. Re-verified by stashing the source fix and observing both new tests fail again.
- [ ] 2.2 Confirm no other identifier in the agent runtime discards terminal identity. Verified by reading every `makeContextId`, `publicationId`, and stream-id construction in `activity/` and recording what each is keyed on.
- [ ] 2.3 Verify the fix in the running application: two terminals, same provider, both rows in the Agents pane, and no `agent-admission-failed` line in `~/Library/Logs/Terminay/`. Verified by running the built app and pasting the sidebar screenshot and the log tail.

## 3. Stop the test seam hiding the default

- [ ] 3.1 Export the default context-id function so a test can assert the shipped behaviour rather than a double. Verified by 1.2 importing it.
- [ ] 3.2 Audit every `contextId:` injection in `packages/server-core/test/`. Where a test's double would mask a collision, either drop the injection or give the double the same identity dependence. Verified by listing each injection site and its disposition here.

## 4. Concurrency in the shared conformance harness

- [ ] 4.1 Let `createConformanceHarness` hold more than one PTY and observation context, reporting each session's events separately. Verified by a harness self-test in `tests/agent-conformance/harness.test.mjs` driving two shells and asserting the event streams do not merge.
- [ ] 4.2 Add a `concurrent` step to `runConformance`: launch a second session of the same provider in its own PTY and the same working directory; assert both bind, that their provider session ids differ, that work in one moves only that session's state, and that quitting one leaves the other bound. Verified by the step failing when pointed at a deliberately single-binding stub.
- [ ] 4.3 Add the `secondLaunch` gesture to every provider descriptor. Verified by `assertRowIsComplete`-style validation failing for a descriptor that omits it.

## 5. Close the existing harness gaps found in the audit

- [ ] 5.1 Assert `idle` — before any work, and again between turns. All four matrix rows claim `idle: Y` and the harness never awaits it. Verified by `grep -n "awaitState('idle')" tests/agent-conformance/matrix.mjs` returning a hit and by a run reaching it.
- [ ] 5.2 Guard the resume step on `row.resume` and assert non-rebinding when it is `N`. Codex declares `resume: 'N'` and the harness runs the step unconditionally, so Codex cannot pass. Verified by the Codex conformance run reaching the end instead of stopping at resume.
- [ ] 5.3 Assert the completion outcome on `done`, that the root stays `working` until the last child finishes, and that resume replays no earlier transitions. Verified by each assertion failing when its condition is inverted in a scratch run.

## 6. Per-extension conformance descriptors

- [ ] 6.1 Add a `secondLaunch` gesture to the Claude Code, Codex, Grok and OpenCode descriptors. Verified by each provider's conformance run reaching the concurrent step.
- [ ] 6.2 Add a conformance descriptor for Cursor. It ships as an agent extension with no descriptor and a `--print` smoke test that never involves a PTY, the provider, or a lifecycle event. Verified by a real-CLI run reaching at least detect, title and done, and by its matrix row recording honestly what it cannot do.
- [ ] 6.3 Add a conformance descriptor for omp, whose only real-CLI file is not even in the test glob. Verified as for 6.2.
- [ ] 6.4 Decide whether Cursor and omp join the published capability matrix. Verified by the decision recorded in `design.md` and the matrix table updated or explicitly left alone with a reason.

## 7. Running application coverage for every provider

- [ ] 7.1 Build a stub CLI per provider that writes that provider's real journal format, following the existing Grok stub in `e2e/fixtures.ts`. Verified by each stub's output binding through the unmodified production provider, not a test-only path.
- [ ] 7.2 Add an Agents-pane Electron spec per provider driving two terminals in one project and asserting two rows with independent states. Verified by each spec passing on the fixed code and failing on the reverted fix.
- [ ] 7.3 Ensure these specs run on an ordinary `npm run test:e2e` with no credential gate set. Verified by running the suite with every `TERMINAY_REAL_*` and `TERMINAY_CONFORMANCE_*` variable unset and counting the specs that executed.
- [ ] 7.4 Keep the opt-in real-CLI Electron specs for Claude Code and Codex, and add the missing ones for Grok, OpenCode, Cursor and omp. Verified by each being run once by hand with a real CLI and its result recorded in this file, pass or fail.

## 8. The Claude Code shared-directory rule

- [ ] 8.1 `extensions/agent-claude-code/test/shared-project.test.mjs` already fails on `main`: two terminals in one directory both bind whichever journal was appended last, because `projectJournalCandidate` selects by modification time and uses nothing about which process wrote it. Verified — the failing output is recorded in commit `a8755e16`.
- [ ] 8.2 Bind each terminal to the journal its own process is writing. Verified by 8.1 passing without weakening the existing ambiguity rules, and by the rest of the Claude Code suite still passing.
- [ ] 8.3 Check the same class of defect in Codex, Grok, OpenCode, Cursor and omp: does any of them select among candidates by timestamp rather than by process identity? Verified by a per-provider note here, and a failing test for each one that does.

## 9. Closeout

- [ ] 9.1 Run every agent extension's unit suite. Verified by the pass/fail/skip counts for each recorded here, with skips named rather than counted as passes.
- [ ] 9.2 Run the full end-to-end suite through `npm run test:e2e`. Verified by the run output recorded here.
- [ ] 9.3 Run each provider's real-CLI conformance where a CLI is provisioned on this host. Verified by recording, per provider, the last step reached and whether it was green — not "green" for a run that skipped.
- [ ] 9.4 Re-run the original user reproduction: several terminals, several providers, one project. Verified by a screenshot of the Agents pane with a row per terminal.
