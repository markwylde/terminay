# Verification evidence

The user accepted the measured improvement on 2026-11-14 after reviewing both
288-second and 391-second execution critical paths, requested wrap-up, and
rejected reserved runners. The 300-second execution target is reported, not a
claim that every run meets it. Original elapsed time remains visible.

## Requirement coverage

| Requirement | Implementation and evidence |
| --- | --- |
| Balanced E2E shards | Duration/capacity planner, conservative fallback estimates, exactly-once native Playwright selection, shared groups, isolated virtual displays and native-packaging serialization. Real runs 25369 and 25375 passed all eighteen shards; 718 selected identities are preserved. Planner and native-list contracts exercise coverage and invalid identities. |
| Five-minute run budget | `scripts/ci-run-timing.mjs` computes the longest measured execution chain from explicit dependencies and separately records original creation-to-green time. Thirteen timing tests cover dependency chains, missing/cyclic graphs, failed/incomplete checks and ambiguous retries. Run 25369: 288s execution / 1084s elapsed; run 25375: 391s execution / 412s elapsed. |
| npm download cache | Real lifecycle-enabled installs use persistent daemon-owned download volumes, exact Node headers and bounded commands. Provider/installer contracts pass; actual warm installs and bot cache hits were observed in Gitea. Installed dependency trees are not shared. |
| Revision-matched artifacts | Linux producer builds in the supported floor and records archive/AppImage digests. Independent consumers verify transferred bytes before real floor and systemd probes. Runs 25369 and 25375 passed both consumers; prebuilt/archive/provenance contracts verify invalid handoffs and safe source-channel preparation. |
| Timing evidence | Queue, dependency wait, execution, retries and original elapsed time remain separate. Real complete captures require all thirty required head statuses; malformed or ambiguous execution graphs cannot claim the execution target. |

All five added/modified requirements have implementation and scenario evidence.
No requirements are removed or renamed. The canonical spec retains unrelated
layered-image, per-test report and independent-verification requirements.

## Additional checks

- Full local workspace gate: all 31 tasks passed with bounded concurrency and
  disposable tmpfs; production persistence remains unchanged.
- Atomic palette sampling: twenty Docker repetitions passed, without retries
  or relaxing the twenty-distinct-colors assertion.
- Final focused timing/shared-pool/systemd-preparation batch: 31 tests passed.
- Systemd preparation failure, deadline and cancellation tests prove sibling
  cleanup and error propagation; all real A/B/C scenarios passed in Gitea.
- Latest full OpenSpec validation before sync: 107 passed, seven pre-existing
  unrelated active changes failed. The selected change validates successfully.
- Infrastructure PR49 is closed without deployment. The reserved-pool routing
  is removed; Linux jobs continue to select the existing shared pool.

Final delivery requires the final pushed head's thirty statuses to be read back
as success/skipped. Archive and final-head verification are recorded in the PR.

## Delivery verification

Head `464c7329`, run 25378, passed all thirty required jobs and head statuses.
Its first attempt failed before lifecycle tests because esbuild postinstall
returned ETXTBSY; rerunning that single job succeeded. The complete first-attempt
failure history and original 17:20:16 UTC creation remain captured. Actual
readiness took 780 seconds. Retry evidence does not establish an execution
budget result; the report correctly leaves it unknown.

A separate read-only review found no blocking E2E/workspace correctness or
coverage regressions. Native selection, shared fixture ordering, per-worker
displays, per-case archive extraction and live retention boundaries remain intact.
All 56 canonical specs validate. Validation including existing archives reports
283 passes and the same seven unrelated active-change failures.

The five delta requirements were compared against the synced canonical spec
and matched before archive. The change is archived with all fifteen tasks
complete. The archived commit receives a final Gitea status readback before
the PR is reported ready; that result is recorded in the PR description.
