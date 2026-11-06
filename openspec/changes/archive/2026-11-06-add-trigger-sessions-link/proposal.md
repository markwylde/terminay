## Why

A user looking at a bot's trigger cannot see what that trigger has done. The Sessions tab can show trigger sessions, but only all of them mixed together. To answer "what happened the last ten times *Greet new Gitea pull requests* fired?", the user has to read the trigger name on every trigger session. Each session already records the trigger that started it, so the data is there. Only a way to reach it from the trigger is missing.

## What Changes

- Each row of the Triggers table gains a **Sessions** action. The trigger editor sheet for a saved trigger gains the same action.
- Choosing it switches the bot to the Sessions tab, filtered to the sessions that trigger started. That covers its scheduled or event firings and its Run now sessions.
- The Sessions tab shows the active trigger filter as a removable chip that names the trigger. The chip combines with the existing origin, outcome and text filters. Clearing the chip, or choosing the Sessions tab, removes only the trigger filter. Opening a specific session from elsewhere also removes it, so that session is never hidden.
- The server's bot sessions query accepts an optional trigger id. It returns only that bot's sessions whose origin records that trigger id, so a deleted trigger's retained sessions stay reachable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: the Sessions requirement adds filtering by the originating trigger.
- `bot-triggers`: the Trigger table and editor sheet requirement adds a Sessions action on each row and on a saved trigger's sheet.

## Impact

- `packages/client-core`: the `bots.sessions` read takes an optional `triggerId`.
- `packages/server-core/src/botService`: `sessions.list` and the `bots.sessions` protocol handler filter by `triggerId`.
- `src/workspace/bots`: `BotTriggersPanel`, `BotTriggerEditor`, `BotSessionsPanel` and `BotTab` carry the trigger filter from the Triggers tab to the Sessions tab.
- Tests: unit coverage for the server filter, and the bots end-to-end suite.
