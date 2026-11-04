## ADR review

Reviewed the repository ADR inventory through 0094 and resolved the `Supersedes:` graph. Accepted files remain unchanged. The in-force records reviewed before this decision are:

- [0002](../../adr/0002-sqlite-state-repository.md): Use SQLite through `node:sqlite` for the server state repository
- [0003](../../adr/0003-vault-interface-and-key-protectors.md): Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- [0005](../../adr/0005-sandboxed-origin-bound-client-hosts.md): Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- [0006](../../adr/0006-terminay-owned-werift-webrtc-runtime.md): Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- [0011](../../adr/0011-security-trust-boundary-model.md): Adopt an explicit trust-boundary model as the security contract for release review
- [0012](../../adr/0012-pwa-framed-session-host.md): Keep the installable PWA on the manager origin and frame the session origin
- [0013](../../adr/0013-device-bound-host-approval-and-channel-only-credentials.md): Pair with device-bound host approval, and exchange credentials only on transport-authenticated data channels
- [0015](../../adr/0015-self-hosted-direct-signaling-exposure.md): A Terminay Server may host its own data-blind signaling endpoint, authenticated by the transport transcript alone
- [0016](../../adr/0016-self-contained-server-archives-and-release-channels.md): Distribute the standalone server as signed self-contained per-architecture archives on tag and rolling `main` channels
- [0017](../../adr/0017-one-server-type-every-project-executes-on-its-server.md): There is one kind of remote, a Terminay Server, and every project executes on the server that owns it
- [0019](../../adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md): Language intelligence comes from language-server extensions on the Terminay Server, behind a core-owned bounded protocol surface
- [0020](../../adr/0020-per-operation-canonical-roots.md): Canonicalize a project root once per filesystem operation, and never cache one across operations
- [0021](../../adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md): Measure idle background cost in child processes, not in the parent's syscalls
- [0023](../../adr/0023-server-owned-clipboard-scratch.md): Materialise browser clipboard images in a server-owned scratch directory
- [0025](../../adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md): Agent sessions come from a machine-wide detection library; the host scopes them by directory and binds them by process ancestry
- [0026](../../adr/0026-extensions-may-ship-prebuilt-native-modules.md): Extensions may ship prebuilt native modules; install scripts stay disabled
- [0027](../../adr/0027-desktop-updates-in-place-from-github-release-metadata.md): Terminay Desktop updates in place from GitHub release metadata, which is published last
- [0028](../../adr/0028-no-polling-without-owner-approval.md): Never poll; a poll is a last resort that needs the owner's explicit approval
- [0029](../../adr/0029-worktree-properties-are-host-owned-typed-facts.md): Extensions publish typed worktree facts; Terminay renders them
- [0034](../../adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md): Terminay operates no media relay; reachability comes from candidates, routing hints, and the user's own network
- [0036](../../adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md): CI has a five-minute budget, met by running independent work in separate jobs and eighteen E2E shards
- [0037](../../adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md): MCP Apps and agent-authored UI reach a terminal through Terminay's own MCP server, acting as a gateway
- [0038](../../adr/0038-app-views-run-in-a-self-sandboxing-proxy.md): App views run in an opaque-origin frame inside a self-sandboxing proxy document
- [0039](../../adr/0039-app-views-are-mirrored-from-the-controlling-client.md): An app view is mirrored to observers from the controlling client; the server relays and keeps nothing
- [0040](../../adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md): Home tabs are device-local presentation hosted in their own Dockview
- [0041](../../adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md): A liveness deadline counts only time the side measuring it was running
- [0042](../../adr/0042-file-previews-that-run-script-use-the-app-view-sandbox.md): A file preview that runs file-provided script uses the app-view sandbox, with resources inlined by the workspace and no network
- [0043](../../adr/0043-a-terminal-changes-project-by-retiring-its-identity.md): A terminal changes project by retiring its identity and binding a new one
- [0044](../../adr/0044-output-path-work-is-proportional-to-the-output-event.md): Work on the terminal output path is proportional to the output event
- [0045](../../adr/0045-the-mcp-adapter-may-read-a-document-the-agent-names.md): The MCP adapter may read a document the agent names, to show the user; the server never opens it
- [0046](../../adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md): Window message attachments are a streamed scratch write with no size limit, and Terminay does not remove them
- [0047](../../adr/0047-a-window-is-one-server-running-the-host-bundle.md): A window is bound to one server; Desktop runs its packaged bundle for it, with compatibility negotiated by the protocol
- [0048](../../adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md): A live connection belongs to a client window; authority belongs to the device
- [0049](../../adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md): A folder groups a project's panels and is not an identity boundary
- [0050](../../adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md): A project reaches its repository's worktrees through folder roots the server resolves
- [0051](../../adr/0051-terminay-observes-agents-and-does-not-instrument-them.md): Terminay observes agents and does not instrument them, except where the owner has approved it
- [0053](../../adr/0053-in-page-windows-share-one-modal-frame.md): Every in-page window is presented through one modal frame, with geometry kept on the device
- [0054](../../adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md): A local socket that does not fit in the data directory lives in an owner-only runtime directory
- [0055](../../adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md): Exclusive ownership by a process is a lock the kernel holds, never a file's existence or a heartbeat
- [0057](../../adr/0057-nothing-written-into-a-terminal-is-a-secret.md): Nothing Terminay writes into a terminal is a secret, so no feature moves a vault entry into a PTY
- [0058](../../adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md): A fact taken from terminal output is live server state, and never a workspace commit
- [0059](../../adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md): A workspace change reaches every layer as the change, and each layer's work is proportional to it
- [0060](../../adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md): A push is sealed per pairing and attributed by the device; the hosted push service reads nothing and identifies no one
- [0061](../../adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md): A notification is a server-owned record that its terminal adds and removes, published after a settle period
- [0062](../../adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md): A server upgrades itself to its own channel's newest signed release, and a client only asks
- [0063](../../adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md): A forge extension may ask the forge's CLI for a token once, and never per refresh
- [0064](../../adr/0064-rich-markdown-editing-is-a-file-viewer-view-over-the-panels-own-session.md): Rich Markdown editing is a file viewer view over the panel's own file session
- [0065](../../adr/0065-an-untracked-terminal-is-silenced-where-activity-is-read-never-where-it-is-detected.md): An untracked terminal is silenced where activity is read, never where it is detected
- [0066](../../adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md): Choosing a project root browses the server's directory names, under the authority to change a root
- [0067](../../adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md): Chat providers may run the user's agents, as an owner-approved exception to observing agents
- [0070](../../adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md): An agent's view operations are applied by the client it is talking from
- [0071](../../adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md): A running terminal always has a place someone can see
- [0072](../../adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md): MCP reach is the authority line, and workspace reach controls the app except for a fixed excluded set
- [0074](../../adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md): A terminal's MCP capability follows it between projects, and a move never widens it
- [0075](../../adr/0075-management-lives-in-one-settings-surface.md): Management lives in one Settings surface; collections get a list column, workspace content lives in Home
- [0076](../../adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md): App window records are server data that last as long as their session
- [0079](../../adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md): Desktop's macOS floor follows Electron to macOS 13
- [0080](../../adr/0080-extension-installer-is-built-from-npm-libraries.md): Build the extension installer from npm's libraries, keep the pinned toolchain baseline
- [0081](../../adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md): A registered command default may add flags to an agent started in a Terminay terminal, as an owner-approved exception to observing agents
- [0082](../../adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md): Shell integration is a server-managed launch layer, fed only by data
- [0084](../../adr/0084-on-windows-git-command-reports-arrive-as-files-that-are-deleted-as-they-are-read.md): On Windows, Git command reports arrive as files in an owner-only directory and are deleted as they are read
- [0085](../../adr/0085-the-server-reaches-win32-apis-through-koffi.md): The server reaches Win32 APIs that Node does not expose through `koffi`, loaded only on Windows
- [0086](../../adr/0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md): A Windows pipe admits only the user's principals for writing, and serves only a peer that proves its credential
- [0087](../../adr/0087-terminay-keeps-powershells-process-directory-in-step-with-its-location-on-windows.md): Terminay keeps PowerShell's process directory in step with its location on Windows
- [0088](../../adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md): Terminay's state files are replaced durably and recovered according to their kind
- [0093](../../adr/0093-bots-communicate-through-a-durable-message-log.md): Bots communicate through a durable message log and scoped runtime tools
- [0094](../../adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md): Bots attribute engine workloads through per-bot socket proxies

## New decision

- [ADR-0095](../../adr/0095-session-holders-retain-bounded-terminal-presentation-in-memory.md) supersedes ADR-0086 only as needed to replace its inherited no-terminal-parsing restriction, retaining its authentication, runtime, storage, boundedness, and lifecycle commitments.

The design follows ADRs 0011 (trust), 0028 (event-driven work), 0044 (output cost), 0047/0048 (host and client authority), 0051 (agent independence), 0071 (recovered placement), 0079 (macOS floor), and 0088 (disk-state policy). Other reviewed in-force decisions are unaffected.
