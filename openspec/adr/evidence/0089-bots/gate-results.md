# add-terminay-bots — feasibility gate results

Evidence for task group 0 of `openspec/changes/add-terminay-bots`, behind ADR-0089 and ADR-0090.
Every run used throwaway agent homes and fake credentials, except model calls. Model calls went
through OpenRouter with `openai/gpt-6-luna` and `anthropic/claude-haiku-5.5` only. The key was
passed by name (`exec -e NAME`) and appears in no file here.

Scripts are in `spike/`; raw results are in the `*.json` files beside this one.

## Environment

| | Podman machine (macOS) | Docker on Linux |
|---|---|---|
| Engine | Podman 6.1.4 client, rootful machine (libkrun), cgroup v2 | Docker 29.9.2 rootful, `docker:dind` under Podman, cgroup v2, overlayfs |
| Host file sharing | virtiofs (`/Users`, `/private`, `/var/folders`) | same kernel (bind mounts) |
| Image | `node:26.13.0-trixie-slim`, Chromium 156, TigerVNC, openbox | same Dockerfile |
| Adapters | codex-acp 2.5.0 (`@openai/codex` 0.165.0), claude-agent-acp 0.99.1 (claude-agent-sdk 0.3.312, Claude Code 2.1.312) | same |
| Host Codex CLI | 0.166.0 | — |

## Results by gate item

Status key: **pass**; **pass with change** (passes once the named change to the design is made);
**fail**, which needs an owner decision; **owner check**, which needs a real account.

### 1. Shared host login, Codex — pass with change on Linux; fail (locking only) on macOS

`hostlogin-codex-podman-macos.json`, `spike/host_codex_write.py`, `spike/spike_lock.py`

- The bot reads the host's login through `~/.codex/auth.json → /run/terminay/host-auth/codex/auth.json`.
  A host re-login, a host logout, and a host login after a logout all reach running bots without a
  recreate. On macOS the view lags by up to 2.7 s (virtiofs cache).
- A bot's sign-in writes through the link into the host file. The link stays a link, the host file
  stays a single-link regular file, and the other bot sees the change.
- 45 concurrent sign-ins (15 from the host CLI, 15 from each of two bots) leave valid JSON that all
  three agree on, with no stray files.
- A bot's `codex logout` removes only its own link. The host stays signed in.
- **Corrections to the design:**
  - Codex writes `auth.json` **in place** (same inode, `O_TRUNC`). It does not write a temporary
    file and rename it. The only sidecar is **`auth.lock`**, not `auth.json.lock`, and there is no
    `.auth-*` temporary file.
  - Host Codex also creates `log/` and `tmp/` in `CODEX_HOME` on first use. A host entry created
    after a bot starts is **not masked** in that bot until it restarts, so the directory watch must
    treat any new entry from the host as "restart the bots that use it", not only as tampering.
  - Podman's tmpfs masks **copy the hidden directory's contents into the mask** by default
    (`tmpcopyup`). The design must pass `notmpcopyup`, or the mask leaks host sessions. Docker's
    tmpfs does not copy up.
- **Fail on macOS: locks do not cross the host ↔ VM boundary.** Neither `flock` nor `fcntl` held on
  the Mac excludes a lock in a container, or the other way round. Two containers on the same
  machine do exclude each other. So the host CLI and bots can refresh at the same moment. With a
  rotating refresh token, the loser is signed out. The window is the refresh itself, which happens
  every few days, but it is real. On Linux, host and containers share a kernel; see item 8.
- **Owner check:** a real ChatGPT OAuth refresh, first by a bot and then by the host.

### 2. Shared host login, Claude Code on Linux — pass with change

`spike/claude_cred_link.sh`, `spike/claude_securestorage.sh`

- Claude Code reads `.credentials.json` through a symlink, and `auth logout` removes only the link.
- **But a symlink cannot work for writes.** Claude Code saves credentials by writing
  `.credentials.json.tmp.<8 hex>` in the same directory and renaming it over the path. A token
  refresh in a bot would replace the link with the bot's own file and rotate the host's refresh
  token away, which signs the host out.
- **What works:** `CLAUDE_SECURESTORAGE_CONFIG_DIR` moves only the credential file, and its refresh
  lock, to another directory, while the config, sessions and skills stay in the bot's `~/.claude`.
  Pointing it at the masked host mount `/run/terminay/host-auth/claude` puts the temp file, the
  rename and the lock in the host's directory, with no link. It was verified with fake credentials:
  the CLI reads it, reports signed in, and logout removes it there.
