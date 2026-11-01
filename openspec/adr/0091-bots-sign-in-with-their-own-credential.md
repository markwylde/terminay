# ADR-0091: Each bot signs in with its own credential, and nothing is shared with the host

Status: accepted
Date: 2026-11-01
Supersedes: 0090

## Context

ADR-0090 let a bot share the host's own agent login. The host directory that holds the auth file was mounted into the bot with every other entry masked. A tamper watch guarded it, and each bot needed a per-bot confirmation before it could use the shared file. The alternative was a token.

When the owner tried the built feature, three problems showed up:

- **Detection gaps.** Host login was offered only where Terminay could find a login file. Claude Code on macOS keeps its login in the Keychain, so a user who was plainly signed in saw "Not signed in" and no way to use their session. The rule was correct per the spec, but it was surprising, and it made the two agents behave differently by platform.
- **Machinery nobody asked for.** Sharing a live login file forced masks, sidecar lists, path validation, a fail-closed directory watch, unsafe states, alarms, recreate prompts, and a confirmation dialog that warned the bot could corrupt the user's login. The owner never asked for any of it.
- **Surprise.** Behaviour depended on what happened to be on the server account, rather than on what the user chose for the bot.

The owner decided to remove host login entirely.

## Decision

1. **Every bot signs in with its own credential.** Terminay never reads, detects, mounts, or copies any login of the server account.
2. **The supported credentials:**
   - Claude Code: a sign-in token from `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`), or an Anthropic API key (`ANTHROPIC_API_KEY`);
   - Codex: an OpenAI API key (`CODEX_API_KEY`, with ACP `authenticate` method `api-key`), or **Sign in with ChatGPT**.
3. **Tokens and API keys** keep ADR-0090's delivery: they are stored in the vault for that bot, and are passed only through the environment of the local `docker` client, never its arguments.
4. **Device sign-in.** An agent may declare a device sign-in: a sign-in command, a sign-out command, a label, and optionally its own bot config files. Terminay runs the command inside that bot's container, as `bot` with `HOME=/home/bot`, in a terminal shown in the bot's Sign-in section. The user approves the code in their own browser. The CLI saves the login in the bot's home volume, and Terminay never reads it. Codex declares `codex login --device-auth` and `codex logout`, with a config file that sets `cli_auth_credentials_store = "file"`. Bots on an API key keep the `"ephemeral"` default, so a key never reaches the disk.
5. **A new bot is not signed in** until the user chooses. A message or trigger for such a bot is refused with `unavailable` and a reason that names Configure › Profile › Sign-in.
6. **The extension contribution `authFile` is removed**, and replaced by the optional `deviceSignIn`.

## Consequences

- Each bot must be signed in once. Several bots can no longer share one subscription login automatically. The owner accepts this for its simplicity.
- All host-login code is deleted: mounts, masks, sidecars, path validation, the directory watch, unsafe states, alarms, its confirmation, and its protocol fields. No container ever receives a host path other than the engine socket, and only when the user turns that on.
- Two bots on the same ChatGPT account refresh their own tokens independently, so the lock race that ADR-0090 accepted on the macOS Podman machine no longer exists.
- A bot's agent, and the tools it runs, can still read that bot's own credential. That is unchanged and stated in Profile.
- ADR-0090's evidence under `evidence/0089-bots/` stays as history.
