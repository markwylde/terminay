## Why

On a machine where omp has never run, or under a profile omp has not written
yet, launching omp in a Terminay terminal never binds. None of omp's
directories exist, so the provider reports `not-bound` with nothing to await,
and the app re-runs discovery only when a directory the provider named
changes. The terminal stays on activity fallback until it is reopened. The
conformance harness logged exactly this during the seed step of every omp run.

## What Changes

- When an omp sessions or breadcrumb directory does not exist yet, the
  provider names the nearest directory above it that does, up to the home
  directory or the environment variable's root, watched shallowly. The change
  that creates the next segment re-runs discovery, which then names the deeper
  directory, until the real root exists and is watched as before.
- The extension API gains `awaitedHomeAncestor` and
  `awaitedEnvironmentAncestor` beside the existing directory helpers, so any
  provider can name where its evidence will appear before the CLI has created
  it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: omp names the nearest existing ancestor of a
  root it has not created yet.

## Impact

- `packages/extension-api/src/agent.ts` — the two ancestor helpers.
- `extensions/agent-omp/src/ompAgent.ts` — the wait set uses them for a
  missing root.
- `packages/extension-api/test/agent-toolkit.test.mjs`,
  `extensions/agent-omp/test/omp-agent.test.mjs` — cover the fallback.
- No host, protocol, or client surface is touched.
