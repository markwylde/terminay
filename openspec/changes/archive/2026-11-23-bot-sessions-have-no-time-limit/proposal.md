## Why

A bot working on a long task can stop partway through without anyone knowing. On 2026-11-23 a bot opened a PR, waited on CI with a background monitor, and was killed by Claude Code's 10-minute background limit 63 seconds before CI passed. Terminay recorded the session as completed, so no follow-up ran and the user was never told. Bot tasks can legitimately take hours or days, so time limits are the wrong safeguard: sessions need to keep running, be checked on, and never report an interrupted run as a success.

## What Changes

- **BREAKING** Remove the per-bot maximum turn time: the `maxTurnMs` profile and snapshot field, both turn timers, and the **Maximum turn** field in the bot profile. Stored values are ignored.
- Launch Claude Code with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, so background work can outlast 10 minutes and still wake the bot.
- Start a check-in session for every 15 minutes a session runs, using the prompt from issue #648 with the real session ID and duration.
- Check-ins do not recurse or overlap, stop with the watched session, stay quiet when nothing is wrong, and leave decisions waiting on the user alone.
- Let the runner output tool read running executions, with a metadata-only activity summary, so a check-in can tell progress from a stall.
- Record an execution whose background work was stopped as failed, run normal failure follow-up, and always post one chat notice so the user is told.
- Show check-ins as their own origin in Sessions.

## Capabilities

### New Capabilities

- `bot-check-ins`: the 15-minute check-in schedule, prompt, no-recursion and overlap rules, and handling of ended or user-blocked sessions.

### Modified Capabilities

- `terminay-bots`: turns have no maximum duration, each bot has one dedicated check-in slot, permission requests wait until their turn ends, and Sessions shows the check-in origin.
- `bot-message-log`: the runner output read accepts running executions, returning the latest slice and kind-and-status activity only.
- `bot-failure-follow-up`: stopped background work is a failure, and a check-in's failure does not wake the bot.

## Impact

- `packages/protocol/src/bots.ts`: profile, snapshot and session origin types.
- `packages/server-core/src/botService/`: `service.ts`, `native.ts`, `agentProcess.ts`, `queue.ts`, `store.ts`, `sessions.ts`, `runtime.ts`, `runtimeInspect.ts`, `failureFollowUps.ts`, and a new check-in scheduler.
- `extensions/builtin-agents`: Claude Code launch environment.
- `src/workspace/bots/`: profile form, session labels and origin filter.
- Unit tests and `e2e/bots.spec.ts`.
