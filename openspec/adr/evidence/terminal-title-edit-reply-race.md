# Terminal title edit reply race — 2026-11-02

Main CI run [23002](https://git.i.wylde.net/markwylde/terminay/actions/runs/23002), after merging PR #479, failed `e2e/program-set-tab-titles.spec.ts:25` in shard 11 on all three attempts. Clearing the manual name `api` showed `Terminal 1` instead of the program title `deploy`. The other 26 jobs succeeded.

The editor awaited `workspaceStore.updatePanel` and then unconditionally applied its draft's fallback title to Dockview. The server publishes the resolved title through a separate live title stream. If that event arrived while the save was in flight, the editor overwrote the already-correct title after the reply and received no subsequent event to repair it.

The fix follows ADR-0058 and the existing `program-set-tab-titles` contract: when the server supplies title sources, submitting an edit supplies only the named-title patch. The editor does not predict or overwrite the displayed title. Servers without title sources retain the existing local display fallback.

Verification:

- A deterministic regression case forces both event-before-reply and reply-before-event orderings. Before the fix it failed with exactly `Terminal 1` versus `deploy` in the event-first case; after the fix it passed.
- `npm run test:program-set-tab-titles`: 12 passed, including legacy fallback and named-title clearing.
- Server title and renderer title-store suites: 33 passed.
- `npm run test:e2e -- e2e/program-set-tab-titles.spec.ts --workers=1 --repeat-each=3`: nine passed in Docker, covering rename/clear, reload and the disabled setting. The same unmodified suite also passed all nine cases on the local arm64 baseline, demonstrating why repeated success alone does not cover the ordering bug found by amd64 CI.
- Application graph build, renderer TypeScript and targeted lint passed. The first fresh-worktree typecheck/server-suite attempts required building their missing workspace dependencies; those checks passed after their normal builds.

PR CI is checked separately on the submitted head before readiness. This repairs existing specified behavior and introduces no architectural decision.
