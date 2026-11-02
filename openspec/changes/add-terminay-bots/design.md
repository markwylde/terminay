## Context

Terminay sees agents in two ways today:

- it observes agents running in terminals (ADR-0025, ADR-0051);
- it runs Pixel's chat through chat providers (ADR-0067).

Both kinds run on the server account.

Bots are a third kind. A bot is a named, long-lived agent with its own container and home, and it keeps working while nobody watches. The UI is settled in the interactive demo at https://claude.ai/artifact/EpeAfUbwuk36dewZXFa8Qt, and this change's specs define the behaviour.

The owner settled these points:

- Bots live in Home and are not mapped to projects.
- Agents and models come only from extensions.
- The bot image is built locally and never hosted.
- A bot can share the engine's socket (Docker's `docker.sock` or Podman's compatible socket) to run sibling containers.
- Both Docker and Podman are supported.
- There is no model proxy.
- Atlas is a source of lessons only.

**Sign-in, in the owner's words.** Every bot signs in with its own credential: a Claude `setup-token` sign-in token, a Codex device sign-in, or an Anthropic or OpenAI API key. There is no detection of the host's logins and nothing is shared with the host. An earlier revision shared the host's own auth file; the owner removed it after trying it (ADR-0091).

**Review history.** Two independent reviews with Codex shaped this revision:

- The first found unproven assumptions, which led to the feasibility gate in D0.
- The second rejected moving the host's `auth.json` behind a symlink. A bot could plant a symlink and redirect where the host writes, and `codex logout` deletes the link rather than the file.

**Dependencies.** This change depends on `add-agent-chat-and-pixel` and `unified-settings-window` being archived first.

## Goals / Non-Goals

**Goals:**

- Home › Bots: a dashboard, one tab per bot, Chat and Configure modes, and the five configure tabs.
- One image, built locally.
- For each bot: one container, one home volume, one network, and its own resource limits.
- Each bot signs in with its own credential: a token or API key kept in the vault, or a device sign-in saved in its own home.
- Lifecycles that stay correct across Stop, idle chats, timeouts, and server restarts.
- Files, Shell and Desktop for remote clients, gated by Terminay authority.
- Any extension can contribute a bot agent by naming an ACP adapter and declaring its sign-in.
- Schedule and event triggers on a scheduler shared with automations.

**Non-Goals:**

- Windows servers, rootless Docker, remote engines, Kubernetes, and VMs other than the local Podman machine.
- Reading, detecting, or sharing any login of the server account.
- Hiding a bot's own credentials from the bot.
- Bots having the Terminay MCP server, a model proxy, or usage accounting.
- Changing Pixel or chat providers.
- More than one active turn per bot at a time (D9).

## Decisions

### D0. Feasibility gate before the main work

Fake engines and fake agents cannot settle the risky assumptions, so group 0 of the tasks is a spike on real engines with the real pinned adapters. It records its evidence in `openspec/adr/evidence/0089-bots/`.

**Test accounts only.** Credential spikes use dedicated test accounts and throwaway agent homes, never the user's own login.

The gate must prove each of the following:

1. **Shared host login (withdrawn).** Items 1 and 2 tested sharing the host's own Codex and Claude Code login files. They ran and are recorded in the evidence, but the owner then removed host login entirely (ADR-0091), so nothing below depends on them.
2. *(Folded into item 1.)*
3. **Tokens (D6).** Each of these starts its adapter signed in:
   - Claude Code with `CLAUDE_CODE_OAUTH_TOKEN`;
   - Claude Code with `ANTHROPIC_API_KEY`;
   - Codex with `CODEX_API_KEY`.

   In each case the value is passed with `docker exec -e NAME`, and appears in no process arguments, in neither container nor exec inspection, and in no CLI error.
4. **ACP behaviour for each adapter (D5).**
   - Models can be selected through ACP session configuration.
   - Tools run with no client file system or terminal capabilities.
   - Permission requests arrive.
   - `session/load` works after the agent process restarts.
   - A failed sign-in is reported, and the agent recovers once a valid credential is supplied.
5. **Cancellation (D8).** For each adapter, the gate records:
   - how long acknowledging a cancel takes;
   - what keeps running after the cancel;
   - that ending the recorded process group leaves no process from that session.
