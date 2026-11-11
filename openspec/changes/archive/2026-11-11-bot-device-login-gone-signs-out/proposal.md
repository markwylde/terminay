## Why

A bot signed in with ChatGPT or Claude keeps its login only in its home volume.
If that volume is removed, for example by hand while rebuilding the bot's
container, the login is gone, but the bot still says it is signed in. Every
message then fails inside the agent with a raw 401 such as `Missing bearer or
basic authentication in header`, retried five times, and nothing tells the user
to sign the bot in again.

## What Changes

- An agent's device sign-in may declare a **status command** that checks,
  offline, whether its login is in the bot's home. Codex declares
  `codex login status`, and Claude Code declares `claude auth status`.
- Before each session of a bot whose sign-in is `device`, the server runs that
  command in the bot's container as `bot`. If it reports no login, the bot
  becomes **Not signed in**, and the message is refused with a reason that
  names Configure › Profile › Sign-in. The agent is not started.
- An engine failure while running the check is not evidence of a missing login
  and leaves the sign-in unchanged.
- Recreating a bot's container keeps its home volume, so a recreate never
  signs a bot out. That is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: device sign-in gains a per-session login check.

## Impact

- `@terminay/extension-api`: optional `deviceSignIn.statusCommand`.
- `extensions/builtin-agents/package.json`: status commands for Codex and
  Claude Code.
- `packages/server-core/src/botService/service.ts`: the check before each
  device-signed-in session.
