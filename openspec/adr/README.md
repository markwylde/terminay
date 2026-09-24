# Architecture Decision Records

Each file here records one architecturally significant decision that Terminay has
committed to: the context that forced the decision, the option chosen, the
alternatives rejected, and the consequences accepted. They are the durable
decision history for the repository — a change proposal under
`openspec/changes/` reviews the in-force set before it designs anything, and
records any new durable decision as a new file here.

**ADRs are immutable once accepted.** Never edit an accepted ADR — not its body,
not its status, not its date. To change a previously accepted decision, add a new
ADR whose `Supersedes:` field names the prior one and whose Context explains why
the earlier decision is being revisited. What is currently in force is derived by
walking the `Supersedes:` links across the folder; a superseded ADR stays frozen
as a historical record.

Files are named `NNNN-kebab-title.md`. The sequence is monotonic across the whole
repository and numbers are never reused. Each ADR uses the MADR-short shape:
a title, `Status:` / `Date:` / optional `Supersedes:` fields, then `## Context`,
`## Decision`, and `## Consequences`, plus `## Open items` where obligations
remain outstanding.

`evidence/` holds the supporting spikes, audits, and measurements that several
of these decisions rest on. ADRs link into it with relative paths such as
`./evidence/secure-werift-production-spike.md`.

## Index

| # | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](./0001-pinned-node-runtime-baseline.md) | Pin the Node runtime, toolchain, and compile targets across every lane | accepted | 2026-07-27 |
| [0002](./0002-sqlite-state-repository.md) | Use SQLite through `node:sqlite` for the server state repository | accepted | 2026-07-27 |
| [0003](./0003-vault-interface-and-key-protectors.md) | Hold server secrets in a vault with AES-256-GCM entries and platform key protectors | accepted | 2026-07-27 |
| [0004](./0004-node-pty-and-supported-distribution-matrix.md) | Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix | accepted | 2026-07-27 |
| [0005](./0005-sandboxed-origin-bound-client-hosts.md) | Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts | accepted | 2026-07-27 |
| [0006](./0006-terminay-owned-werift-webrtc-runtime.md) | Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime | accepted | 2026-07-27 |
| [0007](./0007-deterministic-pty-runtime-archives.md) | Build PTY runtime archives deterministically on a trusted producer runner | accepted (superseded by 0008) | 2026-07-27 |
| [0008](./0008-server-bundled-clients-and-protocol-blind-hosts.md) | Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind | accepted (superseded by 0018) | 2026-08-02 |
| [0009](./0009-server-owned-project-environments.md) | Make the selected Terminay Server the sole owner of project environment connections | accepted (superseded by 0017) | 2026-08-12 |
| [0010](./0010-provider-portable-parallel-pull-request-ci.md) | Scope pull-request CI to a merge-confidence gate, sharded and provider-portable | accepted | 2026-08-06 |
| [0011](./0011-security-trust-boundary-model.md) | Adopt an explicit trust-boundary model as the security contract for release review | accepted | 2026-07-27 |
| [0012](./0012-pwa-framed-session-host.md) | Keep the installable PWA on the manager origin and frame the session origin | accepted | 2026-08-18 |
| [0013](./0013-device-bound-host-approval-and-channel-only-credentials.md) | Pair with device-bound host approval, and exchange credentials only on transport-authenticated data channels | accepted | 2026-09-02 |
| [0014](./0014-declared-provider-capabilities-proven-against-real-clis.md) | Make agent providers declare their observable capabilities and prove them against real CLIs | accepted (superseded by 0025) | 2026-09-06 |
| [0015](./0015-self-hosted-direct-signaling-exposure.md) | A Terminay Server may host its own data-blind signaling endpoint, authenticated by the transport transcript alone | accepted | 2026-09-07 |
| [0016](./0016-self-contained-server-archives-and-release-channels.md) | Distribute the standalone server as signed self-contained per-architecture archives on tag and rolling `main` channels | accepted | 2026-09-07 |
| [0017](./0017-one-server-type-every-project-executes-on-its-server.md) | There is one kind of remote, a Terminay Server, and every project executes on the server that owns it | accepted, supersedes 0009 | 2026-09-09 |
| [0018](./0018-one-workspace-bundle-many-server-connections.md) | One workspace bundle drives many server connections, with compatibility negotiated per connection by the protocol | accepted, supersedes 0008 | 2026-09-09 |
| [0019](./0019-language-intelligence-from-server-hosted-language-server-extensions.md) | Language intelligence comes from language-server extensions on the Terminay Server, behind a core-owned bounded protocol surface | accepted | 2026-09-09 |
| [0020](./0020-per-operation-canonical-roots.md) | Canonicalize a project root once per filesystem operation, and never cache one across operations | accepted | 2026-09-14 |
| [0021](./0021-measure-background-cost-in-spawns-not-parent-syscalls.md) | Measure idle background cost in child processes, not in the parent's syscalls | accepted | 2026-09-15 |
| [0022](./0022-watch-do-not-poll.md) | Watch for changes; never poll for anything a watch can observe | accepted (superseded by 0028) | 2026-09-15 |
| [0023](./0023-server-owned-clipboard-scratch.md) | Materialise browser clipboard images in a server-owned scratch directory | accepted | 2026-09-15 |
| [0024](./0024-providers-name-the-directories-they-await.md) | An agent provider that cannot bind names the directories it awaits; the host watches them and nothing else re-runs discovery | accepted (superseded by 0025) | 2026-09-16 |
| [0025](./0025-agent-sessions-come-from-a-machine-wide-detection-library.md) | Agent sessions come from a machine-wide detection library; the host scopes them by directory and binds them by process ancestry | accepted, supersedes 0014, 0024 | 2026-09-19 |
| [0026](./0026-extensions-may-ship-prebuilt-native-modules.md) | Extensions may ship prebuilt native modules; install scripts stay disabled | accepted | 2026-09-19 |
| [0027](./0027-desktop-updates-in-place-from-github-release-metadata.md) | Terminay Desktop updates in place from GitHub release metadata, which is published last | accepted | 2026-09-19 |
| [0028](./0028-no-polling-without-owner-approval.md) | Never poll; a poll is a last resort that needs the owner's explicit approval | accepted, supersedes 0022 | 2026-09-24 |
| [0029](./0029-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md) | Automations run in a server-owned terminal space outside every project, and only that space holds workspace-scoped MCP | accepted | 2026-09-24 |
