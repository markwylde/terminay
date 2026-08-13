# Remaining task reconciliation — 2026-08-13

## Scope

This audit reconciles every unchecked Markdown checkbox visible in the Tasks
viewer at Terminay main revision `ad578ef1462ebadcfaa6b5e1fbc28442d72e1fc5`.
It checks active task files, supporting evidence documents, current source and
tests, task history, PR #50, Forgejo run 6747, Forgejo post-merge main run 6749,
and GitHub main CI run 31743416915.

The viewer initially reported 121 remaining checkboxes:

- 113 were in 18 active task files;
- 8 were release-sequence steps in an evidence document, not independently
  owned implementation tasks.

## Corrections

| Correction | Count | Evidence |
| --- | ---: | --- |
| Evidence steps converted from task checkboxes to an ordered list | 8 | `task51-official-package-release-readiness.md`; Task 51 remains the authoritative supply-chain checkbox |
| PR job-shape and green-integration checks completed | 2 | Forgejo PR run 6747 and main run 6749 each contain one build job plus five successful E2E shards |
| Local Desktop diagnostics Docker acceptance completed | 1 | Six cases in `e2e/local-desktop-diagnostics.spec.ts`; main run 6749 passed |
| PTY-derived projection final verification completed | 1 | Focused projection tests remain in CI; main run 6749 passed build and all E2E shards |
| Foreground close-protection verification completed | 1 | Focused policy tests plus Docker terminal/project-window journeys; main run 6749 passed |

Tasks 30, 35, 37, and foreground-close Task 38 are fully complete after these
corrections. Tasks 41 and 42 already had no unchecked items. All six files move
to `specs/tasks_completed/` so the active directory reflects actual work.

## Implementation-only pruning

A second pass applies the active-task policy that an unchecked checkbox must
describe product, runtime, migration, packaging, or enforcement code an agent
can implement. Manual validation, test-only coverage, production observation,
CI-green bookkeeping, publication/deployment evidence, and platform spot checks
remain useful acceptance context but are not active implementation tasks.

That pass removes 54 evidence-only checkboxes and moves Tasks 21, 36, 39, 40,
51, and 53 to `specs/tasks_completed/`. Their governing feature contracts and
completed implementation history remain intact.

## Honest implementation inventory

After both passes, **54 direct implementation checkboxes remain**:

| Active area | Files | Remaining | Implementation still required |
| --- | --- | ---: | --- |
| Shared UI and migration cleanup | Tasks 16, 19 | 7 | Replace remaining legacy renderer/preload data authority and make the extracted shared route tree the production Desktop and web UI. |
| Embedded remote exposure | Task 23 | 5 | Replace the old dual transport presentation, keep Local private, prevent listener fallback, and compose the pinned WebRTC runtime. |
| Server-bundle host architecture | Tasks 27, 28, 29 | 36 | Implement closed host capabilities, signed bundle compatibility, Local/remote Desktop bundle launch, isolated browser bundle execution, state migration, and legacy-host deletion. |
| On-device Parakeet dictation | on-device Task 38 | 3 | Complete disclosure, audio conversion, and pinned runtime/model/license packaging. |
| WebRTC protocol-reader recovery | Task 43 | 3 | Retire a split-brain transport generation and create one fresh generation after application-protocol reader failure. |

Total: `7 + 5 + 36 + 3 + 3 = 54`.

Every remaining checkbox now names code or product behaviour to implement. Test
expectations may accompany implementation in acceptance prose, but they no
longer inflate the active task count as standalone work.
