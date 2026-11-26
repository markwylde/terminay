## Why

A bot trigger wakes the agent every time it fires, even when there is nothing to do. A nightly "sync the docs with today's merged pull requests" trigger starts a full AI session on days with no merged pull requests, and the session's only work is to discover that. The user pays for that run in tokens, time and container load. The only way to avoid it today is to rebuild the trigger as a polled command source, which gives up the cron schedule, event or file watch the trigger actually wants.

## What Changes

- A trigger gains an optional **gate**: the path of a script in the bot's container. It is available for every source (schedule, event, files, HTTP, SSE and command).
- When a trigger firing is about to start a session, the server runs the gate first, in the bot's container, with a 30-second limit.
  - Gate prints nothing and exits 0: the session starts as it does today.
  - Gate prints any text to stdout (white space alone counts as nothing): the firing is skipped. It is recorded as `skipped` with the reason taken from stdout, bounded and with the bot's credentials redacted. This is not a failure: no failed health, no failure follow-up.
  - Gate is broken (missing file, non-zero exit with empty stdout, over the time limit, or its run cannot be completed): the gate **fails open**. The firing goes on to start its session under the ordinary rules, and the first message carries a short note with the gate's exit status, and its stderr when the script ran to completion, so the bot can repair its own gate.
- A firing uses the gate its trigger had when it fired, as it already does for the prompt.
- **Run now** bypasses the gate.
- The trigger editor gains a Gate field with a plain-words description.
- The bot's runtime trigger tools (`triggers_create`, `triggers_update`) accept the gate, describe what it does, and tell the bot to add a gate whenever a cheap check can rule out a pointless run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-triggers`: adds the trigger gate, its verdicts, how a gated firing is recorded, the fail-open rule for a broken gate, the editor field, and the guidance the runtime trigger tools give the bot.

## Impact

- `packages/protocol/src/bots.ts`: optional `gate` on `BotTriggerDraft` / `BotTrigger`.
- `packages/server-core/src/botService/`: `triggerState.ts` (validation and persistence), `sourceState.ts` (the gate snapshot on a pending firing), `triggers.ts` (running the gate before a firing is admitted, skip and fail-open paths), `runtimeTriggers.ts` (tool schema and descriptions). The gate runs through the existing source runner as a command run, so the bot image and its `terminay-source` worker do not change.
- `src/workspace/bots/`: `triggersModel.ts`, `BotTriggerEditor.tsx` (Gate field), and the trigger row's existing skipped-reason display.
- Tests: `packages/server-core/test/bot-triggers.test.mjs`, `src/workspace/bots/triggersModel.test.ts`, `e2e/bots.spec.ts`.
- No new dependency. Triggers saved without a gate behave exactly as before. Another bot's inspection tools do not return the gate, as they do not return trigger commands.
