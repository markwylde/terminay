# Stabilisation evidence

All E2E runs used `npm run test:e2e` in Docker with `--retries=0 --workers=2`.

## Worst two tests

| Test | Before | After |
| --- | --- | --- |
| `folder-launch`: native and argv folder launches | 5 of 15 | 25 of 25 |
| `project-start-chooser`: many recent folders | 9 of 15 | 25 of 25 |

## Remaining flaky list, 10 repeats each

139 of 140 passed. The one failure was `task20-queue-bounds`, from `holdRendererClock` reading a clock that had moved past its 100 ms margin (`Cannot fast-forward to the past`).

## Every file using `holdRendererClock`, after its fix, 10 repeats

226 passed, 0 failed. Four `documentation-sidebar-editor` runs did not start because this oversized run reached Playwright's 480-second global timeout.

## Combined run, 3 repeats

All listed tests together: 48 of 48 passed.

## Cold bot image build

A no-cache, `--pull` production build took 311 seconds on the development host. The failing CI run was still in its `apt` layer at the previous 600-second limit. The pull request's CI duration still needs confirmation alongside task 5.4.

## Worktree review, 2026-11-21

Reviewed `git diff main...HEAD`, `git diff`, and the new untracked source and planning files. The committed branch also includes `desktop-remote-recovery`; its native packaged macOS wake check remains open in that change's tasks.

Fixed three issues found in review:

- An in-page editor's delayed commit completion could close a newer auxiliary route. Keep its input hold until close, close only when the submitting editor is still current, and give each edit request its own mounted form so the next editor starts with its own draft and saving state. Added tests for a replacement editor and failed commit wait.
- A presentation write following an explicit root move could repeat that move after another client committed a different root. Rebuild presentation writes from the latest root, and return the final refreshed root to the local projection. Added the concurrent-client regression test.
- The macOS install had retry flags but no command deadlines. Added portable 120/300-second bounds that terminate the command's process group, plus failure and stalled-command tests. Added contract checks for the macOS flags and bot build/job bounds.

TypeScript and lint of the edited source files passed. Repository lint exited 0 with existing warnings; its first run overlapped a test's temporary-directory cleanup and also printed a Biome directory-read diagnostic. The affected ownership suite passed 23 of 27 tests: four existing assertions still expect the old Settings pairing placement, direct drag calls, no App layout listener, and the old activity projection expression. Those mismatches are also present on `main` and are outside these review fixes.

The focused editor, view, settlement and CI suites passed 31 of 31 tests. The adjacent remote, byte-transport, document-lifecycle and hosted-pairing suites passed 37 of 38 initially. The remaining standalone-CLI check passed after completing `build:server-postcompile` and running with `TERMINAY_HTTP_PORT=0 TERMINAY_HEALTH_PORT=0`: the local build initially lacked its release-integrity manifest, and the inherited health-port setting collided with an existing listener on 8444. No existing listener was stopped.

After the final editor-form remount adjustment, the folder-launch and many-recent-folders chooser tests both passed through `npm run test:e2e -- e2e/folder-launch.spec.ts e2e/project-start-chooser.spec.ts --grep 'native and argv|many recent folders' --retries=0 --workers=2` (2 of 2, 9.3 seconds). Artifacts: `.docker-cache/e2e/20261121T214917Z-1809842`. The Docker application build also passed its TypeScript compilation.

`openspec validate --all` validated this change and reported 125 passing items and eight failures in other active changes: `add-terminay-bots`, `daemon-restart-keeps-terminals-usable`, `linked-folders`, `one-window-one-server`, `outbound-bot-triggers`, `phone-review-fixes`, `server-notification-manager`, and `unified-settings-window`. No new server scope or Electron privilege expansion was found in the reviewed changes. Gitea head-status verification remains incomplete; uncommitted fixes cannot be verified by existing commit statuses.

| Verification dimension | Result |
| --- | --- |
| Completeness | 18 of 19 tasks complete; task 5.4 remains open pending Gitea verification of the eventual committed fixes. |
| Correctness | All four added/modified requirements mapped to implementation and scenario coverage; targeted unit and Docker E2E checks passed. Earlier flake-repeat and cold-build measurements were reviewed from the evidence above, not repeated during this review. |
| Coherence | Implementation follows the updated design; no new privilege or project/session scope expansion found. |

## Re-measurement on the reviewed code

The reviewed code passed both worst tests 25 of 25 each, and the remaining list 136 of 140. The four failures were three test races, each fixed at its cause:

- `file-viewer-html-preview` (2 failures): the sandbox proxy replaces its inner frame while the page loads, and a locator caught in that swap ends with "Target closed" instead of retrying. The wait now restarts from the outer frame.
- `terminal` drag focus (1 failure): attaching can request focus again a frame after the first request, so the helper's blur now has to hold across two frames.
- `terminal` activity overview (1 failure): a new shell's prompt landing after the last advance of the held clock stayed "working". The test now waits for that prompt before advancing.

After these fixes, with retries off: the three tests passed 25 of 25 each, and the whole remaining list passed 140 of 140.

The first pull request run then failed `bot-composition` with `write EPIPE`: the Bots socket fixture wrote to a fake engine command that had already exited, with no error handler on that pipe. The fixture now handles it, as its other spawn path already did.

The next run was 30 of 30 green, but `bots.spec.ts` "Stop ends a held turn" passed only on retry. The same fixture wrote to an upgraded socket before attaching its error handler, so a client hanging up during Stop ended the test worker. The handler is now attached first.

The run after that exposed two more:

- `linked-folders` card slide failed all three attempts on a slow shard, because it sampled a 180 ms ease-out animation exactly two frames in. It now records the furthest the card was drawn from its place, and passed 30 of 30.
- `macros` "an empty category survives reopening" hung on reload. Settings showed "Saved" before its passive effect removed the unsaved-changes `beforeunload` guard, so a reload in that gap opened a native dialog. The guard is now a layout effect, removed in the same commit as the "Saved" text. That test then passed 40 of 40.
- `macros` "drags a macro into a category" lost a drop when the button was released before the target had accepted a dragover. The macro and category drags now release only once the target shows its drop state.

Pull request #640 merged at `09d4f329`, whose 30 commit statuses all read back as `success` after two E2E shards were re-run. The slide, reload and drag fixes above landed in the follow-up pull request.

The follow-up's first run failed `server-upgrade` "restarts and rolls back" on all three attempts, and 4 of 10 locally. A focus trace showed the workspace remounting behind the upgrade card after the reconnect, and its terminal taking keyboard focus from Close, so a key meant for the card would reach the shell. A terminal's automatic focus, including the search-closed effect that also runs on mount, now leaves focus on the card. The test then passed 30 of 30, and the server-upgrade, terminal, project-tab and project-start files passed with retries off.

The next run's `desktop-loopback` "reopens straight onto" passed only on retry, having counted no page loads on an unreachable-server start. Its recorder attaches after launch, so it now also reads the window's navigation history. The same run's macOS smoke failed on `CERT_NOT_YET_VALID` while fetching native build headers, outside the repository.

The review's archive condition, task 5.4, is met. Full-suite cleanliness is not established: the four ownership assertions and eight unrelated OpenSpec failures remain as described above. The separate desktop remote recovery change also retains its physical packaged macOS wake verification task.