- Declared sidecars for Claude Code, read from the pinned Claude Code 2.1.312 binary: the pattern
  `.credentials.json.tmp.*` and the names `.oauth_refresh.lock` (a lock directory, created with
  `mkdir`), `.oauth_refresh.lock.owner`, `.cloud_sessions_oauth_refresh.lock` and
  `.design_oauth_refresh.lock`. The refresh code also takes a second, older lock at
  `<directory>.lock`, next to the directory rather than inside it. That lock is per container,
  so the parent of the mount must be writable by the agent; the shared lock inside the directory
  is what keeps bots apart. The `.gcp_auth_refresh-*` and `.aws_auth_refresh-*` locks belong to
  cloud-provider settings that bots do not use, so they are not declared.
- Risk: `CLAUDE_SECURESTORAGE_CONFIG_DIR` is undocumented. The adapter is pinned, and the
  built-in agents' conformance test must check it on every upgrade.
- **Owner check:** a real Claude OAuth refresh on a Linux host, with the host CLI running.

### 3. Tokens — pass with change

`spike/spike_tokens.py`, `spike/spike_codex_apikey.py`, `spike/spike_claude_env.py`

- Claude Code with `ANTHROPIC_API_KEY` starts signed in. The key appears in no host process
  argument, engine VM process argument, container inspection, exec inspection, or container
  process argument.
- Codex with `CODEX_API_KEY` is **not** signed in from the environment alone. The host must call
  ACP `authenticate {methodId: "api-key"}`, and by default Codex then **writes the key to
  `~/.codex/auth.json`**.
- Codex also writes its tool shell's environment, key included, into `~/.codex/shell_snapshots/`.
- With `cli_auth_credentials_store = "ephemeral"` and
  `[shell_environment_policy] exclude = ["CODEX_API_KEY", "OPENAI_API_KEY"]` in the bot's own Codex
  config, no key reaches the bot's disk, and tool shells see no key variable.
- Claude Code writes no key to the bot's disk, but its Bash tool inherits `ANTHROPIC_API_KEY`
  (found by the group 3 conformance test). Fix, verified on Docker 29.9.2 and Podman 6.1.4:
  `CLAUDE_CODE_SHELL_PREFIX=/usr/local/bin/terminay-tool-shell`. Claude Code runs each tool
  command as `'<prefix>' '<command>'`; the script unsets the variables named in
  `TERMINAY_CREDENTIAL_VARIABLES` and runs the command with `bash -c`. After that the tool shell
  sees no credential variable. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` was not used: it needs
  bubblewrap, which cannot nest in Podman, and it forces the default permission mode.
- **Stated limit:** tools run as the same user as the agent, so a tool can read the agent's
  environment through `/proc/<agent pid>/environ`. This was verified. A token is therefore
  available to anything the agent runs. That is inherent to giving an agent a credential, and
  the Sign-in setting must say so.
- **Owner check:** `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.

### 4. ACP behaviour — pass with change

`acp-podman-macos.json`, `spike/spike_badcred.py`

- Both adapters initialise with no client file-system or terminal capability, and run their own
  shell tools inside the container as `bot`.
- Both expose models through `session/new` → `configOptions` with `category: "model"`. Claude
  lists aliases (`default`, `opus`, `fable`, `sonnet`, `haiku`); Codex lists model ids.
- `session/load` after an agent restart restores the conversation for both.
- Claude Code sends `session/request_permission` (`allow_once`, `allow_always`, `reject_once`).
- **Codex cannot use its own sandbox in the container.** bubblewrap fails with
  `Can't mount devpts`. Only `agent-full-access` mode works, and that mode never asks permission,
  because Codex ties sandbox and approval together and has no "no sandbox, but ask" mode. So
  **Ask me** is not available for Codex bots. They are Autonomous, with the container as the
  boundary.
- A failed sign-in surfaces as ACP `Authentication required`. Codex reports it at once. Claude
  Code retries for **175 s** first. With `CLAUDE_CODE_MAX_RETRIES=0` it reports in 0.5 s. Both
  recover on the next session once a valid credential is given.
- Codex's provider must be in the bot's own `~/.codex/config.toml`. The adapter's `CODEX_CONFIG`
  applies only per session, after the sign-in check.

### 5. Cancellation — pass with change

`acp-podman-macos.json` (`cancel`, `kill`), `process_ownership`

- Both adapters acknowledge `session/cancel` at once with `stopReason: cancelled`.
- **Both leave the cancelled tool's process running.** A `sleep 300` was still alive after the
  cancel, for both agents. So "the turn ended within 10 s, keep the agent" leaves orphaned tool
  work behind.
