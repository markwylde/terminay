# Verification

2026-11-02, macOS arm64. The owner authorized proposal and implementation in one branch/PR.

## Local checks

- Application build: passed (`npm run build:app`).
- Workspace typechecks: passed, 27 tasks (`npm run typecheck:workspaces`).
- Repository lint: passed; existing warnings remain (`npm run lint`).
- Bot suites: passed, including minimal-PATH socket discovery, Podman random compatibility IDs, marker replacement/deletion, explicit remote refusal, local Podman connection verification, missing-image/recovery, no invalidation loop, binary frame splits, request abort/deadline, transport close, credentials, supervised shell, file helpers and composed client journeys.
- Full server-core suite in the Docker-isolated E2E image, after building protocol-conformance: 1,920 passed, 10 skipped, zero failures. Direct broad host runs exited 137; the isolated run provides the complete result.
- Bots Electron E2E: all eight journeys passed (35 seconds) through `npm run test:e2e -- e2e/bots.spec.ts --workers=1`, never on the host.
- `openspec validate --all`: 101 passed, zero failures.
- `openspec validate bots-use-container-socket`: passed (long-requirement style warnings).
- `openspec validate --all --archived`: 204 passed, four existing archive failures, all due to incomplete task lists in `2026-09-06-agent-provider-status-conformance`, `2026-10-07-notifications-icon-and-project-dot`, `2026-10-10-macros-script-editor`, and `2026-10-27-github-worktree-status`. The accepted history is unchanged.

## Real engines

- Podman 6.1.4, rootful local libkrun machine on macOS: shared socket smoke passed. It builds a uniquely tagged image, creates a bounded temporary container, verifies repeated exec and UTF-8 stdin round trips, TTY resize to 100x40, statistics, logs, socket group probing, and read/write access to the shared socket as the unprivileged bot user. The image's Docker CLI successfully reaches Podman through that socket. Temporary containers/images are removed.
- Real bot shell on Podman: passed `whoami`, 100x40 resize and confirmed supervisor process-group teardown after close.
- Docker 29.9.2: the same shared socket smoke passed against an isolated Docker-in-Docker daemon. A test-only local Unix-to-loopback bridge exposes the daemon's API; production continues to refuse TCP endpoints. The test builds from a local BusyBox utility image, exercises repeated exec and TTY resize, and verifies that the unprivileged `nobody` user can read/write the group-authorized socket. Temporary containers/images and the isolated daemon are removed after verification.
- Rootless Podman capabilities, unsupported rootless Docker, machine connection validation and daemon-side URI normalization are covered by API fixtures. This machine's live Podman machine is rootful; live rootless Podman is not claimed.

## Delivery

One Gitea PR contains the proposal, delta spec, design, ADR and implementation. Final PR head statuses are checked after pushing. No release, deployment or merge is performed.

## Existing-profile recovery

The first manual development-profile launch exposed a recovery UI gap: an old native Podman pin required reselection, while a long socket address overflowed the rail and hid the action. The fix verifies and upgrades valid saved native pins, preserves explicit recovery for unverifiable pins, offers recovery even at an unchanged address, and keeps the action within the rail. The actual development window was then inspected with the computer-use skill: Podman available, the existing Test bot running, and Build image visible for the outdated image. All 33 Chromium bot UI tests passed, including a long-address/same-address recovery regression.

## Browser startup

The desktop uses DISPLAY=:1. Chromium now starts under init as the unprivileged bot user, independently of agent tools, with its sandbox enabled. Init tests passed (5 passed, 1 opt-in skip). A real container built from the updated Dockerfile and bootstrapped with no network produced a visible about:blank Chromium window without an agent command; xdotool waited for the X window and wmctrl confirmed its title. Ordinary exec inherits DISPLAY=:1. The verification container was removed. Chromium was also opened in the user's current development bot without rebuilding or replacing its container.

## Chat history and desktop follow-up

Server bot tests: 163 passed, 5 opt-in skips (serialized run); all 34 Chromium UI tests passed; eight Docker-isolated bot E2E tests passed. Workspace and renderer typechecks passed. Active OpenSpec validation: 101 passed.

Message actions reuse the platform ContextMenu. The UI regression places the bot pane inside a translated containing block and checks pointer alignment. Edit and clear dialogs use the existing bots-dialog layout and spaced footer; composer actions are grouped. Revised history persists across store reload, redacts credentials and starts without the previous provider session ID. Read-only, wrong-bot, stale-target and busy mutations are refused.

The actual development bot was recreated through its Environment action with its home preserved. Chromium runs as a child of init. Navigation through the installed desktop tools reached a window titled Home - BBC News - Chromium. A separate real Codex chat using the updated context then navigated the existing window, inspected the window list and captured before/after screenshots. The turn completed, the app preview visibly showed BBC News, and Chromium remained open after completion. The original conversation was preserved.

## Browser recovery and unfinished status (initial approach, replaced below)

