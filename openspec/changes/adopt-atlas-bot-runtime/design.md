## Context

The owner wants Terminay bots to use Atlas's native CLI runner and full desktop, copied and adapted into this public repository. Atlas is proprietary and must not become a dependency. The owner additionally requests a single-line build banner that opens a clean step-timeline page.

Observed implementation:

- Terminay's `docker/terminay-bot/Dockerfile` installs Openbox/xterm/Chromium and helper scripts. `terminay-init` owns bootstrap, protected loopback VNC, the engine proxy and desktop startup. `terminay-browser` owns its browser socket. The home is `/home/bot`.
- `botService/agentProcess.ts` wraps an ACP client and runs it through `terminay-run`; `runtime.ts`/`runtimeBridge.ts` supply bot-scoped communication/coordination tools. Native output is diagnostic, not chat. Each user message starts a fresh execution.
- `image.ts` hashes build inputs, generates extension install layers and publishes `terminay-bot:local` only after a temporary-tag build succeeds. `engineService.ts` serializes builds, keeps a bounded output tail and invalidates clients. `socketDriver.ts` uses the local Docker-compatible HTTP API; no host engine CLI is required.
- The current Bots engine/build UI lives in `BotsSection.tsx` and `useBotEngine.ts`. It has aggregate image state/logs rather than structured build steps. Protocol/client-core build operations must grow with the UI.
- Atlas's `docker/agent-browser/` supplies XFCE session defaults, creative-app installation and Python desktop control; `docker/agent-shell/atlas-desktop-mcp.mjs` provides screenshot/window/input/browser-save tools. `codexRunner.ts`, `containerBroker.ts` and `handlers/codexChat.ts` supply runner launch/auth/output handling. Actual native CLI flags and MCP assembly also live in `handlers/index.ts`; copying the runner alone is insufficient.
- Atlas creates disposable runner containers, uses host bind mounts, supports shared provider auth stores, publishes service ports, disables Chromium's container sandbox, and launches Claude with permissions bypassed. These choices are not Terminay's contracts.

The ADR inventory and Supersedes links were inspected. Relevant current commitments include ADR-0028 (no unapproved polling), ADR-0051/0067 (bounded agent-launch exceptions), ADR-0091 as extended by the Claude-login ADR-0095 (per-bot credentials), ADR-0092 (local socket engine), ADR-0093 (fresh executions/message log) and ADR-0094 (shared-engine attribution). ADR-0090's host-login option is superseded. ADR-0092/0093/0094 explicitly preserve portions of ADR-0089, including ACP. The new ADR must supersede that surviving ACP commitment narrowly, and the adapter-specific Claude installation choice, without changing the remaining boundaries. There are two existing 0095 filenames; 0096 is available for this proposal; recheck sequence collisions before merging.

## Goals / Non-Goals

**Goals:** Copy the relevant Atlas implementation into independent Terminay source; use native Codex/Claude drivers; deliver the full desktop/apps/tools; preserve Terminay lifecycle/security behaviour; build from public dependencies; show truthful, accessible build progress.

**Non-Goals:** Shared private packages or imports, changes in Atlas, Gemini/direct-provider tool loops, remote runner transports, Atlas org/database/job services, changes to terminal-agent detection/project chat, or a new hostile security boundary between executions of the same bot user.

## Decisions

### 1. A self-contained source port with a small native-driver boundary

Copy the applicable runner/parsing/desktop pieces, rename product-owned paths/env/configuration, and remove internal integrations. Record the source revision, copied files, selected upstream versions and applicable notices in a Terminay-owned provenance document. This record is maintenance evidence, not an import or a promise of automatic future synchronization. No build script reaches outside the Terminay checkout. An inventory/static check rejects private registry URLs, Atlas package dependencies and sibling-repo references in executable build/runtime inputs.

Adapt runner execution to the existing EngineDriver: native CLIs execute inside the persistent bot container through `terminay-run`. Retain credential leases, cancellation deadlines, process-group identity protection and cleanup confirmation. Do not port Atlas's local-process/SSH transports, host bind mounts, disposable-container lifecycle or provider-shared auth store. Container creation stays with Terminay's validated server-owned environment layer; copy useful launch-validation rules only where applicable to that boundary.

Introduce a host-owned execution driver interface with start/prompt, event delivery, permission response, cancel and close. Built-in driver kinds are `codex-cli` and `claude-code-cli`; declarations choose supported kinds and native commands/configuration are assembled by the host. Port Atlas's native Codex JSONL and Claude streaming paths; extend them with incremental framing, bounded records and normalized tool/plan/status/error events needed by Terminay. Avoid buffering an entire run as Atlas's final-output parser does. Unknown events remain bounded diagnostics; invalid required protocol/final outcomes fail visibly. No arbitrary extension-supplied parser or host executable enters this interface.

