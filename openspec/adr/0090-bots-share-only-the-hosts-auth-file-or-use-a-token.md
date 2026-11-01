# ADR-0090: Bots share only the host's own auth file, or use a token

Status: accepted
Date: 2026-11-01

## Context

Bots run their agents inside containers (ADR-0089). Users install agent CLIs and sign in to them on their own machine. The owner's requirement is that bots use that same login. They must stay in step with it in the same way that twenty copies of one CLI on one machine do. Only the login is shared: each bot keeps its own sessions, skills, MCP servers and settings.

Copies of one CLI stay in step through three things in the CLI's own directory: the same auth file, the CLI's atomic replacement of that file, and a lock file beside it. Upstream Codex works this way (`codex-rs/login/src/auth/storage_file.rs`, `storage_commit.rs`). It resolves symbolic links before it writes, so its temporary file, its rename and its lock all land in the directory of the real file.

Two earlier designs were rejected:

- **A single-file bind mount.** It goes stale after the first atomic replacement.
- **Moving the host's file behind a symbolic link** into a Terminay directory. A bot could plant a link and so redirect where the host's CLI writes. `codex logout` also deletes the link rather than the file.

Claude Code on macOS keeps its login in the Keychain, which a container cannot reach. Claude Code also accepts a long-lived token from `claude setup-token` as `CLAUDE_CODE_OAUTH_TOKEN`, and both agents accept an API key.

## Decision

1. **Every bot has a Sign-in setting.** Its options are **Host login**, offered when the agent declares an auth file and that file exists on this platform, and one option for each token the agent declares, either a sign-in token or an API key.
2. **Host login shares only the host's own auth file, in place.**
   - The host directory that holds the auth file is bind-mounted read-write at a Terminay path inside the bot.
   - Every other entry present when the container is created is masked with an empty, read-only mask that never copies the hidden contents, except the agent's declared sidecars: its lock and temporary files.
   - The agent reaches the shared file in the way it declares. For a CLI that writes in place (Codex), the auth path in the bot's own agent home is a symbolic link to the shared file. For a CLI that replaces the file by renaming (Claude Code), an environment variable points the CLI's credential directory at the mount (`CLAUDE_SECURESTORAGE_CONFIG_DIR`), because a rename would replace a link.

   The agent's own writing and locking then keep the host and every bot in step. Terminay never moves, links, rewrites, copies or deletes the host's file. Using Host login needs per-bot confirmation that the bot can use, change or corrupt the shared login.
3. **Validation and directory watch.** Before every mount, the server checks the auth path: it must be canonical, inside the user's home, free of symbolic links, and a single-link regular file. While a host-login container exists, a fail-closed file-system watch covers the host directory.

   Any of the following stops every container that uses that host login, marks the affected bots unsafe, and notifies the user:

   - the auth path ceasing to be a single-link regular file;
   - a new top-level entry that is neither a sidecar nor a valid auth file recreated by login;
   - the directory being replaced;
   - a watch error.

   A missing file is a logout, not tampering.
4. **Tokens go to the vault and are injected without arguments.**
   - A token is kept in the server vault (ADR-0003), keyed to its bot.
   - At exec time it is placed only in the environment of the local `docker` client process. That client's arguments name the variable, never the value.
   - The token never enters the container's configuration, the image, the volume, logs or diagnostics. Each agent is launched with the config that keeps it from writing the token to disk or into tool shells (for Codex, an in-memory credential store and a shell-environment exclude).
   - The agent and its tools run as one user, so they can read the token from the agent's process. This is stated where a token is entered.

   This is a recorded exception to the extension platform's rule that environment variables carry metadata only. No extension ever receives a bot's token.
5. **Redaction, with stated limits.** Exact token values are redacted from every stored or sent stream, including values split across chunks. Settings states what this cannot catch: host-login credentials, rotated tokens, and anything the agent transforms or writes itself.
6. **There is no model proxy.** A future gateway extension would need its own ADR.

## Consequences

- When the host or any bot refreshes a token, everyone sees it, with no sync code. A host logout signs the bots out, and a host login signs them back in without recreating them.
- A bot that shares a login can misuse or corrupt it, and can write in the host's agent directory. The agents write their credential files and locks in that directory, so the bot needs write access to it, and the bot keeps that access until the watch stops it.
- The watch detects tampering but cannot prevent it: a host CLI may follow a planted link before the alarm.
- The owner accepted this risk as the price of using the same mechanism as the host's CLIs. It is opt-in per bot, and is stated plainly. Tokens are the alternative.
- The `add-terminay-bots` feasibility gate verified this, with evidence in `openspec/adr/evidence/0089-bots/`, on the macOS Podman machine and on Linux Docker. On Linux, locks cross between the host and the containers. On the macOS Podman machine they do not reach the VM, so a host refresh and a bot refresh at the same moment can sign one side out. The owner accepted that rare race, and Settings states it.
- `CLAUDE_SECURESTORAGE_CONFIG_DIR` is undocumented, so the built-in agent's conformance test checks it on every adapter upgrade.
- Claude Code on macOS always uses a token.
