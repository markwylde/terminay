## Context

Successful runs 25299 and 25305 took 18m18s and 19m29s from creation. The E2E list matcher rejects literal delimiter characters in bot and connection-manager titles, causing contiguous fallback shards. Workspace suites run serially and expensive retention fixtures persist thousands of mutations. Linux floor packaging rebuilds the application and standalone archive across consumers. The intended Linux fleet is thirteen workers (eight pop-os, five home3), deliberately reduced on 2026-10-18 in commit 7d62b81. Seven stale registrations were removed; there is no lost capacity to restore. A fresh runner API observation confirms all thirteen Linux workers online. Run 25316 has preserved jobs across retry attempts, so job timestamps alone cannot establish initial queue delays.

## Goals / Non-Goals

Goals: complete creation-to-green below 300 seconds, retain all required scenarios, provide reproducible timing evidence and deliver one PR.

Non-goals: reducing production durability, skipping slow tests, moving required checks outside the run, bypassing Docker Electron isolation, or declaring success from partial statuses.

## Decisions

- Repair unrepresentable test titles and validate actual runner listings. Use stable descending measured-duration assignment to least-loaded shards, preserving shared fixtures and conservative estimates for unknown tests. Keep a reproducible timing snapshot rather than making each shard query mutable external history.
- Run ordinary E2E shards with two workers, each owning a virtual display as well as isolated profiles, ports and renderer copies. Shared-setup files retain declaration order in one worker. Native-module packaging forces its shard to one worker; schedule the longest predicted wall-time shard first.
- Seed large persisted histories directly in retention fixtures, then exercise live boundary mutations and reopen behavior. Production fsync remains unchanged. Disposable test roots use bounded tmpfs in isolated CI containers; real store calls, process reopen and crash scenarios still execute, without claiming this measures physical power-loss durability. A targeted trigger test measured 56 seconds on overlay versus 0.75 seconds on tmpfs under the same local contention. Independently stage shared extension artifacts before enabling bounded workspace parallelism; isolate suites where shared outputs cannot be made independent.
- Build the Linux application once in its ABI floor environment, package AppImage and standalone outputs without rebuilding, and hand revision-matched archives to consumers. Use explicit completion/provenance checks for prebuilt paths. Cache pinned tool downloads and correctly scoped build outputs. Do not reuse native artifacts across platforms.
- Cache production JavaScript/UI bundles with explicit source, configuration, helper, environment and workspace dependency inputs; stage release payloads after restoration. Keep native binaries outside this cache. Cache the E2E browser optimizer separately with checkout-root and runtime identity, verifying committed metadata and every referenced output after restoration. Combine image setup into one layer to avoid repeated filesystem snapshots.
- Bound Linux dependency installation, retain npm lifecycle scripts and reuse the integrity-checked npm download cache. Disable opportunistic audit/funding requests during installation; required security checks remain independent. Publish the verified standalone payload directly into the official image instead of compressing and immediately extracting it. Use explicit deterministic gzip level 1 for CI archive transfers while release archives retain level 9; verify identical extracted payloads and metadata. Make the local upgrade-description smoke explicitly offline while preserving the separate live-upgrade scenario.
- Schedule producer jobs first and measure runner availability. Optimize total work and scheduling for the intended thirteen Linux workers; preserve one job per isolated Docker store because cleanup assumes exclusive ownership. Unlimited concurrency is rejected.
- Report all required checks and original creation time through a read-only timing CLI, retaining attempt ambiguity. Failed, incomplete, cold and queued runs count against the target instead of being hidden.

## Risks / Trade-offs

- Timing snapshots become stale → fallback estimates plus actual durations and refresh tooling.
- Parallel suites race on shared staging → stage once before suites or isolate outputs.
- Artifact sharing adds dependency and transfer time → measure full critical path, prefer shared build stage with parallel consumers rather than waiting for unrelated checks.
- Thirteen Linux slots shared by producer, independent checks and eighteen E2E shards → shorten critical work and scheduling waves, then measure full readiness; do not assume extra capacity.
- Cold builds or overlapping work exceed 300 seconds → report misses and retain goal until demonstrated, not weaken acceptance.

## Migration Plan

Implement and verify in one worktree/PR. Run bounded targeted tests and Gitea full runs, inspect all head statuses, retain timing evidence. Rollback is reverting the PR; no product state migration.

## Open Questions

Scheduling and workload must fit the intended thirteen Linux workers; the removed stale registrations do not imply an infrastructure repair requirement. Exact workspace split and artifact transfer design will be selected from measurements. ADR-0036's conditional budget is superseded by strict measured readiness; shard assignment is refined using recorded durations; all platform and coverage boundaries remain.