**Boundary:** Untrusted contribution/client data selects only validated declared runtime settings; privileged server code owns engine/process/protocol operations. Retaining ACP would preserve two execution stacks; importing Atlas would make a public installation depend on private code. Both alternatives are rejected.

### 2. Preserve credentials, approvals and communication semantics

Use the existing vault, per-execution credential lease, injected-environment redactor and bot-owned sign-in helpers. Native API-key configuration must not write secrets to disk. Login configuration remains separate from token configuration so the selected method wins over a saved login. Tool shells retain credential-variable exclusion. Native guided login/logout executes only in the bot home; the host never reads persisted login files. No idle CLI exists merely to refresh credentials.

The CLI receives the existing bounded execution briefing, pinned memories and runtime MCP setup. `chat_post` is the only reply path; CLI final answers remain diagnostics. Existing trigger/admission/event/replacement semantics and attachment capture remain unchanged.

Preserve Claude Ask me via a bidirectional native control stream and the existing server-owned permission record/first-answer logic. Copy Atlas's autonomous flags only for Autonomous executions. The exact pinned CLI/control-channel behaviour is a required first implementation gate; test allow, reject, expiry, simultaneous device answers and cancellation before switching defaults. Codex remains Autonomous only. Failure of this gate blocks adoption; do not silently drop Ask me or retain a hidden ACP fallback.

**Boundary:** Credential values and execution capabilities never become renderer-owned authority. Same-bot tools can inspect same-user processes; environment exclusion is hygiene rather than hostile-process isolation.

### 3. Port the desktop inside the existing protected environment

Retain `terminay-init` as PID 1 and owner of fail-closed bootstrap, VNC credentials, readiness and cleanup. Adapt Atlas XFCE settings/menu launchers and lifecycle supervision to `/home/bot`, the existing display and protected VNC endpoint. Keep the browser sandbox enabled; do not copy `--no-sandbox`. Use process exit events/waits and bounded readiness watches rather than Atlas's periodic `pgrep`/sleep health loops, consistent with ADR-0028. Desktop restarts must not create duplicate browser profiles or windows indefinitely.

Adapt desktop-control and desktop MCP into Terminay-named helpers. Control/CDP listen only on container loopback (or use the existing private socket), with no published ports or websockify listener. Integrate with the existing browser helper instead of running a competing browser owner. Configure menu launchers to reuse its persistent profile and Downloads directory. Install/pin connect-only browser MCP against that browser and expose bounded whole-desktop screenshot/window/input/launch/save tools. Route tool dispatch through execution-bound runtime handlers and validate active capability plus shared-work ownership before control/browser calls. Retain the human RFB relay's view-only filtering. Revocation closes the execution's bridge; it does not tear down the desktop.

**Boundary:** The authenticated server relay remains the only human access route. Desktop MCP is confined to its bot's display/browser and never joins the general workspace MCP registry. The default shared-engine proxy remains unrestricted as accepted in ADR-0094; desktop isolation must not be presented as a sandbox against a bot that controls that engine.

### 4. Locally build a public, pinned desktop image

Use the current public Node/Debian base compatible with Terminay, public upstream package sources and exact native CLI/browser-MCP versions proven by conformance. Copy Atlas's ArtCraft installer and retain the observed app pins initially: PhotoCraft 0.17.0, VectorCraft 0.18.0, FilmCraft 0.14.0, LightCraft 0.15.0, PDFCraft 0.15.0, EffectCraft 0.18.0, DesignCraft 0.14.0, FigCraft 0.12.1, WordCraft 0.12.0, SoundCraft 0.14.0, DeckCraft 0.12.0, CADCraft 0.14.0, GridCraft 0.13.0. Verify public downloads/dependencies on amd64 and arm64 rather than assuming compatibility between Atlas's Bookworm and Terminay's Trixie. Install Mesa software rendering support. A missing application is a failed build, not a silent success.

Native CLI versions must be exact and recorded during the first conformance task; Atlas's unpinned npm install is not a version policy. Keep image fingerprinting across helpers/manifests/generated layers, server uid/gid handling, staged image-tag publication, old-image preservation and explicit recreation rules. A public image build may pull public base images; it never pulls a prebuilt bot image. Build inputs are also included in packaged server/Desktop artifacts. Building versus pulling is provisioning; native execution does not depend on that choice.

### 5. A compact entry point and an authoritative build timeline

Add a server-owned shared-image build record: build id, engine identity, target fingerprint, revision, timestamps, overall state, ordered step records and bounded redacted logs. This is one build per server, not per bot. A second build request attaches to the active attempt. Persist the latest summary/transitions and bounded log tail; on server startup reconcile an active record or mark it interrupted without automatically restarting the build. Retry creates a new id. Keep only the latest attempt plus the latest successful-image metadata; show log truncation explicitly.

