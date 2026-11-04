## 1. Prove native runtime compatibility

- [x] 1.1 Copy the relevant Atlas runner/parser/desktop source subset into Terminay-owned locations, remove internal imports/endpoints/transports and record source revision, adaptations and applicable notices. Verify the build/runtime dependency graph has no Atlas checkout/package/private-registry requirement.
- [x] 1.2 Select exact native Codex/Claude and connect-only browser-MCP versions and prove streaming, model selection, MCP communication and successful/error outcomes inside the bot image against controlled model endpoints. Record commands, versions and conformance evidence.
- [x] 1.3 Prove Claude's native bidirectional permission channel supports Ask me, allow/reject, expiry, cancellation and first-device-answer races. Verify no Ask me launch uses permission-bypass flags; stop adoption if this gate fails.
- [x] 1.4 Prove API-key non-persistence, selected-key precedence over saved login, credential exclusion from tool shells, chunk-safe redaction and bot-owned guided login/logout for both agents. Verify two bots never share credentials and no host login is read.

## 2. Replace ACP execution with host-owned native drivers

- [x] 2.1 Add validated native-driver declarations and versioned extension compatibility rules, updating built-in manifests/runtime declarations and public examples while preserving agent ids. Verify unknown drivers/obsolete ACP declarations are rejected actionably and existing profiles retain their selected agent/model/sign-in.
- [x] 2.2 Implement bounded incremental native event adapters for Codex and Claude, including text/tools/plans/status/permissions/errors and terminal outcome validation. Verify split records, large/malformed events, stderr, missing final outcomes, authentication failures and nonzero exits.
- [x] 2.3 Integrate drivers with EngineDriver exec and the existing supervisor, credential lease and lifecycle. Verify Stop, timeout, normal completion, crash and replacement leave no supervised tool processes before lease release, protect against reused process groups and interrupt unfinished work on server restart.
- [x] 2.4 Wire existing bounded briefings, scoped MCP tools, explicit chat posts, durable attachments and work coordination into native launches. Verify native final output stays diagnostic, corrections can replace older work and revoked executions cannot post or control the desktop.
- [x] 2.5 Preserve historical diagnostic reading and record driver/version for new executions; remove unused ACP bot paths/install layers after switching. Verify historical records remain readable without resuming work and ordinary terminal detection/project chat behaviour is unchanged.

## 3. Port the desktop and public local image

- [x] 3.1 Adapt Atlas's XFCE defaults/menu/terminal/session helpers under Terminay's fail-closed init and existing protected VNC lifecycle. Verify first start has no setup dialogs, desktop survives execution completion, critical process failures are visible and no periodic health/process-table polling is introduced.
- [x] 3.2 Integrate the existing browser owner with persistent profile/download policies and same-profile menu launchers. Verify sandbox-enabled unprivileged startup, stale-lock recovery, restart/recreate persistence and a single shared browser accessible to agent tools.
- [ ] 3.3 Install the thirteen pinned ArtCraft apps and Mesa software rendering from public upstreams, adding exact native CLI/browser-MCP installs to generated image inputs. Verify every app launches/renders and can save into the home on amd64 and arm64; a missing app/download fails the build.
- [ ] 3.4 Adapt desktop-control/MCP and connect-only browser automation through active execution capabilities and work-lease checks. Verify screenshot/crop/window/input/launch/browser-save operations target the human-visible desktop, revoked/wrong-bot/non-owning executions are refused and posted screenshots use durable attachment capture.
- [ ] 3.5 Preserve loopback-only services, bootstrap/password enforcement, no published ports, view-only relay filtering, engine identity/labels/limits and the shared-engine proxy. Verify negative access cases plus the existing Docker/Podman engine and proxy conformance suites.
- [x] 3.6 Include all desktop/runtime/app inputs in fingerprinting and packaged build contexts. Verify a fresh public checkout without Atlas/private registry credentials builds successfully, changed inputs invalidate the image and failed rebuild/recreation preserves the prior image and bot home as specified.

## 4. Model authoritative build progress

- [x] 4.1 Add bounded validated build/step/log DTOs and server-owned latest-build persistence using the shared durable-replace primitive. Verify stable ids/revisions, redaction, truncation, latest-success metadata, restart interruption and distinct retry identities.
- [x] 4.2 Normalize real Docker BuildKit/classic and Podman build records before flattening, including cache, parallel activity, per-app install descriptions, context preparation and final tag publication. Verify fixtures for chunk fragmentation, ANSI/unknown/malformed output and tag-publication failure; unsupported output stays readable without fabricated progress.
- [x] 4.3 Extend bot-engine client/protocol snapshot and bounded log reads with existing authority and event invalidations. Verify unauthorized reads fail, reconnect obtains current progress, multiple clients attach to one build, closing views does not cancel builds and no status polling occurs.

## 5. Deliver the compact banner and timeline page

- [x] 5.1 Replace the large build panel with a single-line clickable banner and a server-scoped Build progress page entry, retaining completed-build access from image controls. Verify keyboard activation, long-label truncation, narrow screens and navigation back to the prior Bots view without creating another build.
- [x] 5.2 Render the clean ordered timeline with left green ticks, amber active markers, red crosses, neutral pending rows, cached labels, readable descriptions, elapsed/overall status and expandable logs. Verify colour-independent labels, multiple active steps, reduced motion, focus, screen-reader semantics and explicit truncation.
- [x] 5.3 Add completion/failure/interrupted/disconnected states and Retry, including previous-image messaging. Verify reopening/reconnecting recovers the same build and retry cannot mix events or report success before local-tag publication.

## 6. Reconcile contracts and validate the complete change

- [x] 6.1 Reconcile ACP-specific active bot/environment/extension/login contracts with the native-driver deltas, preserving unrelated scenarios and all accepted prior ADR files. Update operator/public extension documentation and ADR index for 0096; verify archive order cannot overwrite the native-driver contract with pending ACP text and no ADR number collision exists.
- [ ] 6.2 Run targeted protocol, server-core, built-in-agent conformance, desktop-control and build-parser/UI checks plus repository lint/type checks. Verify the retained credential, approval, coordination, cancellation and engine contracts against both Docker and Podman and record results.
- [ ] 6.3 Run the relevant Electron end-to-end flows through `npm run test:e2e`, including first build timeline, failure/retry/cache/reconnect/mobile, bot sign-in/execution, creative-app desktop use and recreation. Never invoke the Electron Playwright suite directly on the host; record passing Docker-isolated results and architecture-specific runtime evidence.
- [ ] 6.4 Run `openspec validate --all --archived` and change validation, review the public build/runtime dependency inventory, and attach final verification evidence. Verify every acceptance scenario has evidence and leave any unavailable real-engine/architecture checks explicitly incomplete.
