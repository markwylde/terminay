## 0. Prerequisites and feasibility gate

Nothing after group 0 starts until one of two things happens: every item in 0.3–0.10 passes, or the owner chooses a fallback that the design names. "Gate failed, feature blocked" is a valid outcome. Each spike records its script, versions, and output in `openspec/adr/evidence/0089-bots/`. Credential spikes use throwaway agent homes, never the user's own login.

Model calls in every spike and test go through OpenRouter, using `OPENROUTER_API_KEY` from the main checkout's `.env`. Only the cheap models may be used: `openai/gpt-6-luna` for Codex and `anthropic/claude-haiku-5.5` for Claude Code. The key is passed with `-e NAME` and never written to disk, evidence, or logs.

The engines are the Podman machine on this Mac, and rootful Docker on Linux. The Linux Docker runs as a privileged `docker:dind` container under Podman. Docker Desktop and OrbStack are checked when they are available.

- [ ] 0.1 Confirm that `add-agent-chat-and-pixel` and `unified-settings-window` are archived. Verify: `openspec validate --all` passes. `openspec/specs/extension-platform/spec.md` lists `contributes.agentChatProviders`, and the main `workspace-dashboard` spec lists Recordings.
- [x] 0.2 Build a prototype bot image containing `terminay-init`, `terminay-run`, `terminay-files`, TigerVNC, and the pinned `@agentclientprotocol/codex-acp` and `@agentclientprotocol/claude-agent-acp`. Verify: the image builds with `podman build` on the Podman machine and with `docker build` on the Linux Docker engine. The exact versions are recorded.
- [x] 0.3 Spike Codex Host login on both engines. Result: every functional check passes on the Podman machine and on Linux Docker, using fake keys and `codex login --with-api-key` through the link. Codex writes `auth.json` in place, and its sidecar is `auth.lock`. Podman masks need `notmpcopyup`. Locks cross between host and containers on Linux, but not between the Mac and the Podman VM; the owner accepted that race. A real ChatGPT OAuth refresh stays a manual owner check. Host login was later withdrawn (ADR-0091); this result is history.
- [x] 0.4 Spike Claude Code Host login on Linux. Result: a link fails on write, because Claude Code renames over the path. `CLAUDE_SECURESTORAGE_CONFIG_DIR` pointed at the masked mount works. A real Claude OAuth refresh stays a manual owner check. Host login was later withdrawn (ADR-0091); this result is history.
- [x] 0.5 Spike tokens. Result: `ANTHROPIC_API_KEY` signs in and never leaks. `CODEX_API_KEY` needs ACP `authenticate {api-key}`, plus an ephemeral credential store and a shell-environment exclude to keep it off disk. Tools can read the agent's environment. `CLAUDE_CODE_OAUTH_TOKEN` stays a manual owner check.
- [x] 0.6 Spike ACP behaviour. Result: model config options, no client capabilities, `session/load` after restart, and sign-in failure and recovery all work. Claude asks permission. Codex is Autonomous only. Claude needs `CLAUDE_CODE_MAX_RETRIES` set low.
- [x] 0.7 Spike cancellation. Result: both adapters acknowledge at once but leave the tool running, so Stop always ends the group. `--kill` leaves nothing, stale records spare unrelated work, and `bot` cannot read the records.
- [x] 0.8 Spike the `terminay-files` helper against a stopped bot and a running bot. Verify:
  - every operation works;
  - files are owned by `bot`;
  - a link to `/etc` is refused;
  - a link swapped in during an operation is refused;
  - renaming or deleting auth paths and their ancestors is refused;
  - the CPU, memory, and process limits hold;
  - inotify reports changes the bot makes;
  - a fresh volume first opened by the helper, run with `--entrypoint terminay-files`, has its root owned by `bot`.