6. **The helper (D7).** The confined operations refuse escapes through symbolic links, including links swapped in during a race. Ownership is `bot`, and the resource limits hold.
7. **The desktop (D10).** The VNC bootstrap fails closed, the relay works with noVNC, view-only mode drops input, malformed and fragmented RFB traffic is rejected, and other bots cannot reach the desktop port.
8. **Engines (D2).** Podman machine on macOS and rootful Docker on Linux are both detected, pinned, and run a bot end to end. The Linux Docker engine may be a privileged `docker:dind` container under Podman. Podman's `docker` shim is recognised. A remote SSH connection and rootless Docker are refused. A context or connection switch does not move the bots to another engine. Rootless Podman's limit support is recorded.

**Gate outcomes.** Every item either passes, or the owner chooses one of the fallbacks this design names:

- **Item 6 fails:** Files works only while the bot runs.
- **Item 7 fails:** there is no Desktop.
- **No viable fallback:** "Gate failed, feature blocked" is a valid outcome, and no later group starts.

**Gate result (owner-approved).** The full record is in `openspec/adr/evidence/0089-bots/gate-results.md`. The owner approved the evidence and these design changes, which the decisions below already include:

- Host login was later removed by the owner (ADR-0091); the host-login results stand only as history.
- Codex bots are Autonomous only, because Codex's own sandbox cannot run inside a Podman container (D5).
- Stop always ends the session's process group, because both adapters leave a cancelled tool running, and the next message reloads the session (D8).
- The desktop is reached through an `exec` stream, with no published port (D10).
- The changes to agent launch settings are folded into D5–D6.

The gate checks that need Terminay's own code move to the groups that build that code: the RFB relay, noVNC, view-only, and the allowlist (group 4), and engine detection, pinning, and adoption (group 4).

### D1. Bots are a server service, and the renderer only presents

The bot store, Docker driver, ACP client, session store, shell bridge and RFB relay live in `packages/server-core/src/botService/`. Bot triggers use the shared schedule engine (D11). Clients reach bots only through new operations in `packages/protocol` and `packages/client-core`, and the renderer uses the preload API alone.

**Boundaries crossed.**

- The Electron privilege boundary: Docker, the file system, secrets and PTYs stay in the server.
- Client authority (D12).

### D2. A container-engine driver for Docker and Podman, pinned to a local engine

`botService/engine.ts` defines one driver interface. It has two implementations:

- `DockerDriver`, which runs `docker`;
- `PodmanDriver`, which runs `podman`.

Both run their CLI directly, never through a shell, with arguments passed as an array, and parse JSON output. The interface covers:

- image builds;
- containers, volumes, and networks;
- `exec`, with or without a TTY;
- `events`;
- inspection;
- one-shot stats.

The two CLIs are almost identical for everything bots use. These are the differences the drivers absorb:

| Concern | Docker | Podman |
|---|---|---|
| Address the engine | `--host unix://…` | `--connection <name>` for a Podman machine or a named connection; `--url unix://<socket>` for native Linux Podman with no named connection (rootful `/run/podman/podman.sock`, rootless `$XDG_RUNTIME_DIR/podman/podman.sock`) |
| Engine identity | `docker info` → `ID` | connection + `podman info` host id (machine name for a Podman machine) |
| Bot uid ↔ host uid | build arg uid/gid (Linux) | rootless: `--userns=keep-id:uid=<bot>,gid=<bot>`; rootful: build arg |
| Socket to share | daemon-side `/var/run/docker.sock` | rootful `/run/podman/podman.sock`; rootless `$XDG_RUNTIME_DIR/podman/podman.sock` (as seen by the engine) |
| Host gateway | `--add-host host.docker.internal:host-gateway` | the same flag, plus the built-in `host.containers.internal` |
| Limits | always | rootful always; rootless needs cgroup v2 delegation, otherwise reported as not enforced |

**Detection.**

- `docker --version` is checked for Podman's shim, and a shim counts as Podman.
- A Podman connection over SSH counts as local only if it belongs to a machine that `podman machine list` reports on this computer. On macOS, that machine's mounts and forwarded loopback ports resolve host paths on this computer, and D0 checks this.
- Rootless Docker, any other remote connection, and Windows are refused, each with its reason.
- When both engines are available, the user picks one.

