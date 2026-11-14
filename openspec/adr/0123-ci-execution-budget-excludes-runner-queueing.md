# ADR-0123: CI execution budget excludes runner queueing

Status: accepted, supersedes ADR-0121 in part
Date: 2026-11-14
Supersedes: ADR-0121 (the five-minute budget accounting only; complete coverage, isolation, provenance and platform boundaries continue)

## Context

The owner now accepts a five-minute execution target excluding runner queueing and rejects dedicated runners. Run 25369 passed all 30 required checks in 1,084 seconds of actual elapsed time. Its producer executed for 191 seconds and systemd for 97 seconds, yielding a queue-excluded dependency path of 288 seconds. Shared-runner admission waits account for much of the difference. Infrastructure PR 49 was closed without deployment. These facts remain evidence, rather than being rewritten to make elapsed time appear shorter.

## Decision

Compare the longest dependency-chain sum of required job execution durations with a target below 300 seconds. Measure each job from start through completion, including setup, cold downloads/cache work, tests, artifact transfer, reporting and teardown. Exclude runner admission queueing from that execution metric, while also reporting the unchanged original creation-to-green elapsed time and queue waits. Keep all required checks and boundaries from ADR-0121 and the cache policy from ADR-0122. Preserve failed attempts and timestamp uncertainty; incomplete or ambiguous evidence cannot prove the target. Keep the existing shared fleet; dedicated-runner provisioning is outside this change.

This replaces the strict queue-inclusive budget from ADR-0121 because the owner explicitly changed the acceptance scope. Summing all parallel jobs or subtracting overlapping queue waits from wall time are rejected: neither represents the dependency critical path. Hiding actual elapsed time or changing accepted ADR-0121 is also rejected.

## Consequences

An execution-budget pass does not promise five-minute end-to-end feedback or consistent runtime. The earlier 288-second path qualifies under this definition, but latest run 25375 passed all 30 checks in 412 seconds actual elapsed time with a 391-second execution path (producer 284 + systemd 107), an execution-budget miss. The owner explicitly accepted the disclosed improvement and variation and requested wrap-up without further tuning. Both observations remain visible. Cold work and shared-host contention can change execution even after queueing is excluded. Additional infrastructure capacity is not part of this delivery.

## Open items

Complete final delivery verification against the revised artifacts and current head checks; latest execution below 300 seconds is not a new acceptance blocker after the owner accepted the variation. Preserve the latest miss alongside the accepted earlier qualifying evidence; do not mark verification or archive complete from a historical timing observation alone.