- [x] 0.9 Spike the desktop, container side. Result: no bootstrap means exit 78 after 30 s. VNC authentication only, and `bot` cannot read the password. On the Podman machine another bot reached the published port through the host gateway, so the desktop moves to an `exec` tunnel with no published port. The relay, noVNC, view-only, and the allowlist moved to 4.11.
- [x] 0.10 Spike engines. Result: the image builds and a bot runs end to end on the Podman machine and on Linux Docker (`docker:dind`). Rootless Podman enforces limits. The shim prints `docker version <podman version>`. Detection, refusal, pinning, and adoption moved to 4.1.
- [x] 0.11 Review the gate with the owner. Verify: the owner approves the evidence, or chooses the named fallbacks, or declares the feature blocked. The artifacts are updated through `/opsx:update` before group 1 starts.

## 1. Shared schedule engine

- [x] 1.1 Extract `ScheduleEngine` and `EventFanout` from `packages/server-core/src/automationService/`, and move automations onto them. Verify: every existing automation test passes unchanged, and new unit tests cover registering sources.
- [x] 1.2 Add the once and every-N schedule kinds, anchored, measured in elapsed time, with a 5-minute minimum, recomputed after restart, and with a missed once disabled. Verify: fake-clock unit tests, including restart and both daylight-saving transitions.

## 2. Extension API: bot agents

- [x] 2.1 Add the `botAgents` schema (install step, ACP command, auth file with its platforms, bot path or directory variable, and sidecar names and patterns, credential secrets with their kind and optional ACP `authenticate` method, the Autonomous-only flag, bot config files, and launch environment) and the `agent-bots` permission, and bump the API version. Verify: unit tests reject, each with its reason, an unpinned version, an absolute path or one containing `..`, a reserved bot path, a bad environment variable name, an unknown secret kind, and a missing permission. The auth file part is replaced by the device sign-in in 9.1.
- [x] 2.2 Add `registerBotAgent` with `models`, `status`, and `launch`. Bound its results and cache `models`. Verify: unit tests cover an undeclared id, a duplicate id, registration after deactivation, oversized results, and a timeout reported as unavailable.
- [x] 2.3 Enforce the host-owned behaviours and the secret-brokerage exception, and extend the conformance harness and the author example. Verify: `npm run test:built-in-extensions` passes. Tests prove that an extension can reach no bot, transcript, container, or bot token.

## 3. Built-in agents

- [x] 3.1 Declare the Claude Code and Codex bot agents, with the pins, auth files, sidecars, directory variable, Autonomous-only flag, Codex bot config file, and Claude launch environment that group 0 established (see `openspec/adr/evidence/0089-bots/gate-results.md`). Record the pins in the README. Verify: manifest validation passes, and the README names the pins. The auth files are replaced by the device sign-in in 9.2.
- [x] 3.2 Implement `models`, `status`, and `launch` from what 0.6 found. Verify: unit tests for each agent.
- [x] 3.3 Add conformance tests that run each pinned adapter in the bot image against a fake model endpoint. They cover initialize, new session, streamed prompt, tool use, a permission request (Claude Code), model selection, cancel, load after restart, the declared auth file, directory variable and sidecars, and that a credential reaches neither the bot's disk nor a tool shell. Verify: `npm run test:built-in-extensions` runs them in Docker, and they pass. The auth-file checks are replaced by the device sign-in check in 9.2.
- [x] 3.4 Turn the checks from 0.3–0.5 into an opt-in script for real credentials, `npm run test:bots:credentials`. It uses OpenRouter with the cheap models and throwaway homes, and is never run in default CI. Verify: the script refuses to run against the user's real agent homes, and passes.

## 4. Server: Docker, image, and environment

- [x] 4.1 Add `botService/engine.ts`, with `DockerDriver` and `PodmanDriver`. It covers:
  - engine detection and pinning: rootful Docker, Podman rootful or rootless, the local Podman machine, not Windows;
  - the per-engine differences: uid mapping, socket path, and limits support;
  - the availability reasons;
  - calls that pass an argument array with a deadline;
  - `docker events`;
  - adoption by server id and bot id.

  Verify (these are the engine checks moved from 0.10): unit tests against fake `docker` and `podman` executables cover detecting the shim, each refusal reason, an explicit engine address on every call (`--host` or `--connection`), the event stream ending leading to unavailable, and a same-named resource from another server not being adopted.
