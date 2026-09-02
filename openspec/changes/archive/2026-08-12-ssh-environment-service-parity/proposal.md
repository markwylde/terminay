## Why

SSH v1 deliberately exposed PTY and SFTP only. Local Git must never receive a
remote path, the local SSH process cannot prove remote working directory,
foreground process, or agent identity, SFTP has no portable watch, and the
Terminay Server's local MCP socket is unreachable from the target and unsafe to
inject into it.

## What Changes

- Add an argv-safe bounded SSH exec runner and POSIX path adapter so Git
  discovery, status, branches, worktrees, diffs, fetch, and reviewed Quick Push
  run on the target.
- Define an optional provider filesystem observation contract implemented by a
  proven remote watcher or helper, or explicitly configured bounded polling.
- Define a versioned target-side observation helper protocol that binds
  reported data to the exact SSH channel and session, restoring canonical
  working directory, foreground process, close protection, and activity hints.
- Add provider-neutral remote journal and source callbacks for authoritative
  remote agents, with supported Codex discovery through the target helper.
- Add an authenticated remote MCP bridge with short-lived
  session/project/environment capability, mutual server authentication, replay
  resistance, rotation, revocation, deadlines, and bounded framed transport.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `ssh-project-environments`: remote Git and path execution, filesystem
  observation, proof-bound cwd and foreground process, remote agent status, and
  the remote MCP bridge move from planned to implemented, each with an explicit
  unavailable state.

## Impact

The official SSH extension's exec runner, path adapter, observation helper
protocol, agent journal callbacks, and MCP bridge; the server-side Git,
activity, agent, and MCP routing for non-local environments; and the Docker E2E
suites for generic SSH and composed Puzed environments.
