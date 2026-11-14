## Context

Successful runs 25299 and 25305 took 18m18s and 19m29s from creation. The E2E list matcher rejects literal delimiter characters in bot and connection-manager titles, causing contiguous fallback shards. Workspace suites run serially and expensive retention fixtures persist thousands of mutations. Linux floor packaging rebuilds the application and standalone archive across consumers. The intended Linux fleet is thirteen workers (eight pop-os, five home3), deliberately reduced on 2026-10-18 in commit 7d62b81. Seven stale registrations were removed; there is no lost capacity to restore. A fresh runner API observation confirms all thirteen Linux workers online. Run 25316 has preserved jobs across retry attempts, so job timestamps alone cannot establish initial queue delays.

## Goals / Non-Goals

Goals: measure complete successful runs against a 300-second execution-critical-path target after excluding runner queueing; retain all required scenarios, original end-to-end elapsed time and reproducible timing evidence in one Terminay PR.

Non-goals: dedicated runners, infrastructure provisioning, reducing production durability, skipping slow tests, moving required checks outside the run, bypassing Docker Electron isolation, or declaring success from partial statuses.

## Decisions

- Repair unrepresentable test titles and validate actual runner listings. Use stable descending measured-duration assignment to least-loaded shards, preserving shared fixtures and conservative estimates for unknown tests. Keep a reproducible timing snapshot rather than making each shard query mutable external history.
- Capture CI traces and video on the first retry, preserving first-failure screenshots/logs and unchanged retries; local diagnostic defaults remain unchanged. Run ordinary E2E shards with two workers, each owning a virtual display as well as isolated profiles, ports and renderer copies. Shared-setup files retain declaration order in one worker. Native-module packaging forces its shard to one worker; balance assigned work against each shard’s worker capacity and dispatch native packaging first.
- Seed large persisted histories directly in retention fixtures, then exercise live boundary mutations and reopen behavior. Production fsync remains unchanged. Disposable test roots use bounded tmpfs in isolated CI containers; real store calls, process reopen and crash scenarios still execute, without claiming this measures physical power-loss durability. A targeted trigger test measured 56 seconds on overlay versus 0.75 seconds on tmpfs under the same local contention. Cap server-core test-file concurrency at six to preserve responsiveness under host contention. Independently stage shared extension artifacts before enabling bounded workspace parallelism; isolate suites where shared outputs cannot be made independent.
- Build the Linux application once in its ABI floor environment, package AppImage and standalone outputs without rebuilding, and hand revision-matched archives to consumers. Publish distributable files from a shared producer so floor probes and systemd consumers can proceed independently; do not transfer the unpacked Electron staging tree. Use explicit completion/provenance checks for prebuilt paths. Cache pinned tool downloads and correctly scoped build outputs. Do not reuse native artifacts across platforms.
- Cache production JavaScript/UI bundles with explicit source, configuration, helper, environment and workspace dependency inputs; stage release payloads after restoration. Keep native binaries outside this cache. Cache the E2E browser optimizer separately with checkout-root and runtime identity, verifying committed metadata and every referenced output after restoration. Combine image setup into one layer to avoid repeated filesystem snapshots.
- Bound Linux dependency installation, retain npm lifecycle scripts and reuse the integrity-checked npm download cache. Disable opportunistic audit/funding requests during installation; required security checks remain independent. Publish the verified standalone payload directly into the official image instead of compressing and immediately extracting it. Use explicit deterministic gzip level 1 for CI archive transfers while release archives retain level 9; verify identical extracted payloads and metadata. Make the local upgrade-description smoke explicitly offline while preserving the separate live-upgrade scenario.
- Schedule producers early on the existing shared fleet. The owner rejected dedicated runners; infrastructure PR 49 is closed and no runner changes were deployed. Retain one job per isolated Docker store and ordinary shared-runner labels.
- Measure the execution critical path as the longest dependency-chain sum of job execution durations, from each job's start through completion, excluding runner admission waits. Include setup, downloads, cold-cache work, tests, transfers, reporting and teardown within those durations. Parallel job durations are not summed indiscriminately and queue waits are not subtracted as one global total. Also report original creation-to-green elapsed time and queue evidence. Keep retries and failed attempts visible; ambiguous dependency or retry evidence cannot prove a budget result.
- ADR-0123 supersedes ADR-0121's budget accounting only. All coverage, platform, provenance, isolation and production-durability boundaries remain; ADR-0122's download-cache decision remains in force. The earlier strict elapsed-time decision remains unchanged as history.

## Risks / Trade-offs

- Timing snapshots become stale → fallback estimates plus actual durations and refresh tooling.
- Parallel suites race on shared staging → stage once before suites or isolate outputs.
- Artifact sharing adds dependency and transfer time → measure full critical path, prefer shared build stage with parallel consumers rather than waiting for unrelated checks.
- Thirteen Linux slots shared by producer, independent checks and eighteen E2E shards → shorten critical work and scheduling waves, then measure full readiness; do not assume extra capacity.
- Execution varies with cache state and shared-host contention → preserve both qualifying runs and misses; a historical qualifying run does not establish a consistent guarantee.

## Migration Plan

Implement and verify in the Terminay worktree/PR. No infrastructure PR or dedicated-runner activation is part of delivery. Run bounded targeted tests and Gitea full runs, inspect every head status and preserve original timestamps plus queue-excluded dependency-path evidence. Rollback is reverting the Terminay PR; no product state migration.

## Open Questions

Run 25369 remains fully green with actual creation-to-green elapsed time of 1,084 seconds. Its producer executed for 191 seconds and downstream systemd for 97 seconds, giving a queue-excluded critical path of 288 seconds (4m48s). Floor and systemd waited 585–587 seconds after the producer during overlapping main/PR work; those waits remain recorded and are excluded only from the execution budget.

Latest run 25375 is fully green (30/30 checks), with actual elapsed time of 412 seconds and an execution critical path of 391 seconds (producer 284 + systemd 107). It misses the revised target. The owner accepted the earlier qualifying 288-second evidence with the latest variation disclosed, and requested wrap-up without further performance work. Final head verification and delivery remain open; do not claim every run stays below 300 seconds. Archive and spec sync remain separate authorized workflow steps.