Capture structured build records before `socketDriver.ts` flattens them into plain output. Normalize BuildKit vertices/cache/start/completion/error, Docker classic Step output and Podman equivalents. Instrument context preparation and final local-tag publication as real steps. Use deterministic readable descriptions for shipped Dockerfile operations and progress messages for each creative app. Preserve multiple active vertices. Unsupported output maps to a generic active build-output row with expandable logs; no fake percentage, success or guessed per-command completion. Overall success follows successful final tag publication, not just the last Dockerfile step. Parsing must tolerate chunk fragmentation and ANSI/control text safely.

Extend `botEngine` protocol/client schemas with bounded build snapshot/log reads and existing authority/invalidation behaviour. Expose ids/status/descriptions, never raw engine operations or host paths. Subscribe while a relevant view is mounted, coalesce invalidations and refetch bounded state; no progress poll. The build continues without a viewer. Reconnect rehydrates the active/latest snapshot; lost transport is not a build failure or success.

Replace the large image-building area with a single-line keyboard-operable banner showing the current step and a details affordance. Open a dedicated server-scoped Build progress page within Bots, preserving the prior view on Back. Keep the newest completed build accessible from image controls. The page has a compact title/overall-state/elapsed header and a vertical timeline: green check/completed, amber running, red cross/failed, neutral pending, explicit cached badges. Pending rows represent only known planned steps; engine-discovered work is added as observed. Descriptions are concise and user-facing; commands/logs are expandable secondary detail. Show failure summary and Retry; preserve the old-image explanation when applicable. Handle mobile width, focus, screen-reader labels, reduced motion and disconnect/interrupted states. A display-only elapsed clock never triggers server work.

**Boundary:** Build progress is privileged server state under the existing bot authority. A renderer never parses raw engine streams or sends commands selected from logs.

## Risks / Trade-offs

- Native CLI protocols vary → exact pins and executable conformance gates; record verified capabilities and fail closed on missing approval support.
- Much larger downloads/builds → cache stable layers, describe real steps, surface specific failures and retain the previous usable image.
- ArtCraft graphics/dependencies differ by architecture/base → test every installed app's launch/save path and software rendering on both architectures.
- Source copies diverge → record copied revision/adaptations and keep Terminay-owned tests; no dependency on Atlas for future fixes or CI.
- Build output formats differ → fixtures from real Docker and Podman, incremental parsers and honest generic-output fallback.
- Concurrent executions share a desktop/home → keep admission and work ownership; do not claim same-user hostile isolation.

## Migration Plan

1. After proposal state reaches main, prove native CLI credentials, MCP and Claude Ask me in the bot image before replacing ACP. Carry forward the new ADR with a collision-free number and references; accepted ADR files stay frozen.
2. Preserve agent ids and profile/sign-in formats. Add driver/runtime provenance to new executions and a compatible reader for historical ACP diagnostics. No historical execution is replayed or resumed. Incompatible third-party ACP declarations are refused with an explicit update message; only supported native driver declarations run. Version the extension bot contract and update examples/fixtures.
3. Build the new image under the existing temporary tag flow. Failure preserves the old image; running bots show Recreate to update and are not silently replaced. Keep home volumes/downloads/logins. If deployment is rolled back, stop new executions, restore the previous application/image together, and preserve homes and additive historical records; do not claim old and new driver contracts interoperate.
4. Reconcile pending ACP-specific requirements in active bot changes with this delta before archival, preserving all unrelated scenarios and accepted ADR history. Main specs receive present-tense contracts only; transition history belongs here. Archive only after implementation has merged, under the repository Git workflow.

## Open Questions

No user scope decision is outstanding. Required verification items are the pinned native Claude bidirectional permission channel, Codex key non-persistence/selected-credential precedence, exact native CLI/browser-MCP pins, public ArtCraft availability/graphics on both architectures, and actual engine output fixtures. Failures block completion and must be reported rather than relaxing contracts.

The ADR step records the narrow supersession of ACP-specific parts of ADR-0089 as reaffirmed by ADR-0092/0093/0094, ADR-0091's ACP authentication mechanism, and ADR-0095's adapter-bound native installation choice. All per-bot sign-in, container execution, message log, local engine and no-polling obligations continue.

### Docker browser sandbox policy

Docker's default seccomp profile blocks the namespace calls Chromium needs. The bot container uses Playwright's default-derived deny-by-default profile, permitting `clone`, `setns` and `unshare`, plus `pidfd_open`/`pidfd_send_signal` for race-safe supervisor ownership, together with Debian's `chromium-sandbox` package. The host sends the profile inline in the Docker API create request; no daemon file or additional capability is required. Podman retains its native policy (its compatibility API treats a seccomp value as a daemon path). Neither engine uses an unconfined profile, privileged bot container or SYS_ADMIN capability. The profile participates in the image fingerprint, is bundled with server-core and retains its Apache-2.0 license. Hosts must allow Chromium's namespace sandbox; failure stays visible.