- [x] 4.2 Ship `docker/terminay-bot/` and generate the agents layer and fingerprint from validated manifests. Verify: unit tests show that only the pinned lists reach the Dockerfile, and that the fingerprint changes when an agent is added.
- [x] 4.3 Implement the container lifecycle:
  - lazy creation of the network, volume, and container;
  - no published ports;
  - resource limits;
  - start, stop, restart, and recreate;
  - recreating an out-of-date container;
  - writing each agent's bot config files at creation and restoring them before each session;
  - closing the helper before delete or recreate;
  - reconciliation.

  Verify: unit tests against the fake driver cover every transition.
- [x] 4.4 Implement the `terminay-init` bootstrap: wait on a root FIFO, exit if no bootstrap arrives within 30 seconds, write the VNC password readable by root only, start Xvnc on loopback only, then create the auth links for agents with a bot path. Add `terminay-init --tunnel <port>`, a stdio-to-loopback pipe. Verify: an integration test shows that a container with no bootstrap exits, and that `bot` cannot read the password. The auth links are removed in 4.5.
- [x] 4.5 Remove host login (ADR-0091 supersedes ADR-0090). Delete the host-login service, its directory watch, masks, sidecars, path validation, mounts, `terminay.host-login` label, host-login security state, the `host-login` sign-in kind, the per-bot confirmation and its operations, the unsafe state and alarms, the Overview `hostLogin` field, and the `authFile` contribution with its validation, platforms, bot path, directory variable, sign-in command, and sidecars. `terminay-init` no longer creates auth links. Terminay reads no login of the server account. Verify: `rg -i "host.?login|authFile|sidecar|CLAUDE_SECURESTORAGE"` finds nothing outside archived history and ADR evidence, and the server, protocol, client-core, extension-api, built-in agents, and renderer test suites pass.
- [x] 4.6 Implement tokens:
  - per-bot entries in the vault;
  - injection through the client's environment only;
  - explicit copying to another bot;
  - ACP `authenticate` for a secret that declares it;
  - streaming redaction with a carry-over window;
  - the note in Profile that the agent and its tools can read the token;
  - token values held in memory only for open sessions and log views.

  Verify: unit tests show the secret is absent from the spawned arguments and present in the spawned environment, a value split across two chunks is redacted, and the values are released when the last session closes.
- [x] 4.7 Implement Share engine socket: the engine-side socket for each engine, `--group-add`, the warning for each engine, applied on recreate. Verify: unit tests for the arguments with the setting on and off.
- [x] 4.8 Implement idle stop and helper idle stop as one-shot deadlines. Verify: fake-clock tests show each arms, cancels, and honours "never", and that no timer repeats.
- [x] 4.9 Implement the `terminay-files` client:
  - one helper per bot, with a reference count;
  - resource limits;
  - 1 MiB chunks with credit-based backpressure and cancellation;
  - the bounds on uploads and listings;
  - refusing auth paths and their ancestors;
  - watch;
  - creating the volume when Files is opened if the image exists, and otherwise offering to build it.

  Verify: unit tests against a fake helper, and an integration test that reuses the cases from 0.8.
- [x] 4.10 Implement the Shell bridge under the PTY host. Verify: an integration test shows `whoami` prints `bot`, resizing propagates, and closing the shell ends its process.
- [ ] 4.11 Implement the RFB relay (the desktop checks moved from 0.9):
  - an `exec` tunnel to the container's loopback, with no published port;
  - VNC authentication on the server side;
  - RFB 3.8 with security type None to the client, over a stream bound to the client, bot, mode, and generation;
  - the message allowlist, with length bounds and a 4 MiB reassembly cap;
  - backpressure;
  - view-only filtering;
  - the thumbnail stream;
  - teardown when authority is revoked.

  Verify: protocol unit tests cover forged input, unknown types, oversized `ClientCutText`, fragmented messages, and stale generations. An integration test confirms a remote browser renders the desktop.
