## Why

Codex can hold several rollout journals writable inside one process tree. Discovery picked
the rollout with the newest modification time without proving it was a root CLI session, so
a recently active subagent could displace the terminal's root journal and break project
agent presentation.

## What Changes

- Specify the provider metadata that distinguishes a root Codex CLI rollout from an
  in-process subagent rollout.
- Filter discovered writable rollouts to proven root CLI journals before selecting the most
  recently modified eligible root.
- Preserve the existing fail-closed path, process-tree, size, and malformed-record handling.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `agent-status-and-sidebar`: Codex journal discovery admits only proven root CLI rollouts.

## Impact

Server-core Codex journal discovery and its focused agent journal tests.