**Pinning.** The server records the engine kind, the endpoint or connection, and the identity, and addresses that engine explicitly on every call. A different identity marks the engine as changed. **Use this engine** behaves as the spec describes.

**Adoption.** Every resource carries `terminay.server=<server id>`, and adoption requires both the server id and the bot id to match.

**Why use each engine's own CLI.** The Docker-compatible API was the alternative. It was rejected for two reasons: Podman's compatibility layer differs in event and exec details, and its build path would need a BuildKit or Buildah client of its own.

**Boundary crossed.** Server to engine. Bot ids are `[a-z0-9]{12}`, generated by the server.

### D3. One image, `terminay-bot:local`

The image is built from `docker/terminay-bot/Dockerfile` on Debian slim. It contains:

- TigerVNC and a light desktop;
- Chromium;
- git, curl, ripgrep, jq, Node LTS and Python;
- `inotify-tools`;
- the Docker CLI, wrapped so that every container it creates is labelled `terminay.bot=$TERMINAY_BOT_ID`;
- `terminay-init`, `terminay-run` and `terminay-files`;
- a `bot` user, whose uid and gid on Linux are the server account's, passed as build arguments.

**Agents layer.** The server generates the last layer from validated manifests. It runs `npm install -g` on each agent's pinned adapter, and `apt-get install` on any Debian names.

**Fingerprint.** The label `terminay.fingerprint` hashes the image's inputs.

- A stopped bot whose container is out of date is recreated when it starts.
- A running one shows **Recreate to update**.
- A failed build keeps the previous image.

### D4. One container, volume and network per bot

The container `terminay-bot-<id>` is created with:

- the labels `terminay.bot`, `terminay.server`, `terminay.managed=1` and the fingerprint;
- the volume `terminay-bot-<id>-home` mounted at `/home/bot`;
- the network `terminay-bot-<id>`;
- `host-gateway` on Linux;
- no published ports: the desktop is reached through an `exec` stream (D10). On the Podman machine, a port published on loopback could be reached by other bots through `host.containers.internal`;
- `--cpus`, `--memory` and `--pids-limit`, which default to 2 CPUs, 4 GiB and 1024;
- the entrypoint `terminay-init` (D10);
- the engine's API socket, as the engine sees it, mounted at `/var/run/docker.sock` with `--group-add <socket gid>`, when Share engine socket is on (D2).

**When resources are created.** Creating a bot touches no Docker resource. The volume, network and container are created when the bot first starts. When the image exists, the volume is also created when Files or Memories first opens. When it does not exist, those tabs offer to build it.

**Deleting and recreating.** Both close the bot's helper first, then remove the container and network, then the volume if the user chose to delete it.

**Boundary crossed.** Host to container. The only host path that ever enters a container is the engine socket, and only if the user turns that on.

### D5. The host is the ACP client, and the extension only describes the agent

ADR-0067's objections to ACP adapters were that Terminay would have to bundle them, and that one includes Claude Code. Neither applies to a locally built image, where each adapter brings its own runtime:

- `@agentclientprotocol/codex-acp` brings a compatible Codex;
- `@agentclientprotocol/claude-agent-acp` uses the Claude Agent SDK.

**Running the agent.** The host runs the agent with:

```
docker --host <endpoint> exec -i -u root \
  -e TERMINAY_SESSION=<sid> [-e NAME ...] terminay-bot-<id> \
  terminay-run <sid> -- <acp command> [launch args]
```

and speaks ACP over stdio. `terminay-run` drops to the `bot` user before it runs the command (D8).

**Client capabilities.** The host advertises no `fs` or `terminal` client capabilities.

**Models.**

- When the agent offers a model option in its session configuration, the host sets the model through that option.
- Otherwise it uses the environment returned by `launch`.
- `models()` fills the picker.

**Continue** uses `session/load`.

**Sign-in calls.** A credential secret may declare that the agent needs ACP `authenticate` before it uses the secret. Codex's API key needs `authenticate {methodId: "api-key"}`; from the environment alone it reports `Authentication required`. The host makes that call after `initialize`.

