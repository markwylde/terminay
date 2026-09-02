## Why

The Agents pane could be populated by a second live Terminay process that shared `~/.codex`
or restored project and session labels, and a `codex resume` launched through a `node`
wrapper failed to bind at all. Two live processes could also target the same user-data root.

## What Changes

- Start discovery on every non-shell foreground, including `node` and `bun` wrappers, while
  still requiring process-tree plus writable-journal proof to bind.
- Stamp every agent snapshot with an ephemeral per-process instance id; clients pin the
  first id they see and ignore snapshots from a different live process until reset.
- Rebind on topology change and cancel the observer when a writer leaves this PTY tree.
- **BREAKING** Fail closed when a second process targets the same user-data root, using an
  exclusive process lock alongside the Electron single-instance lock.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `agent-status-and-sidebar`: agent projection is scoped to the running Terminay process.
- `connections-and-client-hosts`: a user-data root admits exactly one live process.

## Impact

Server-core agent status service and journal discovery, protocol agent snapshots, the client
agent-status consumer, renderer agent subscriptions, Desktop user-data locking, and the
agent, protocol, and dual-profile end-to-end suites.
