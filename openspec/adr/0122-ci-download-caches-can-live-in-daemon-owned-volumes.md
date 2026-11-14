# ADR-0122: CI download caches can live in daemon-owned volumes

Status: accepted, supersedes ADR-0036 and ADR-0121 in part
Date: 2026-11-14
Supersedes: ADR-0036 (the npm cache location only); ADR-0121 (its preservation of that location only)

## Context

Linux job containers repeatedly downloaded dependencies and Node headers. Recent installs took about four minutes, exceeding most of the complete-run budget before tests started. ADR-0036 chose runner.tool_cache for persistent downloads. Explicit job containers can also mount a daemon-owned named volume, whose admission has now been verified on the actual Gitea fleet.

## Decision

Permit either runner.tool_cache or a daemon-owned named volume for the npm download cache. Share integrity-checked downloads, never node_modules or mutable test state. Keep npm ci and its lifecycle scripts. Reuse installed Node headers only when their major, minor and patch versions match the executing Node runtime, scoped to installation so Electron rebuilds use their own headers. Bound installation and network retries with diagnostic output. Preserve independent security checks; installation's advisory audit request is not a test gate.

## Consequences

Fresh installations measured 19–24 seconds with verified local headers and the download cache. A cold cache or blocked registry can still miss the five-minute budget and remains measured. Named volume use depends on runner admission and isolated Docker stores; job concurrency against one Docker store must not be raised. Release archives, release installation behavior and all other accepted CI boundaries remain unchanged.