**Approvals.** Codex's own sandbox, bubblewrap, cannot run inside a Podman container (`Can't mount devpts`). It does run on Docker. Codex ties sandbox and approval together: its only mode without its sandbox is `agent-full-access`, which never asks permission. So Codex declares itself **Autonomous only**, and the host sets that mode. Claude Code asks permission normally.

**Agent settings per bot.** Each agent may declare bot config files and a launch environment (D6). Codex keeps its model provider and the settings D6 needs in the bot's own `~/.codex/config.toml`, because the adapter's `CODEX_CONFIG` applies only per session, after its sign-in check.

**Instructions.** The instructions (at most 32 KiB) and the pinned memories (newest first, at most 16 KiB in total) are sent as a context block in each session's first prompt. Terminay writes no agent instruction files.

**Boundary crossed.** Host to agent. This is an owner-approved exception, recorded in ADR-0089.

### D6. Sign-in: each bot's own token, API key, or device sign-in

Each bot has a **Sign-in** setting, offering what its agent declares. A new bot is **Not signed in**. Until the user chooses, a message or a trigger firing is refused with `unavailable`, naming Configure › Profile › Sign-in, before any session or container work starts. Terminay never reads, detects, mounts, or copies a login of the server account, and there is no confirmation step beyond the choice itself.

Sessions record the sign-in they started with. A session that used a different sign-in from the bot's current one cannot be continued, and Continue gives that reason.

**Device sign-in.** An agent may declare a device sign-in: a sign-in command, a sign-out command, a label, and optionally its own bot config files. Codex declares **Sign in with ChatGPT**, `codex login --device-auth` and `codex logout`.

- Choosing it starts the bot's container if needed, writes the device sign-in's config files over the agent's files of the same path, and runs the sign-in command with `docker exec -it -u bot -w /home/bot -e HOME=/home/bot` under `terminay-run`, through the same PTY host as the bot Shell. The renderer shows that terminal inline in the Sign-in section.
- The command prints a URL and a one-time code. The user approves it in their own browser. The CLI saves the login in the bot's own home, for Codex `~/.codex/auth.json`, which persists with the home volume.
- When the command exits with status 0, the server sets the bot's sign-in to `{ kind: 'device' }`. Any other exit, or closing the terminal, leaves the sign-in unchanged.
- While the sign-in is `device`, the host writes the device config files before each session. For Codex that file sets `cli_auth_credentials_store = "file"`, so codex-acp reads the saved login. Bots on an API key keep the agent's default config with `"ephemeral"`, so a key never reaches the disk.
- Sign out runs the sign-out command the same way, then sets the bot to Not signed in.
- Terminay never reads, copies, or displays the saved login, and never passes it to another bot. Deleting the bot with its home removes it.

**Tokens.** These are offered when the agent declares credential secrets, for example:

- Claude Code: a sign-in token from `claude setup-token`, `CLAUDE_CODE_OAUTH_TOKEN`, or an API key, `ANTHROPIC_API_KEY`;
- Codex: an API key, `CODEX_API_KEY`.

**Storing and passing a token.**

- The user enters the token in the bot's Profile.
- It is kept in the vault (ADR-0003), keyed to that bot.
- At exec time it is read with `withSecret` and placed only in the environment of the `docker` client process. That client is passed `-e NAME`, never the value.
- Terminay never puts it in arguments, container configuration, the image, the volume, logs, or diagnostics. Copying a token to another bot is an explicit action.
- **Keeping the agent from writing it.** The gate found that Codex, by default, writes an API key to `~/.codex/auth.json` after ACP `authenticate {api-key}`. It also writes its tool shell's environment, key included, into `~/.codex/shell_snapshots/`. Codex's bot config file therefore sets `cli_auth_credentials_store = "ephemeral"` and `[shell_environment_policy] exclude = ["CODEX_API_KEY", "OPENAI_API_KEY"]`. The host writes that file into the bot's home and restores it before each session. With it, no key reached the disk and tool shells saw none. Claude Code wrote no key to disk, but its Bash tool inherited the key. Claude Code wraps every tool command in `CLAUDE_CODE_SHELL_PREFIX` as `'<prefix>' '<command>'`, so its launch environment points that at the image's `terminay-tool-shell`. That script unsets each variable named in `TERMINAY_CREDENTIAL_VARIABLES`, which Terminay sets to the agent's declared credential variable names, then runs the command with `bash -c`. The conformance test checks this on Docker and Podman. (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` was rejected: it needs bubblewrap, which cannot nest in Podman, and forces the default permission mode.)
- **What cannot be prevented.** Tools run as the same user as the agent, so a tool can read `/proc/<agent>/environ` (verified). A token is available to anything the agent runs. Profile and Settings say so.
- **Failing fast.** Claude Code retries a rejected credential for about 3 minutes. Its launch environment sets `CLAUDE_CODE_MAX_RETRIES` low, so the failure surfaces in seconds.