- `terminay-run --kill` ends the whole session group. No agent or tool process remains, and the
  record is retired.
- A stale record whose group number was reused by unrelated work leaves that work alone. The
  start time did not match and the nonce was absent. `bot` cannot read session records or the VNC
  password.

### 6. Files helper — pass

`files-helper-podman-macos.json`

- The helper refuses reads, lists and writes through a directory link, through a file link, and
  through a link inside the home. It refuses writing over a link, and it never touched
  `/etc/passwd`.
- 3000 reads raced against an atomic swap (`renameat2 RENAME_EXCHANGE`) between a real directory
  and a link to `/etc`: 1355 safe reads, 1645 refused, 0 leaks.
- Protected paths and their parents cannot be read, deleted or renamed. Uploads are owned by `bot`.
- Limits hold: no network, read-only root, all capabilities dropped, 256 MiB, 64 pids, 0.5 CPU,
  user `bot`.

### 7. Desktop — pass with change (container side); relay in group 4

`spike/spike_desktop.py`, `spike/spike_exec_tunnel.py`

- With no bootstrap, Xvnc never starts and the container exits with code 78 after 30 s.
- Once bootstrapped, Xvnc offers only VNC authentication (security type 2). The password is
  readable by root only.
- Another bot on its own network cannot reach the bot's container address.
- **But another bot can reach the published desktop port through `host.containers.internal`.**
  Only the VNC password protects it.
- **What works:** publish no port at all. Xvnc listens on the container's loopback only, and the
  server reaches it through an `exec -i` stdio tunnel. The RFB handshake took 0.12 s.
- noVNC, view-only, and the RFB allowlist are server-side and are verified in task group 4.

### 8. Engines — pass for what exists; driver checks in group 4

`acp-docker-linux.json`, `hostlogin-codex-docker-linux.json`, `files-helper-docker-linux.json`

- The image builds and runs a bot end to end on both engines. On each engine the spikes passed:
  ACP, tokens, cancellation and kill, the Files helper, and the desktop.
- **Linux Docker, Codex host login:** every check in item 1 passes, with 0 s visibility lag.
  `flock` and `fcntl` both **exclude across the host and containers**, both ways. So on Linux one
  lock serializes the host CLI and bots, and item 1's locking failure is macOS-only.
- **Codex's own sandbox works on Docker.** Codex wrote `spike-ok` in its default sandboxed mode.
  It fails on Podman. **Ask me** for Codex could therefore be possible on Docker, but that was not
  tested further.
- On Docker, a desktop port published on loopback is **not** reachable from another bot. On the
  Podman machine it is (item 7).
- Podman's `docker` shim prints `docker version 6.1.4`; real Docker prints
  `Docker version 29.9.2, build …`.
- Rootless Podman on the machine enforces memory, pids, and CPU limits (cgroup v2, with `cpu io
  memory pids` delegated).
- Engine detection, pinning, refusing remote connections and rootless Docker, and adoption are
  driver logic. They are tested when the driver is built (task group 4).

### Not yet verified (need Terminay code, not feasibility)

- the host-auth directory watch and its alarm (D6);
- pre-mount validation refusing a symlinked `~/.codex` or a hard-linked `auth.json`;
- the RFB relay, noVNC, view-only mode, and the message allowlist (D10);
- engine detection and pinning (D2).

## Proposed design changes for the owner

1. **Codex host login on macOS.** Accept the narrow refresh race between the Mac's CLI and bots,
   or offer Codex host login only on Linux and use a token on macOS.
2. **Codex is Autonomous only** (at least on Podman). Remove **Ask me** for Codex bots, because
   its sandbox cannot nest in a Podman container. On Docker it does work, so allowing it there is
   possible but untested.
3. **Stop always ends the session's processes.** After the cancel is acknowledged, or after
   10 s, end the session group, and reload the session with `session/load` for the next message.
   Do not keep the agent alive with orphaned tools.
4. **Claude host login without a link.** Use `CLAUDE_SECURESTORAGE_CONFIG_DIR` pointed at the
   masked host mount, and declare the credential directory, not a link.
5. **Desktop through an exec tunnel.** Publish no ports.
6. **Mask and watch details.** Mask with `notmpcopyup` on Podman. Codex's sidecar is `auth.lock`.
   A new host entry restarts the affected bots.
7. **Agent launch settings.** Codex: `cli_auth_credentials_store = "ephemeral"` plus the
   shell-environment exclude, and its provider in the bot's config. Claude:
   `CLAUDE_CODE_MAX_RETRIES` kept low, so that a bad credential surfaces quickly.
8. **Say plainly** that an agent and its tools can read the bot's token.
