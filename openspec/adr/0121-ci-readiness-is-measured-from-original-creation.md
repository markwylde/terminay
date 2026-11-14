# ADR-0121: CI readiness is measured from original creation with complete coverage

Status: accepted, supersedes ADR-0036 in part
Date: 2026-11-14
Supersedes: ADR-0036 (conditional five-minute budget only; all isolation, coverage, caching and platform boundaries continue)

## Context

The owner requires the entire Gitea suite ready within five minutes from creation. Conditional accounting hid queue and cold-cache costs. Literal delimiters in test titles disabled balancing and a serial workspace gate exceeded the budget independently. Gitea retries preserve successful jobs while rewriting attempt timestamps.

## Decision

Measure readiness from original run creation through completion of every required check, including queueing and retries. Cold caches and unavailable workers are reported as misses rather than exceptions. Use deterministic measured-duration shard assignment with exactly-once real selection validation and explicit diagnostics. Keep all required checks, eighteen E2E shards, shared-fixture grouping and Docker isolation. Reuse revision- and platform-matched builds while retaining packaged-artifact verification. Production durability is never reduced for test speed.

## Consequences

Runner capacity is part of achieving the target. Overlapping or cold runs can miss it and must be reported honestly. Timing snapshots require refresh and unknown tests need conservative estimates. Sharing artifacts requires provenance checks and measurement of added transfer/dependency time. Old accepted ADRs remain unchanged.