- [x] 4.12 Implement Overview's on-demand figures and its bounded, redacted log. Verify: unit tests show no timer is created and Refresh reads the figures again.
- [x] 4.13 Implement Containers: list by label, excluding the bot's own container, with the per-container actions. Verify: unit tests against the fake driver.

## 5. Server: bots, sessions, ACP, and memories

- [x] 5.1 Add the bot store, using ADR-0088's durable replace, with unique names, bounded fields, and the sign-in setting. Verify: unit tests cover restart, duplicate names, and a corrupt file being set aside.
- [x] 5.2 Implement the ACP client over `docker exec -i -u root … terminay-run`. It covers:
  - initialize, advertising no client capabilities;
  - new and load;
  - selecting the model through configuration options, or the `launch` fallback;
  - streaming;
  - ACP `authenticate` with the declared method before a secret is used;
  - setting `TERMINAY_CREDENTIAL_VARIABLES` to the agent's declared credential variable names (names only) for the image's `terminay-tool-shell`;
  - answering permissions by approval mode, with the first answer winning, and forcing Autonomous for an Autonomous-only agent;
  - rejecting a permission request whose turn timed out.

  Verify: unit tests against a fake ACP agent cover each update kind and each permission path.
- [x] 5.3 Implement Stop and closing:
  - cancel, then, once the agent acknowledges or after 10 seconds, always end the process group with SIGTERM, then SIGKILL after 5 seconds, using the supervisor rules: signal the whole group if the leader is alive with a matching start time, otherwise signal only group members that carry the session's nonce;
  - retire each record once its group is empty;
  - close on end, suspend, timeout, and bot stop;
  - release only once the group is confirmed gone;
  - after Stop, keep the session open and reload it with `session/load` on the next message, or end it for an agent that cannot load.

  Verify: unit tests use fake agents that honour or ignore cancel, including one that acknowledges but leaves a child process running, which must be gone after Stop. A stale-record test puts an unrelated process into a reused group number, without the nonce, and it survives `--kill`. An integration test on real Docker confirms no session process remains.
- [x] 5.4 Implement the turn lease and queue:
  - a chat between turns is suspended when work is queued;
  - a suspended chat is resumed with `session/load`, or a new session is started with a notice;
  - one queued message per session;
  - one pending firing per trigger;
  - a cap of 20 items per bot;
  - chat and triggers alternate when both are waiting;
  - queued items can be cancelled;
  - disabling a trigger removes its firing;
  - inputs are snapshotted.

  Verify: unit tests cover each scenario in "One turn at a time per bot".
- [x] 5.5 Implement the session store:
  - `session.json` and `segment-<n>.json`, each written with durable replace;
  - commits at turn end, at each permission request, at each status change, every 256 updates, and within a 2-second damping deadline;
  - metadata written after its segment;
  - uncounted segments set aside as corrupt;
  - the 8 MiB and 256 KiB caps;
  - retention.

  Verify: unit tests cover a crash between writing a segment and writing the metadata, the caps, and retention.
- [x] 5.6 Implement restart reconciliation:
  - `--kill-all`, checking start times;
  - interrupted state for running, suspended, and needs-you sessions;
  - cancelled approvals;
  - messages marked not sent;
  - firings skipped;
  - helpers removed;
  - idle timers armed.

  Verify: an integration test kills the server mid-turn and restarts it.