**Redaction.** Token values are redacted from every stream. Each stream keeps a carry-over window one byte shorter than the longest secret, so a value split across chunks is still caught.

Values are held in server memory only while a session that uses them, or a log view of that bot, is open.

Container log redaction covers that bot's current token values only. Settings says the following are not covered:

- a token that has since been rotated;
- a login that a device sign-in saved in the bot's home;
- any credential the agent itself transforms or writes into its home.

### D7. Files and memories go through one confined helper per bot

The helper is `terminay-files`, a small Python program in the image. It runs in a container created with:

```
docker run --rm -i --network none --read-only --cap-drop ALL \
  --cpus 0.5 --memory 256m --pids-limit 64 -u <bot uid> \
  --label terminay.helper=<id> --label terminay.server=<server id> \
  --entrypoint terminay-files \
  -v terminay-bot-<id>-home:/home/bot terminay-bot:local
```

**First use of a volume.** The image's `/home/bot` is owned by `bot`. When a new named volume is first mounted, Docker copies that directory's contents and ownership into it, so the volume's root is owned by `bot` even when Files opens before the bot has ever started. D0 item 6 verifies this.

**Lifetime.** There is one helper per bot, shared by all of that bot's open views through a reference count. It stops 5 minutes after the last view closes, using a one-shot timer. Helpers are removed during reconciliation at startup.

**Protocol.** JSON lines, with these limits:

- chunks of at most 1 MiB;
- a credit-based flow, which gives backpressure;
- each request can be cancelled;
- each upload is at most 1 GiB and written to a temporary file that is then renamed;
- a listing returns at most 10,000 entries.

**Confinement.** Every path is walked one component at a time, with `openat` and `O_NOFOLLOW` from a descriptor for `/home/bot`. On Linux 5.6 and later, `openat2(RESOLVE_BENEATH)` is used.

- Symbolic links are listed but never followed.
- The declared auth paths and their ancestors cannot be opened, renamed or deleted, and neither can `.codex` or `.claude` themselves.
- The helper mounts nothing but the volume.

**Live updates.** `inotifywait` watches `memories/` and the open folder.

**Fallback.** If D0 item 6 fails, Files works only while the bot runs, through `docker exec`.

### D8. Process ownership and Stop

`terminay-run` starts as root and does three things:

1. It creates a new session and process group, and becomes the leader of that group.
2. It records, in `/run/terminay/sessions/<sid>`, the group id, its own start time, and a random 128-bit session nonce. That directory is owned by root with mode 0700, so the bot cannot read or change the record.
3. It forks the agent. The agent runs as the `bot` user, with the nonce in its environment.

`terminay-run` does not `exec` the agent. It stays alive as the root supervisor and group leader for the whole session, and the `bot` user cannot signal it. When the agent exits, `terminay-run` ends the rest of its group, deletes (retires) the record, and then exits. A record therefore exists only while its group is owned.

`terminay-run --kill <sid>` decides what to signal as follows:

- **Leader alive.** If the recorded leader is alive and its start time matches the record, it signals the group.
- **Leader gone.** The leader can only be gone if the supervisor itself died. In that case, `--kill` never trusts the group number. It scans `/proc` and signals only those processes that are in the recorded group **and** carry the session's nonce in their environment. A reused group number therefore cannot hit unrelated work.

In both cases, once no matching process remains, the record is retired. `--kill-all` applies the same rules to every record, and retires the stale ones.

**Outcomes.**

