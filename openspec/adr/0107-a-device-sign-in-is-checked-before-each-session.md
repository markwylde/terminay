# ADR-0107: A device sign-in is checked before each session

Status: accepted
Date: 2026-11-11

## Context

ADR-0091 keeps a device login (Sign in with ChatGPT, Sign in with Claude) only
in the bot's home volume, and Terminay never reads it. The bot's recorded
sign-in changes only when sign-in or sign-out runs. When the home volume is
removed outside Terminay, the record still says `device`, and every session
fails inside the agent with an authentication error that does not tell the
user to sign in again.

## Decision

1. An agent's `deviceSignIn` may declare an optional `statusCommand`. It must
   work offline, exit 0 when a login is present in the home, and exit non-zero
   when none is.
2. Before each session of a device-signed-in bot, the server runs the command
   in the bot's container as `bot` with `HOME=/home/bot`. Only its exit status
   is returned. Its output is discarded.
3. A non-zero exit sets the bot to Not signed in, and the session is refused
   with the Sign-in guidance before the agent starts. An engine failure while
   running the check changes nothing.
4. Codex declares `codex login status`. Claude Code declares
   `claude auth status`.

## Consequences

- A lost login reads as Not signed in, the same as a bot never signed in.
- Terminay still never reads, copies, or displays a device login.
- Expired or revoked logins are not detected. The agent reports them itself.
- Each device-signed-in session start costs one short `exec`.