- [x] 5.7 Implement memories through the helper, and the per-session context block: the profile's instructions, then pinned memories, newest first, capped at 16 KiB in total. Verify: unit tests show the cap holds and no instruction file is written.
- [x] 5.8 Add the protocol operations and subscriptions:
  - terminal-create authority for every read, write, subscription, and stream;
  - invalidation-only subscriptions;
  - capability-bound callers refused;
  - teardown on revocation;
  - the bots capability.

  Verify: conformance tests show unauthorized list, get, and subscribe are each refused, and nothing is delivered after revocation.

## 6. Server: triggers

- [x] 6.1 Implement bot triggers on `ScheduleEngine` and `EventFanout`:
  - at most 50 per bot;
  - queueing, skipping, and suspending when the bot is busy;
  - missed firings;
  - failure reasons;
  - bounded event context.

  Verify: fake-clock unit tests cover each scenario in `specs/bot-triggers`, bot container activity raises no event, and automations are unaffected.

## 7. Renderer: Home › Bots

- [x] 7.1 Add Bots as a Home section between Tabs and Automations, update the empty state, and make bot tabs belong to Bots. The files are `src/workspace/homeSection.ts`, `homeTabs.ts`, and `HomeView.tsx`. Verify: unit tests for the five sections and for ownership. The Home E2E test is updated.
- [x] 7.2 Build the Bots dashboard:
  - cards and filters;
  - the Docker host summary, with Check again, Use this engine, and Build image, plus the reasons for rootless, remote, and unsupported engines;
  - Needs you;
  - New bot.

  Verify: component tests cover filters, live updates, and each setup reason. Screenshots are reviewed against the demo.
- [x] 7.3 Build the bot tab: the Chat and Configure toggle, the context rail, and preserved state. Verify: component tests for state preservation.
- [x] 7.4 Build Chat:
  - streaming, tool entries, and the plan;
  - Stop, with a note about detached work;
  - busy, queued, and suspended states, with the resume notice;
  - cancelling queued items;
  - New chat;
  - container-start progress;
  - Ask me prompts.

  Verify: component tests against a fake session stream.
- [x] 7.5 Build Profile:
  - the agent picker, grouped by extension, showing each agent's status and actions;
  - the model picker, with Default;
  - the approval mode, shown fixed with its reason for an Autonomous-only agent;
  - **Sign-in**: a sign-in token or API key with the note that the agent and its tools can read it, plus copying a token from another bot, with the note about the limits of redaction. Device sign-in is task 9.5.

  Verify: component tests show that no secret value is rendered after it is saved.
- [x] 7.6 Build Environment:
  - Overview, with Refresh, limits, and Recreate to update;
  - Files;
  - Shell;
  - Desktop;
  - Containers;
  - the Share engine socket confirmation.

  Verify: component tests for each sub-tab.
- [x] 7.7 Build Memories, Triggers, and Sessions:
  - Triggers: the editor, the preview, upcoming firings, and Run now;
  - Sessions: suspended and interrupted states, filters, transcript, runner output, Stop, and Continue.

  Verify: component tests for each.

## 8. End-to-end and docs

- [x] 8.1 Add E2E coverage through `npm run test:e2e`, using fake `docker` and `podman` executables and a fake ACP agent. Cover:
  - creating a bot while Docker is down;
  - chat;
  - Stop that is acknowledged while a command keeps running, and Stop that is ignored;
  - a trigger suspending an idle chat;
  - a full queue;
  - Run now;
  - restart leading to an interrupted session;
  - deleting a bot while keeping its home;
  - the five sections;
  - an unauthorized client;
  - a bot that is not signed in refusing a message with a reason naming Configure › Profile › Sign-in;
  - device sign-in with a fake `codex login --device-auth`, and sign out.

  Verify: `npm run test:e2e` passes.
