## 1. Remote Git and path execution

- [x] 1.1 Add an argv-safe bounded SSH exec runner and POSIX path adapter for Git discovery, status, branches, worktrees, diffs, fetch, and reviewed Quick Push, verified by the remote Git suites
- [x] 1.2 Keep credentials target-side or in explicitly scoped SSH provider mechanisms, bound output, time, and concurrency, and never interpolate shell commands
- [x] 1.3 Cover absent Git, auth prompts, hooks, large repositories, worktrees, disconnect, cancellation, partial mutation, and revision revalidation

## 2. Filesystem observation and refresh

- [x] 2.1 Define an optional provider observation contract implemented by a proven remote watcher/helper or explicitly configured bounded polling
- [x] 2.2 Preserve canonical root and symlink boundaries, coalesce bursts, recover gaps, stop work when unobserved, and keep manual refresh when observation degrades
- [x] 2.3 Prove multiple projects and roots cannot receive each other's events and that target or server restart produces resync rather than invented continuity

## 3. Remote process, cwd, and close protection

- [x] 3.1 Define a versioned target-side observation helper protocol that binds data to the exact SSH channel and session rather than matching by path or process name
- [x] 3.2 Report canonical working directory and foreground process only with fresh proven session identity, otherwise retaining explicit unavailable or stale states
- [x] 3.3 Restore close protection and activity hints from that capability without treating the Terminay Server's SSH client PID as the target process

## 4. Authoritative remote agents

- [x] 4.1 Add provider-neutral remote journal and source callbacks using the same process-writer proof, bounded parsing, privacy, and exact session identity as This server agents
- [x] 4.2 Implement and test supported Codex discovery through the target helper while keeping raw journals, prompts, responses, and tool data server-side
- [x] 4.3 Preserve terminal-output fallback when the helper, provider, or journal is missing and never synthesize authoritative state from working directory or titles

## 5. Authenticated remote MCP

- [x] 5.1 Design a target helper/bridge with short-lived session/project/environment capability, mutual server authentication, replay resistance, rotation, revocation, deadlines, and bounded framed transport
- [x] 5.2 Expose only the existing project-implicit MCP surface authorized by the Terminay Server and never publish the server-local socket or bearer token to the network or an unrelated remote process
- [x] 5.3 Handle reconnect, server restart, and session exit as token revocation and fail closed when bridge identity or environment binding changes

## 6. Acceptance checks

- [x] 6.1 Verify remote Git and Quick Push act only inside the exact SSH/Puzed project and never invoke local Git with a remote path
- [x] 6.2 Verify working directory, foreground, and close state are accepted only from an exact live target session, with stale, forged, cross-project, and local-SSH-client observations failing closed
- [x] 6.3 Verify remote agent entries require target process-to-journal proof, expose no raw journal data, and that fallback activity remains accurate when unavailable
- [x] 6.4 Verify remote MCP controls only sibling terminals in the calling remote project and rejects replayed, revoked, and cross-environment capabilities
- [x] 6.5 Verify watch or helper loss preserves files and projects and produces explicit resync, with no hidden unbounded polling or cross-root event leakage
- [x] 6.6 Cover generic SSH and composed Puzed environments in Docker E2E through `npm run test:e2e`, with the helper absent, incompatible, crashed, and upgraded
