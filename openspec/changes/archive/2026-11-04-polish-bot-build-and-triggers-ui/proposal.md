## Why

The bot image notice could not be dismissed: "Bot image ready" stayed above every bot for good. Opening it replaced the whole window, hid the app chrome, and gave each step a row tall enough that a 35-step build filled several screens. The Triggers tab showed two competing placeholders side by side on an empty bot. Its editor split one choice across two native selects, "Source group" and "Source type", which look nothing like the grouped picker the Profile tab uses for Agent.

## What Changes

- A completed build's notice carries a dismiss control. Once the notice has been on screen, leaving that surface and coming back retires it on its own. A failed or interrupted build's notice stays, because it is the route back to **Retry build**.
- Build progress opens as a side sheet over the workspace, with a close control, a progress bar, and one compact row per step. Each step's output opens inline from that row.
- The Triggers empty state is one panel offering a quick start for each source. Choosing one opens the editor on that source. With no triggers, the editor takes the page alone and no empty list column is shown.
- The trigger editor chooses its source from one grouped picker: Files, Network, Commands, and Time, each option with an icon and a line of description. Every other select in the editor, and the Model select on the Profile tab, uses the same grouped picker.
- The schedule preview lists the next runs as short dated chips instead of one long line.

## Capabilities

### Modified Capabilities

- `bot-environment`: the build notice can be dismissed and retires once seen; progress opens as a sheet.
- `bot-triggers`: one grouped source picker; a quick-start empty state.

## Impact

Renderer only: `src/workspace/bots/` (a new `GroupedSelect`, `BotBuildProgress`, `BotTriggersPanel`, `BotTriggerEditor`, `BotProfilePanel`, styles) and `e2e/bots.spec.ts`. No protocol, server, or persistence change. Dismissal is remembered in the renderer's local storage.