The reported run (session 499026a68fe7f0c4554d3675) made 13 tool calls. Its first screenshot capture saved a suffixed filename while the agent read the older file. It found no Chromium process, tried a background launch that disappeared, and eventually ran Chromium in the foreground; that tool never reported terminal status. Completed response and terminated tool process are distinct states.

The transcript now animates unfinished tools only in the active turn and explicitly labels missing final outcomes without claiming success. All 35 Chromium bot UI tests passed, including running/completed/stopped/failed outcomes. Renderer typecheck passed; lint retained 65 existing warnings. Init tests: 6 passed, 1 opt-in skip, including a controlled child restart, shutdown and stale singleton-lock cleanup while preserving profile Preferences.

A real recreated development container initially exposed Chromium's stale cross-container profile lock. Startup now removes only Chromium singleton lock entries, as the unprivileged profile owner, before the fresh container is ready. The corrected image opened about:blank without agent launch; terminating Chromium then produced a replacement visible browser window under the supervisor. A fresh real bot turn navigated that window to BBC News without launching Chromium, completing with terminal tool outcomes. That run used eight calls and captured its verification too early, so the guidance was further clarified to combine keyboard navigation and require the screenshot after Return. The final wording has build/typecheck and memory-test coverage; no fixed call-count guarantee is claimed.

## Final browser lifecycle: startup once, then explicit requests

The user clarified that closing Chromium must leave it closed. Automatic restart and browser watching were removed. Init starts the desktop-owned launcher once and waits for its private request socket. The launcher opens Chromium once, then blocks on explicit requests; it does not monitor browser state. `terminay-browser open URL` delegates existing-window reuse and launch-after-close to Chromium single-instance dispatch, independently of agent tool groups. The command accepts bounded HTTP(S) URLs and acknowledges launch requests separately from observing page load.

Controlled tests confirm initial launch, no relaunch after exit, explicit request launch, rejected unsafe/oversized URLs, and stale lock cleanup without deleting profile Preferences. Init tests: 6 passed, 1 opt-in skip. Full serialized server bot suite: 164 passed, 5 opt-in skips. Renderer typecheck and memory tests passed; active OpenSpec validation: 101 passed.

Real development container: initial about:blank appeared; a URL command navigated the existing window to Example Domain. After closing Chromium, two checks spanning six seconds found no browser window. An explicit URL command then opened BBC News in a new Chromium window. Home and device sign-in were retained.

## Inline screenshots and browser width

The reported assistant reply contained `![BBC News screenshot](/tmp/desktop-after.png)`. Chat previously disabled Markdown images, and a container path cannot be opened as a host/browser URL. Local raster images now use authenticated Bot I/O queries and revocable blob URLs. Server reads require bot ownership and current write/terminal-create authority, cap image bytes at 2 MiB, open regular files through no-follow directory descriptors, and reject non-raster signatures. Remote Markdown images and host paths stay inert. These are previews of files in a running container; this change does not add durable attachment storage.

The original conversation was opened in the actual dev app and its image appeared as the BBC News screenshot image rather than a link. The live Chromium window was maximized to 1440x900. A separate freshly built and bootstrapped container, with no network, started Chromium at x=0/y=0 and 1440x900 using the new start-maximized flag; that verification container and image were removed. The user's existing container and screenshot file were preserved.

Verification: full serialized server bot suite 166 passed, 5 opt-in skips; image reader/protocol tests 4 passed; Chromium UI includes an actual decoded inline PNG, unavailable image state and remote/host-path refusal. Renderer typecheck and lint passed (65 existing warnings); active OpenSpec validation 101 passed.


## Configuration review (2026-11-02)

Triggers now fills the panel inside its existing padding. Chromium UI coverage measures both the content and New trigger alignment at 1920px and 760px, with no horizontal overflow.

The workload list previously included any bot-labelled container except the main bot, which exposed internal Files helpers and temporary Terminay containers. Live Podman inspection confirmed every entry in the reported list carried terminay.managed=1; the Files container also carried terminay.helper. Both labels are now excluded after inspection. The same predicate gates workload actions. No existing containers were removed. The docker wrapper continues to attribute workloads by bot ID; this is best-effort attribution and does not restrict the shared engine socket.

Agent capability review: memory content is Markdown under /home/bot/memories, so the bot can create, read, update and delete it through shell tools while holding its work lease; UI changes are observed through the existing file watcher. Pinning/unpinning is server-owned metadata and is currently exposed only through the client API/UI. Trigger CRUD, enable/disable and Run now are implemented for clients in BotTriggers, but are not exposed in the scoped BOT_RUNTIME_TOOLS catalog, so the bot cannot currently manage its triggers. No new management tools are claimed or added by this UI correction.

Verification: 14 environment tests and 40 Chromium bot UI tests pass, renderer TypeScript passes, targeted lint has no errors (17 existing warnings), and active OpenSpec validation passes all 102 items.
