# E2E stability investigation, 1 November 2026

## Evidence

Reviewed Gitea CI workflow runs created from 1 October 2026 through
1 November 2026 at approximately 10:00 UTC. The API returned 526 CI runs:
325 successful, 84 failed, 116 cancelled, and one still running. Of 54 rerun
workflows, 44 eventually succeeded. Earlier attempts remain important: the
latest successful run alone hides the original failure.

Downloaded failed E2E job logs for the current and earlier attempts: 142
failed job records across 84 workflow runs. Twenty-seven of those workflows
ultimately succeeded on a rerun. These counts include product regressions and
infrastructure failures, so they are not a flake rate.

Recurring failures, counted once per failed job rather than once per retry:

| Journey | Failed jobs | Evidence and disposition |
| --- | ---: | --- |
| Worktree capture, original journey | 16 | `cap-two` never appears after closing Settings. |
| Worktree capture, current journey | 5 | [Run 22686](https://git.i.wylde.net/markwylde/terminay/actions/runs/22686), job 66480, prints `giree add` and `gitee add` instead of `git worktree add`. Main already contains the native-focus fix from PR 470. |
| TypeScript language intelligence | 14 | [Run 17063](https://git.i.wylde.net/markwylde/terminay/actions/runs/17063) includes missing `greet` suggestions. The test used page-wide keys immediately after clicking the editor. |
| Large-file ranged editing | 13 | [Run 17109](https://git.i.wylde.net/markwylde/terminay/actions/runs/17109) includes renderer crashes. Its disk-prefix assertion also unnecessarily read the complete 100 MiB file on each poll. Removing that allocation reduces test-process pressure; it does not establish the cause of renderer crashes. |
| Worktree move/delete, original journey | 7 | Historical failures must be distinguished from the current folder implementation and input helper. |

Other useful examples:

- [Run 22328](https://git.i.wylde.net/markwylde/terminay/actions/runs/22328),
  job 63968: the automation test's server-input assertion receives only the
  suffix of its shell command. `submitTerminalCommand` still used unpaced
  page-wide typing without attachment or native-focus checks.
- [Run 22470](https://git.i.wylde.net/markwylde/terminay/actions/runs/22470):
  the mirror acknowledgement journey fails and the rerun succeeds. Main already
  includes `2484d8b2`, which finds a snapshot by epoch instead of assuming it is
  the last batch. No additional assertion relaxation is needed here.
- Historical AI note tests include dock-tab activation failures. The baseline
  repeated runs described below did not reproduce them; no speculative tab
  activation retry was added.

## Follow-up during PR validation

Current main's [run 22724](https://git.i.wylde.net/markwylde/terminay/actions/runs/22724),
job 66715, failed the terminal-move-back journey. Repeating that journey locally
without retries reproduced it once in ten executions: immediately after moving
back, the tab-count snapshot was `[0, 0, 0]`; the later failure snapshot showed
the correct destination tab. The helper's `toContainText('Project')` also accepts
`Project 2`, so it can return before the destination is active. The workspace
revision barrier does not prove Dockview has drawn its child tabs.

The switch helper now checks the exact project title. The move helper also
waits for the moved tab in the active destination and for exactly one such tab
across all projects. The tests retain their immediate distribution assertions
after subsequent workspace synchronization, and still verify live terminal
output.

Additional regression command:

```sh
npm run test:e2e -- e2e/terminal-move-between-projects.spec.ts \
  --repeat-each=10 --retries=0
```

## Changes

- Share terminal attachment, presentation ownership, DOM/native focus, rendering
  handoff, and paced keyboard input between both terminal-input helpers.
  Preserve callers that select a specific terminal panel.
- Address Monaco's actual editing input (EditContext or textarea), assert focus,
  and pace its completion expression. Keep the automatic `greet` suggestion assertion.
- Read only the asserted 128-byte disk prefix in the large-file journey, closing
  the file handle after every observation. Keep the fixture above the product's
  large-file threshold and retain all edit assertions.

These are test-harness changes. Product behavior, retries, timeouts, and CI gates
are unchanged; there is no product-contract delta to propose or archive.

## Validation

Baseline on `c9bf02a8`, before edits: nine Docker E2E executions passed (three
repetitions each of TypeScript completion, large-file editing, and worktree
capture), with retries disabled. Another 40 baseline executions passed: ten
repetitions each of automation input, manual AI rename, typed note persistence,
and TypeScript completion. Local baseline success does not disprove the CI
failures or demonstrate that every historical failure is resolved.

Patched consumer coverage: 10 passed, one existing opt-in MCP example test
skipped, with retries disabled. Command:

```sh
TERMINAY_E2E_IMAGE_IS_PRELOADED=1 npm run test:e2e -- \
  e2e/app-windows.spec.ts e2e/mcp-approvals.spec.ts \
  e2e/terminal-recovery-beyond-replay-window.spec.ts --retries=0
```

The image was built from this worktree by the preceding `npm run test:e2e`.
Targeted repeated coverage: **115 passed in 6.8 minutes**, five repetitions of
23 journeys, with retries disabled:

```sh
npm run test:e2e -- \
  e2e/automations.spec.ts e2e/terminal-signals.spec.ts \
  e2e/ai-tab-metadata.spec.ts e2e/file-viewer-language.spec.ts \
  e2e/file-viewer-conflicts-large-files.spec.ts e2e/linked-folders.spec.ts \
  --grep 'TypeScript project|large text files|a terminal that runs git worktree add|terminal needs attention|keeps a typed note|manual rename|terminal activity signals' \
  --repeat-each=5 --retries=0
```

Artifacts are in `.docker-cache/e2e/20261101T100853Z-5048` (repeated run) and
`.docker-cache/e2e/20261101T100945Z-5890` (consumer run) in the worktree.

The image's application build and TypeScript checks passed. Biome lint passed
for all four changed TypeScript files; `git diff --check` passed; and
`openspec validate --all` reported 97 passed, zero failed, with existing warnings.

These local runs used Linux arm64 containers. Gitea uses Linux amd64 E2E
runners; see PR 473's head checks for its current CI results. The remaining renderer
crash cause needs CI evidence if it recurs; this patch removes unnecessary
allocation in the test without claiming to establish that cause.