- **Stop the turn.** The host sends `session/cancel`, then ends the group once the agent acknowledges it, or after 10 seconds if it does not. It sends SIGTERM, and then SIGKILL 5 seconds later. The turn is marked **stopped**, the agent process is closed, and the session stays open. The next message resumes it with `session/load`, as for a suspended session (D9). The gate showed why the agent is never kept: both adapters acknowledge a cancel at once, but leave the cancelled tool's process running.
- **Close the agent.** This happens when the session ends, is suspended (D9), times out, or its bot stops. The host closes stdin, waits 5 seconds, then runs `--kill`. Only when the group is confirmed gone are the token values released and the activity count decremented.
- **Detached work.** A process that moved to its own session or process group, for example through `setsid` or by daemonising, survives `--kill`. The session view says so. Stopping the bot ends it.

**Server restart.** `docker exec` clients die with the server. At startup, for each running bot, the server:

- runs `terminay-run --kill-all`, which applies the same rule to every recorded group;
- marks every running, suspended or needs-you session as **interrupted**;
- cancels any pending approvals;
- marks queued messages as **not sent**;
- records pending trigger firings as skipped because the server restarted;
- arms the idle timers.

### D9. Bots are used one turn at a time, with each conversation separate from its turns

A **turn lease** is what lets a session run on a bot. At most one session holds the lease at any time. A session holds it while one of its turns runs or waits on a permission decision, and gives it back when the turn ends.

Between turns, a chat session keeps its agent process alive only while nothing else is waiting for the bot. When other work is queued, the chat session is **suspended** before that work starts: its agent process is closed (D8), and the session stays open.

When the next message arrives for a suspended session, the agent is resumed with `session/load`. If the agent cannot load sessions, the old session ends and the message starts a new session. The chat explains this.

**Queues.** Work waiting for a bot is queued with these limits:

- one queued message per session;
- one pending firing per trigger;
- at most 20 queued items per bot. Beyond that, new work is refused as busy, and a trigger firing is recorded as skipped.

**Queue order.** When only one kind of work waits, it runs in order: chat messages by arrival, trigger firings by fire time. When both kinds wait, they alternate: one chat turn, then the oldest trigger firing, then one chat turn, and so on. Neither kind can starve the other.

The user can cancel queued items. Disabling or deleting a trigger removes its pending firing.

**Arbitration.** The server decides every conflict:

- the first answer to a permission request wins;
- each session's inputs are snapshotted when the session starts.

**Alternative rejected.** Letting turns run concurrently in one home, because two agents would tread on each other's files, desktop and browser.

### D10. The desktop is bootstrapped closed and relayed by the server

**Starting the container.** The container's entrypoint is `terminay-init`, which runs as root. Before it starts anything else, it waits up to 30 seconds for bootstrap material on a root-only FIFO. If none arrives, the container exits, so it fails closed.

After `docker start`, the server runs `docker exec -i -u root <c> terminay-init --bootstrap` and writes a JSON document to its stdin. The document contains:

- the bot id;
- the VNC password from the vault;
- the auth links to create.

`terminay-init` then does the following:

1. writes the password into `/run/terminay/vnc/passwd`, mode 0600, owned by root;
2. starts Xvnc as root, with `-rfbauth` pointing at that file and listening on the container's loopback only (`-localhost`), and the desktop session as `bot`;
3. creates the auth links, for agents that declare a bot path;
4. reports ready.

**Who knows the password.** The bot can still control its own desktop, but it cannot read the password. Anyone who is root in the container, which includes a bot that shares the engine socket, can read it. The password protects against other containers and other host users. It does not protect against the bot itself.

**The relay.** No port is published. The server runs `docker exec -i -u root <c> terminay-init --tunnel 5901`, a stdio-to-loopback pipe, and speaks RFB over its streams; the gate measured 0.03–0.12 s to the server banner. Over that pipe it completes VNC authentication. It then serves RFB 3.8, with security type None, to the client, over a protocol stream channel. That stream is bound to:

- the authorized client connection;
- the bot;
- the mode;
- a stream generation number.

Changing the mode opens a new stream with a new generation, and frames from a stale generation are dropped.

**Relay parsing.** The relay parses the messages the client sends:

- **Allowed:** `SetPixelFormat`; `SetEncodings`, with at most 64 encodings; and `FramebufferUpdateRequest`.
- **Control mode adds:** `KeyEvent`, `PointerEvent`, and `ClientCutText` of at most 1 MiB.
- **Closes the stream:** any unknown type, any over-length field, or more than 4 MiB of buffered input.