- [x] 8.2 Write `docs/operations/bots.md`. Cover the supported engines and Docker versus Podman (including the macOS Podman machine), and why rootless Docker and Windows are excluded; building the image; per-bot sign-in (tokens, API keys, and device sign-in); Share engine socket; limits; and cleanup by `terminay.managed=1` and `terminay.server`. Verify: the doc is reviewed and every command in it has been run.
- [ ] 8.3 Smoke test on the Podman machine on macOS and on rootful Docker on Linux, using OpenRouter's cheap models:
  - a Codex bot signed in with ChatGPT, and one with an API key;
  - a Claude Code bot with a sign-in token, and one with an API key;
  - a bot that is not signed in refusing a message;
  - the desktop from a paired browser;
  - a long Stop;
  - a server restart mid-turn;
  - idle stop.

  Verify: a results checklist is in the PR description.
- [ ] 8.4 Run `openspec validate add-terminay-bots` and `openspec validate --all`, open the PR on Gitea (`origin`), and read back every `.gitea/workflows/ci.yml` status. Verify: validation passes, and every status is `success` or `skipped`.

## 9. Sign-in per bot (ADR-0091)

- [x] 9.1 Extension API: replace `authFile` with an optional `deviceSignIn` (`command`, `signOutCommand`, `label`, `help`, optional `configFiles`). Validate that both commands are present, and that config files obey the bot-config-file path rules. Update the conformance harness, the author example, and `packages/extension-api/README.md`, and bump the API version. Verify: unit tests reject a device sign-in without a sign-out command and a config file path that escapes `/home/bot`.
- [x] 9.2 Built-in agents: drop Claude Code's auth file. Give Codex the device sign-in **Sign in with ChatGPT** (`codex login --device-auth`, `codex logout`) with its own `.codex/config.toml` (`cli_auth_credentials_store = "file"`, credential variables excluded from tool shells), and keep the default config `"ephemeral"`. Verify: manifest validation passes, and the conformance test shows that the sign-in command prints a URL and a code and that an API-key bot writes no key to disk.
- [x] 9.3 Protocol and client-core: the sign-in kinds are `none`, `token`, and `device`. An agent's sign-in methods are `token` and `device`. Add the device sign-in terminal stream, bound to the client connection and the bot like the Shell, and a sign-out command. Verify: protocol conformance tests for each operation, including refusal for a client without terminal-create authority and for an agent that declares no device sign-in.
- [x] 9.4 Server: refuse a message or a trigger firing for a bot that is not signed in with `unavailable` and a message naming Configure › Profile › Sign-in, before any session or container work. Run the device sign-in command with `docker exec -it -u bot -w /home/bot -e HOME=/home/bot` under `terminay-run` through the PTY host, after writing the device config files. Set the sign-in to `device` on exit status 0 only. Write the device config files before each session of a `device` bot. Sign out runs the sign-out command and sets Not signed in. Verify: unit tests with the fake engine cover success, a failed exit, a closed terminal, sign out, the config file swap, and the refusal.
- [x] 9.5 Renderer: Sign-in lists the token options and, when declared, the device sign-in with an inline terminal, its status, and Sign out. A new bot shows Not signed in. Remove the host-login option, confirmation, unsafe and stale-mask notices. Chat shows the not-signed-in refusal with a link to Sign-in. Verify: `npm run test:bots-ui` covers the not-signed-in state, the device sign-in success and abandon paths, sign out, and the absence of any host-login option.
- [x] 9.6 Tests: remove the host-login unit, protocol, UI and E2E tests and fixtures. Add a fake `codex` device sign-in to the fake engine. Verify: the bot server, client, extension and UI suites pass, and `npm run test:e2e -- e2e/bots.spec.ts` passes.


Non-UI verification, 2026-11-01: tasks 9.1, 9.3 and 9.4 pass their required
unit/protocol checks. The existing API 3.5.0 bump is verified. Tasks 4.5, 9.2 and
9.6 remain unchecked: the renderer/UI/E2E work is assigned separately, and the
pinned-adapter container checks cannot connect to the engine in this sandbox.
The non-UI implementation and obsolete credential tests are updated. The
sign-in PTY still enters the root-only `terminay-run` supervisor, which launches
the declared command as `bot` in `/home/bot` with `HOME=/home/bot`.
