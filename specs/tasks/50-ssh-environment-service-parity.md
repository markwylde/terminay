# SSH environment service parity

## Goal

Complete the planned SSH project experience beyond terminal/filesystem MVP with
remote Git, current-directory and foreground-process observation, authoritative
agent integration, filesystem observation, and authenticated MCP capability.

## Delivery phase

Phase 5 after the official SSH runtime is stable. Git and observation work can
proceed in parallel; the target helper/bridge foundation precedes authoritative
agents and MCP.

## Dependencies

- [Task 43](../tasks_completed/43-environment-routed-project-services.md)
- [Task 46](./46-official-ssh-extension.md)
- [Task 49](./49-puzed-to-ssh-environment-composition.md) for composed Puzed
  acceptance; generic SSH work may start after Task 46.

## Governing specifications

- [SSH project environments](../features/ssh-project-environments.md)
- [Git workflows](../features/git-worktrees-and-quick-push.md)
- [Agent status](../features/agent-status-and-sidebar.md)
- [Terminal activity signals](../features/terminal-activity-signals.md)
- [MCP server](../features/mcp-server.md)

## Current gap

SSH v1 deliberately exposes PTY and SFTP only. Local Git must not receive a
remote path; the local SSH process cannot prove remote cwd/foreground/agent
identity; SFTP has no portable watch; and the Terminay Server's local MCP socket
is unreachable and unsafe to inject into the target.

## Parallel work streams

### Remote Git and path execution

- [ ] Add an argv-safe bounded SSH exec runner and POSIX path adapter for Git
  discovery, status, branches, worktrees, diffs, fetch, and reviewed Quick Push.
- [ ] Keep credentials target-side or in explicitly scoped SSH provider
  mechanisms; bound output/time/concurrency and never interpolate shell commands.
- [ ] Cover absent Git, auth prompts, hooks, large repositories, worktrees,
  disconnect, cancellation, partial mutation, and revision revalidation.

### Filesystem observation and refresh

- [ ] Define an optional provider observation contract implemented by a proven
  remote watcher/helper or explicitly configured bounded polling.
- [ ] Preserve canonical root/symlink boundaries, coalesce bursts, recover gaps,
  stop work when unobserved, and keep manual refresh when observation degrades.
- [ ] Prove multiple projects/roots cannot receive each other's events and that
  target/server restart produces resync rather than invented continuity.

### Remote process, cwd, and close protection

- [ ] Define a versioned target-side observation helper/protocol which binds
  data to the exact SSH channel/session rather than matching by path or process
  name.
- [ ] Report canonical cwd and foreground process only with fresh proven session
  identity; otherwise retain explicit unavailable/stale states.
- [ ] Restore close protection and activity hints from that capability without
  treating the Terminay Server's SSH client PID as the target process.

### Authoritative remote agents

- [ ] Add provider-neutral remote journal/source callbacks using the same
  process-writer proof, bounded parsing, privacy, and exact session identity as
  This server agents.
- [ ] Implement/test supported Codex discovery through the target helper while
  keeping raw journals, prompts, responses, and tool data on the server side.
- [ ] Preserve terminal-output fallback when the helper/provider/journal is
  missing and never synthesize authoritative state from cwd or titles.

### Authenticated remote MCP

- [ ] Design a target helper/bridge with short-lived session/project/environment
  capability, mutual server authentication, replay resistance, rotation,
  revocation, deadlines, and bounded framed transport.
- [ ] Expose only the existing project-implicit MCP surface authorized by the
  Terminay Server; never publish the server-local socket or bearer token to the
  network or an unrelated remote process.
- [ ] Handle reconnect/server restart/session exit as token revocation and fail
  closed when bridge identity or environment binding changes.

## Acceptance checks

- Remote Git and Quick Push act only inside the exact SSH/Puzed project and
  never invoke local Git with a remote path.
- Cwd/foreground/close state is accepted only from an exact live target session;
  stale, forged, cross-project, and local-SSH-client observations fail closed.
- Remote agent entries require target process-to-journal proof and expose no raw
  journal data; fallback activity remains accurate when unavailable.
- Remote MCP controls only sibling terminals in the calling remote project;
  replayed/revoked/cross-environment capabilities are rejected.
- Watch/helper loss preserves files/projects and produces explicit resync; no
  hidden unbounded polling or cross-root event leakage occurs.
- Docker E2E covers generic SSH and composed Puzed environments through
  `npm run test:e2e`, with helper absent, incompatible, crashed, and upgraded.

## Definition of done

Every currently planned SSH capability has a provider-owned implementation or
an explicit proven unavailable state, with Git, observation, agents, and MCP
accepted across embedded/standalone servers and Desktop/browser clients without
wrong-machine fallback.
