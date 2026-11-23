## Why

Sign-in's **Copy from another bot** lists every bot that runs the same agent,
including bots with no saved token, such as one using a device sign-in. Choosing
one fails with `The secret is not in the server vault`, which does not tell the
user what went wrong or what to do.

## What Changes

- Each token's copy list shows only other bots of the same agent that have that
  token saved. With no such bot, the copy control is not shown.
- Open Sign-in sections refresh when a token is saved, copied, or removed.
- A copy whose source has no saved token is refused with a message that names
  the cause.
- A device login is still never copied.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: copying a token is offered only from a bot that has it.

## Impact

`bots.credentials.options` gains per-token `copySources` bot IDs. It returns no
secret values. The Sign-in section and credential protocol change.
