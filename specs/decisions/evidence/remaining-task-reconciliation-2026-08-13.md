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

## Honest remaining inventory

After the corrections, **108 checkboxes genuinely remain**:

| Active area | Files | Remaining | Audit result |
| --- | --- | ---: | --- |
| Shared UI, migration, and verified server-bundle host cutover | Tasks 16, 19, 23, 27, 28, 29 | 64 | Genuine. Current production still contains `legacyFallback`, the legacy Electron renderer launch, broad compatibility host paths, the old Local Network/WebRTC Relay presentation, and no completed four-host/cross-version bundle gate. |
| WebRTC transport recovery | Task 43 | 21 | Genuine. Task 41/42 architecture is complete, but protocol-reader-only failure, remaining native fault injection, exact attachment evidence, Linux arm64/iOS staging, required CI, deployment, and cleanup evidence are not complete. Parent and nested checkboxes intentionally express both outcomes and their remaining slices. |
| On-device Parakeet dictation | on-device Task 38 | 5 | Genuine. Disclosure, audio conversion, pinned runtime/model/license packaging, worker adverse tests, and injected Docker Electron acceptance remain. |
| Browser manager and public deployment | Tasks 39, 40 | 8 | Genuine. Two repository E2E journeys and six public image/CDN/origin/deployment proofs remain. These cannot be inferred from local source tests. |
| Terminal congestion | Task 36 | 3 | Genuine. Boundary/control-state matrix, MessagePort/WebSocket recovery, and final complete verification remain. |
| Browser auxiliary routes | Task 21 | 1 | Genuine. Static/controller coverage exists, but the listed browser Playwright user journeys are not present as one acceptance flow. |
| Extension and Project Environment release convergence | Tasks 51, 53 | 6 | Genuine. Official npm publication/provenance, full mixed Desktop/browser embedded/standalone acceptance, actual packed-Puzed Electron option journey, corrected completion evidence, and post-release artifact/deployment verification remain. |

Total: `64 + 21 + 5 + 8 + 3 + 1 + 6 = 108`.

## File-by-file disposition

| Task | Before | After | Disposition |
| --- | ---: | ---: | --- |
| 16 shared responsive server UI | 3 | 3 | Current and genuine |
| 19 migration and compatibility cleanup | 7 | 7 | Current and genuine; tied to Tasks 16 and 27–29 |
| 21 web auxiliary routes/menu | 1 | 1 | Current and genuine acceptance gap |
| 23 embedded Desktop exposure | 6 | 6 | Current and genuine; old dual-mode UI still exists in source |
| 27 server-bundle host contracts | 14 | 14 | Current future architecture; partial seams do not satisfy the closed contract/evidence |
| 28 Desktop server-bundle host/state | 20 | 20 | Current future migration; normal Electron startup still uses legacy packaged renderer |
| 29 browser host/cross-version | 14 | 14 | Current future migration and compatibility gate |
| 30 Local Desktop diagnostics | 1 | 0 | Stale checkbox corrected; task completed |
| 35 PR confidence gate | 2 | 0 | Stale external verification corrected; task completed |
| 36 terminal congestion | 3 | 3 | Current and genuine |
| 37 PTY-derived state isolation | 1 | 0 | Stale final verification corrected; task completed |
| 38 foreground close protection | 1 | 0 | Stale verification corrected; task completed |
| 38 on-device Parakeet | 5 | 5 | Current and genuine |
| 39 browser manager drift recovery | 4 | 4 | Current: two repository journeys and two deployment proofs |
| 40 app manager authority cutover | 4 | 4 | Current external deployment work |
| 41 single-owner WebRTC generations | 0 | 0 | Completed file was left active; moved |
| 42 unified renderer recovery | 0 | 0 | Completed file was left active; moved |
| 43 WebRTC recovery acceptance | 21 | 21 | Current and genuine |
| 51 extension ecosystem release/E2E | 3 | 3 | Current and genuine |
| 53 provider journey convergence | 3 | 3 | Current and genuine |

## Important interpretation

An unchecked parent outcome and its unchecked child slice can both appear in
the Tasks viewer. They are not two independent implementation owners, but both
remain honest checkboxes because the parent outcome is not achieved and the
child identifies why. The progress total is therefore a Markdown checklist
count, not a count of isolated engineering tickets.

No remaining checkbox was marked complete merely because related code or a
weaker source/static test exists. External publication, physical-device,
deployed-origin, immutable-artifact, and cross-host claims remain open until
their exact evidence exists.