Fragmented messages are reassembled within that 4 MiB bound. Backpressure is applied in both directions. View-only mode drops the three input types.

**Other properties.**

- The bot's private network keeps other containers away from its desktop port.
- The thumbnail is a second, view-only stream.
- Streams close immediately when the client loses authority.
- VNC pushes framebuffer updates to the relay, so nothing is polled.

**The shell** is `docker exec -it -u bot …` running under the PTY host.

### D11. A schedule engine shared by automations and bots

`ScheduleEngine` and `EventFanout` are extracted from the automation service, and automations move onto them with no change in behaviour.

Bot schedules work as follows:

- **Cron** works as it does for automations.
- **Every N** has a minimum of 5 minutes. It is anchored to when the trigger was last saved or enabled, and measured in elapsed time.
- **Once** is recorded as missed if the server was off at its time, and is then disabled.

### D12. Authority covers reads, subscriptions and streams

Terminal-create authority is required for every bot operation, read or write, and for every subscription and stream.

- Subscriptions carry only invalidations: a bot id and a revision.
- Callers bound by a capability, such as MCP, a project or a session, are refused.
- When a client loses authority, its bot subscriptions, shells and desktop streams close at once.

### D13. Sessions are stored with ADR-0088's durable replace

Each session has a directory. It holds `session.json`, plus transcript segments named `segment-<n>.json`. Every one of these files is written with ADR-0088's durable-replace primitive, so no Terminay state file is ever appended to in place.

**Recording updates.**

1. Updates gather in memory.
2. They are committed as a new segment at these points:
   - the end of each turn;
   - each permission request;
   - each status change;
   - when 256 buffered updates have built up;
   - 2 seconds after the first update that has not yet been committed. This is a damping deadline set off by an event, which ADR-0028 allows.
3. `session.json` records the committed segment count. It is written after the segment it counts.

**Recovery.**

- A segment that is not counted in `session.json` is renamed aside with a corrupt marker, following ADR-0088.
- A session's transcript always ends at its last committed update. Uncommitted updates from a crash are lost, and the session view says so.

**Limits.**

- 8 MiB of transcript per session.
- 256 KiB of runner output.
- Kept sessions: the newest 200, or every session from the last 30 days, whichever is more.
- At most 50 triggers per bot.

### D14. No polling

| What | How it updates |
|---|---|
| Idle stop | one-shot deadline |
| Helper idle stop | one-shot deadline |
| Container state | `docker events` |
| Docker availability | checked on demand |
| CPU, memory and disk figures | read on demand |

`docker stats` streaming is not used, because it samples.

## Risks / Trade-offs

- **[A bot's agent can read its own credential]** → Tools run as the same user as the agent, so a token, API key, or device login is available to anything that bot runs. Profile says so. Each bot has its own credential, so a bot can never reach another bot's or the server account's login.
- **[Signing in each bot is more work than sharing one login]** → The owner chose this over sharing: it is explicit, has no detection, and needs no confirmation or tamper machinery (ADR-0091).
- **[Adapter churn]** → Adapter versions are pinned, there is one conformance test per pin, and models are set through ACP options.
- **[Sharing the engine socket is root-equivalent with rootful engines on Linux]** → It is off by default, needs a confirmation that says so, and is shown on the bot's card.
- **[A long trigger delays chat]** → The queue is fair, the chat says the bot is busy, Stop is available, and a second bot can take parallel work.
- **[Detached work survives Stop]** → The session view says so, and stopping the bot ends it.
- **[A crash loses up to 2 seconds of uncommitted transcript]** → The session view says so.
- **[The first image build is slow]** → It is offered when the first bot is created, and the agents layer is built last.

## Migration Plan

This change is additive, and the host's login files are never read or modified. It ships in this order:

1. the gate;
2. the schedule engine, with automations unchanged;
3. the extension API;
4. the built-in agents;
5. the bot services;
6. the UI, gated on the bots capability.

**Rollback.** Remove the section and the services. Resources labelled `terminay.managed=1` are left in place, and the operations doc gives the commands to remove them.

## Open Questions

- Which adapter versions to pin, and the gate's findings.
- ADR-0067 still governs chat providers. ADR-0089 records the bots exception. ADR-0091 supersedes ADR-0090: bots no longer share the host's login.
