## Why

An enabled trigger shows a green **Disabled** status pill in a bot's Triggers table, right next to an enable switch that is on. Users cannot tell whether the trigger will fire. The cause is that a trigger's source health starts as `disabled`, is reset to `disabled` when the trigger is enabled or retried, and is never updated for interval and cron triggers, which do not run source checks. The table then renders that health state in the "healthy" tone.

## What Changes

- An enabled trigger on an enabled bot reports `waiting` health until its source reports something more specific (checking, healthy, watching, failed, and so on). It never reports `disabled`.
- A trigger reports `disabled` health only while the trigger itself, or its bot, is disabled. Re-enabling a bot keeps whatever specific state its triggers last reported.
- Enabling a trigger and retrying a trigger reset its health to `waiting`, not `disabled`.
- The Triggers table shows a neutral **Disabled** pill when the trigger or its bot is disabled. It never labels a trigger Disabled while both are enabled, whatever health the server sends.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-triggers`: adds a requirement that a trigger's status agrees with whether it is enabled.

## Impact

- `packages/server-core/src/botService/sourceState.ts` (initial checkpoint health) and `triggers.ts` (`list`, `enable`, `retry`).
- `src/workspace/bots/BotTriggersPanel.tsx` (`statusOf`).
- Tests: `packages/server-core/test/bot-triggers.test.mjs`; a renderer unit test for the status mapping.
- No protocol change: `waiting` is already a `BotSourceHealth` state. Health already stored as `disabled` for an active trigger is reported as `waiting`, so no data migration is needed.
