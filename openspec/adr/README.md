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
| [0001](./0001-pinned-node-runtime-baseline.md) | Pin the Node runtime, toolchain, and compile targets across every lane | accepted (superseded by 0033) | 2026-07-27 |
| [0002](./0002-sqlite-state-repository.md) | Use SQLite through `node:sqlite` for the server state repository | accepted | 2026-07-27 |
| [0003](./0003-vault-interface-and-key-protectors.md) | Hold server secrets in a vault with AES-256-GCM entries and platform key protectors | accepted (superseded by 0118 in part) | 2026-07-27 |
| [0004](./0004-node-pty-and-supported-distribution-matrix.md) | Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix | accepted (superseded by 0035) | 2026-07-27 |
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
| [0018](./0018-one-workspace-bundle-many-server-connections.md) | One workspace bundle drives many server connections, with compatibility negotiated per connection by the protocol | accepted, supersedes 0008 (superseded by 0047) | 2026-09-09 |
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
| [0029](./0029-worktree-properties-are-host-owned-typed-facts.md) | Extensions publish typed worktree facts; Terminay renders them, and an approved poll keeps forge state fresh | accepted | 2026-09-24 |
| [0030](./0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md) | Automations run in a server-owned terminal space outside every project, and only that space holds workspace-scoped MCP | accepted (superseded by 0031) | 2026-09-24 |
| [0031](./0031-mcp-authority-is-scope-times-user-permission-policy.md) | MCP authority is capability scope combined with a user permission policy, and MCP may manage automations behind it | accepted, supersedes 0030 (superseded by 0068) | 2026-09-27 |
| [0033](./0033-pinned-node-runtime-baseline-on-npm-12-2.md) | Pin the Node runtime, toolchain, and compile targets across every lane, on npm 12.2.0 | accepted, supersedes 0001 (superseded by 0078) | 2026-10-02 |
| [0034](./0034-no-media-relay-reachability-from-candidates-and-routing-hints.md) | Terminay operates no media relay; reachability comes from candidates, routing hints, and the user's own network | accepted | 2026-10-03 |
| [0035](./0035-detached-session-holder-owns-ptys.md) | A detached session holder owns PTYs, in frozen generations, so shells outlive the server | accepted, supersedes 0004 (superseded by 0077) | 2026-10-03 |
| [0036](./0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md) | CI has a five-minute budget, met by running independent work in separate jobs and eighteen E2E shards | accepted, supersedes 0032 | 2026-10-03 |
| [0037](./0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md) | MCP Apps and agent-authored UI reach a terminal through Terminay's own MCP server, acting as a gateway | accepted | 2026-10-04 |
| [0038](./0038-app-views-run-in-a-self-sandboxing-proxy.md) | App views run in an opaque-origin frame inside a self-sandboxing proxy document | accepted | 2026-10-04 |
| [0039](./0039-app-views-are-mirrored-from-the-controlling-client.md) | An app view is mirrored to observers from the controlling client; the server relays and keeps nothing | accepted | 2026-10-04 |
| [0040](./0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md) | Home tabs are device-local presentation hosted in their own Dockview | accepted | 2026-10-05 |
| [0041](./0041-liveness-deadlines-count-only-time-the-measurer-was-running.md) | A liveness deadline counts only time the side measuring it was running; a deadline that came due during a suspension is replaced, not honoured | accepted | 2026-10-07 |
| [0042](./0042-file-previews-that-run-script-use-the-app-view-sandbox.md) | A file preview that runs file-provided script uses the app-view sandbox, with resources inlined by the workspace and no network | accepted | 2026-10-07 |
| [0043](./0043-a-terminal-changes-project-by-retiring-its-identity.md) | A terminal changes project by retiring its identity and binding a new one | accepted | 2026-10-07 |
| [0044](./0044-output-path-work-is-proportional-to-the-output-event.md) | Work on the terminal output path is proportional to the output event | accepted | 2026-10-07 |
| [0045](./0045-the-mcp-adapter-may-read-a-document-the-agent-names.md) | The MCP adapter may read a document the agent names, to show the user; the server never opens it | accepted | 2026-10-07 |
| [0046](./0046-window-attachments-are-an-unbounded-streamed-scratch-write.md) | Window message attachments are a streamed scratch write with no size limit, and Terminay does not remove them | accepted | 2026-10-07 |
| [0047](./0047-a-window-is-one-server-running-the-host-bundle.md) | A window is bound to one server; Desktop runs its packaged bundle for it, with compatibility negotiated by the protocol | accepted, supersedes 0018 | 2026-10-07 |
| [0048](./0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md) | A live connection belongs to a client window; authority belongs to the device | accepted | 2026-10-07 |
| [0049](./0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md) | A folder groups a project's panels and is not an identity boundary | accepted | 2026-10-08 |
| [0050](./0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md) | A project reaches its repository's worktrees through folder roots the server resolves | accepted | 2026-10-08 |
| [0051](./0051-terminay-observes-agents-and-does-not-instrument-them.md) | Terminay observes agents and does not instrument them, except where the owner has approved it | accepted | 2026-10-08 |
| [0052](./0052-terminals-report-git-commands-to-the-server-through-git-trace2.md) | Terminay's terminals report the Git commands run in them to the server, through Git's own tracing | accepted (superseded by 0069) | 2026-10-08 |
| [0053](./0053-in-page-windows-share-one-modal-frame.md) | Every in-page window is presented through one modal frame, with geometry kept on the device | accepted | 2026-10-08 |
| [0054](./0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md) | A local socket that does not fit in the data directory lives in an owner-only runtime directory named for it | accepted | 2026-10-09 |
| [0055](./0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md) | Exclusive ownership by a process is a lock the kernel holds, never a file's existence or a heartbeat | accepted | 2026-10-09 |
| [0056](./0056-terminal-output-reaches-workspace-state-only-as-sanitised-display-text.md) | Terminal output reaches workspace state only as sanitised display text the server resolves | accepted (superseded by 0058) | 2026-10-09 |
| [0057](./0057-nothing-written-into-a-terminal-is-a-secret.md) | Nothing Terminay writes into a terminal is a secret, so no feature moves a vault entry into a PTY | accepted | 2026-10-10 |
| [0058](./0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md) | A fact taken from terminal output is live server state, and never a workspace commit | accepted, supersedes 0056 | 2026-10-10 |
| [0059](./0059-a-workspace-change-reaches-every-layer-as-the-change.md) | A workspace change reaches every layer as the change, and each layer's work is proportional to it | accepted | 2026-10-10 |
| [0060](./0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md) | A push is sealed per pairing and attributed by the device; the hosted push service reads nothing and identifies no one | accepted | 2026-10-11 |
| [0061](./0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md) | A notification is a server-owned record that its terminal adds and removes, published after a settle period | accepted | 2026-10-11 |
| [0062](./0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md) | A server upgrades itself to its own channel's newest signed release, and a client only asks | accepted (superseded by 0117 in part) | 2026-10-11 |
| [0063](./0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md) | A forge extension may ask the forge's CLI for a token once, and never per refresh | accepted | 2026-10-16 |
| [0065](./0065-an-untracked-terminal-is-silenced-where-activity-is-read-never-where-it-is-detected.md) | An untracked terminal is silenced where activity is read, never where it is detected | accepted | 2026-10-16 |
| [0066](./0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md) | Choosing a project root browses the server's directory names, under the authority to change a root | accepted | 2026-10-16 |
| [0067](./0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md) | Chat providers may run the user's agents, as an owner-approved exception to observing agents | accepted | 2026-10-16 |
| [0068](./0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md) | MCP authority is capability scope combined with a user permission policy, and the caller is a terminal or a chat | accepted, supersedes 0031 (superseded by 0072) | 2026-10-16 |
| [0069](./0069-git-command-reports-reach-the-server-across-restarts.md) | Terminay's terminals report the Git commands run in them to the server, through Git's own tracing, across server restarts | accepted, supersedes 0052 (superseded by 0083) | 2026-10-17 |
| [0070](./0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md) | An agent's view operations are applied by the client it is talking from | accepted | 2026-10-17 |
| [0071](./0071-a-running-terminal-always-has-a-place-someone-can-see.md) | A running terminal always has a place someone can see | accepted | 2026-10-17 |
| [0072](./0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md) | MCP reach is the authority line, and workspace reach controls the app except for a fixed excluded set | accepted, supersedes 0068 | 2026-10-20 |
| [0075](./0075-management-lives-in-one-settings-surface.md) | Management lives in one Settings surface; collections get a list column, workspace content lives in Home | accepted | 2026-10-26 |
| [0076](./0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md) | App window records are server data that last as long as their terminal session, across restarts | accepted | 2026-10-27 |
| [0077](./0077-linux-artifacts-are-built-and-verified-at-a-declared-glibc-floor.md) | Linux artifacts are built and verified at a declared glibc floor | accepted, supersedes 0035 (superseded by 0079 and 0083) | 2026-10-30 |
| [0078](./0078-pinned-node-runtime-baseline-on-npm-12-2-1.md) | Pin the Node runtime, toolchain, and compile targets across every lane, on npm 12.2.1 | accepted, supersedes 0033 (superseded by 0080) | 2026-10-30 |
| [0079](./0079-desktop-macos-floor-follows-electron-to-macos-13.md) | Desktop's macOS floor follows Electron to macOS 13 | accepted, supersedes 0077 | 2026-10-30 |
| [0080](./0080-extension-installer-is-built-from-npm-libraries.md) | Build the extension installer from npm's libraries, keep the pinned toolchain baseline | accepted, supersedes 0078 | 2026-10-30 |
| [0081](./0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md) | A registered command default may add flags to an agent started in a Terminay terminal, as an owner-approved exception to observing agents | accepted, supersedes 0073 | 2026-10-30 |
| [0082](./0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md) | Shell integration is a server-managed launch layer, fed only by data | accepted | 2026-10-30 |
| [0083](./0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md) | Windows x64 Desktop joins the distribution matrix, and a holder and its server prove the credential to each other | accepted, supersedes 0077 (superseded by 0086) | 2026-10-30 |
| [0084](./0084-on-windows-git-command-reports-arrive-as-files-that-are-deleted-as-they-are-read.md) | On Windows, Git command reports arrive as files in an owner-only directory and are deleted as they are read | accepted, supersedes 0069 | 2026-10-30 |
| [0085](./0085-the-server-reaches-win32-apis-through-koffi.md) | The server reaches Win32 APIs that Node does not expose through `koffi`, loaded only on Windows | accepted | 2026-10-30 |
| [0086](./0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md) | A Windows pipe admits only the user's principals for writing, and serves only a peer that proves its credential | accepted, supersedes 0083 | 2026-10-30 |
| [0087](./0087-terminay-keeps-powershells-process-directory-in-step-with-its-location-on-windows.md) | Terminay keeps PowerShell's process directory in step with its location on Windows | accepted | 2026-10-30 |
| [0088](./0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md) | Terminay's state files are replaced durably and recovered according to their kind | accepted | 2026-10-31 |
| [0089](./0089-bots-run-agents-in-their-own-container-over-acp.md) | Bots run their agents inside their own container, over ACP, as an owner-approved exception | accepted (superseded by 0092) | 2026-11-01 |
| [0090](./0090-bots-share-only-the-hosts-auth-file-or-use-a-token.md) | Bots share only the host's own auth file, or use a token | accepted (superseded by 0091) | 2026-11-01 |
| [0091](./0091-bots-sign-in-with-their-own-credential.md) | Each bot signs in with its own credential, and nothing is shared with the host | accepted, supersedes 0090 | 2026-11-01 |
| [0092](./0092-bots-use-the-local-docker-compatible-socket.md) | Bots use one local Docker-compatible socket transport | accepted, supersedes 0089 (transport only) | 2026-11-02 |
| [0093](./0093-bots-communicate-through-a-durable-message-log.md) | Bots communicate through a durable message log and scoped runtime tools | accepted, supersedes 0089 (execution and communication only) | 2026-11-02 |
| [0094](./0094-bots-attribute-engine-workloads-through-per-bot-proxies.md) | Bots attribute engine workloads through per-bot socket proxies | accepted, supersedes 0089 and 0092 (socket exposure and attribution only) | 2026-11-02 |
| [0096](./0096-bots-use-terminay-owned-native-cli-drivers.md) | Bots use Terminay-owned native CLI drivers adapted from Atlas | accepted, supersedes ACP and adapter installation choices in part | 2026-11-04 |
| [0098](./0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md) | Project reach may curate the server's workflow templates, behind a group that asks | accepted, supersedes ADR-0072 in part | 2026-11-04 |
| [0099](./0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md) | A bot is woken by its own failures, never by a failure's failure | accepted (partly superseded by 0109) | 2026-11-06 |
| [0100](./0100-a-notification-belongs-to-one-terminal-or-one-bot.md) | A notification belongs to one terminal or one bot | accepted, supersedes 0061 in part | 2026-11-06 |
| [0101](./0101-the-home-overview-layout-is-a-server-setting.md) | The Home overview layout is a server setting | accepted | 2026-11-06 |
| [0104](./0104-a-notification-is-acknowledged-only-by-what-the-user-does.md) | A notification is acknowledged only by what the user does | accepted | 2026-11-11 |
| [0105](./0105-a-launcher-may-start-an-agent-with-a-user-confirmed-initial-prompt.md) | A launcher may start an agent with a user-confirmed initial prompt, as an owner-approved exception to observing agents | accepted, supersedes 0081 | 2026-11-11 |
| [0106](./0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md) | Forge pull requests and issues come from pull-based, on-demand forge sources; Terminay renders and joins them | accepted | 2026-11-11 |
| [0108](./0108-every-server-host-composes-one-mcp-host-with-no-opt-outs.md) | Every server host composes one MCP host, and no host can opt out of approvals, app windows or workspace view | accepted | 2026-11-11 |
| [0109](./0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md) | Terminay reports execution failures as facts, retries only before task hand-over, and the bot judges what they mean | accepted, supersedes 0099 in part | 2026-11-11 |
| [0110](./0110-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md) | Publish three release tracks from `main`, with a canary that is signed but not notarized | accepted, supersedes 0016 and 0027 in part (superseded by 0117 in part) | 2026-11-11 |
| [0112](./0112-terminal-output-may-write-but-never-read-the-viewing-devices-clipboard.md) | Live terminal output may write the viewing device's clipboard, and never read it | accepted | 2026-11-13 |
| [0113](./0113-dropped-files-are-a-streamed-scratch-write-on-the-terminals-own-server.md) | A dropped file becomes a path on the terminal's own server, through a third named scratch write | accepted | 2026-11-13 |
| [0114](./0114-git-watches-never-walk-a-tree-on-the-event-loop-and-skip-what-git-ignores.md) | Git watches never walk a tree on the event loop, and skip what Git ignores | accepted | 2026-11-13 |
| [0115](./0115-settings-are-organised-by-the-place-that-stores-them.md) | Settings are organised by the place that stores them | accepted, supersedes ADR-0075 in part | 2026-11-13 |
| [0116](./0116-a-session-holder-takes-new-sessions-only-while-its-environment-is-healthy.md) | A session holder takes new sessions only while its environment is healthy | accepted | 2026-11-13 |
| [0117](./0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md) | Installing a channel's latest build may move backwards, but only on an explicit request | accepted, supersedes 0062 and 0110 in part | 2026-11-14 |
| [0118](./0118-a-standalone-server-vault-unlocks-from-a-key-file-in-its-data-root.md) | A standalone server's vault unlocks itself from a key file in its data root | accepted, supersedes 0003 in part | 2026-11-14 |
| [0119](./0119-a-standalone-server-names-its-installations-stable-pointer.md) | A standalone server names its installation's stable pointer, never a release directory, in anything that outlives it | accepted | 2026-11-14 |
| [0120](./0120-bot-containers-run-under-a-terminay-apparmor-profile-that-allows-user-namespaces.md) | Bot containers run under a Terminay AppArmor profile that allows user namespaces | accepted | 2026-11-14 |
| [0121](./0121-ci-readiness-is-measured-from-original-creation.md) | CI readiness is measured from original creation with complete coverage | accepted (superseded by 0123 in part) | 2026-11-14 |
| [0122](./0122-ci-download-caches-can-live-in-daemon-owned-volumes.md) | CI download caches can live in daemon-owned volumes | accepted | 2026-11-14 |
| [0123](./0123-ci-execution-budget-excludes-runner-queueing.md) | CI execution budget excludes runner queueing | accepted, supersedes 0121 in part | 2026-11-14 |
