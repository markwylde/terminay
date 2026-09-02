# ADR-0001: Pin the Node runtime, toolchain, and compile targets across every lane

Status: accepted
Date: 2026-07-27

## Context

Terminay ships the same server payload through several very different lanes:
local development, CI, Node-based containers, the standalone server archive,
and the Electron Desktop application. If each lane resolves its own Node and
npm versions, a base-image refresh can silently move the runtime under a
release without any change to the repository, and a lockfile can be
materialized by a different npm than the one that produced it.

Native modules and the built-in `node:sqlite` adapter both bind to a specific
Node ABI and API stability level, so the runtime version is an architectural
input rather than a developer convenience.

## Decision

The build and release baseline is Node 24.15.0 with npm 12.0.2. CI and every
Node-based container install that exact npm version before materializing the
lockfile, so the toolchain cannot drift with a base-image refresh. Runtime,
container, CI, release, and local version-manager pins move together.

TypeScript compiles active application code for ES2022 and esbuild targets
Node 24. Active build configuration must not retain a Node 22 target.

Platform artifacts include a pinned Node runtime rather than relying on a
machine-global Node installation. Desktop embeds the same packaged server
payload that is distributed for standalone use.

## Consequences

- The runtime version is a single coordinated change: moving Node means moving
  the container, CI, release, and version-manager pins in one step.
- Decision spikes recorded against Node 22.23.1 remain valid historical
  evidence for the decisions they supported, but they are not statements of the
  current runtime baseline. Node 24 release lanes must requalify the
  corresponding active artifacts.
- Standalone and Desktop distributions grow by the size of the bundled Node
  runtime, in exchange for not depending on whatever Node the target machine
  happens to have.
- There is exactly one server payload to qualify, because Desktop supervises
  the same artifact that standalone users run.
