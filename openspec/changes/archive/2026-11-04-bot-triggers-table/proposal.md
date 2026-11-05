## Why

On the Triggers tab, each trigger was a tall card, and an empty "Select a trigger" panel sat beside the list. Hovering a card's title block painted it solid blue. The editor showed a red error banner before anything was saved: the server's preview refused a half-typed condition, and that refusal stuck at the top of the form. A command trigger set to "Text contains" looked broken. It checked every minute but fired only once, because the checkbox that controls repeat firing did not say what leaving it unchecked meant.

## What Changes

- Triggers are listed in a table: trigger (source icon, name, plain-words condition), status, last checked, last fired, next, an enable switch, Run now, and delete. Columns that do not fit a narrow panel are dropped, and on very narrow panels each row stacks.
- The editor opens as a sheet over the table. Escape, the close control, or clicking outside closes it, and the unsaved draft is kept.
- The editor shows no problem on a form the user has not touched. Once touched, a problem shows inline as a quiet hint where the schedule preview appears. A failed save shows its reason in the footer beside Save. Preview refusals are not shown.
- The repeat checkbox becomes a **Fire** choice: "When it starts matching" or "On every matching check", each with a description.
- The editor body scrolls between a fixed header and footer. **Test source** sits in a "Try it" section, and health facts show as a labelled list.

## Capabilities

### Modified Capabilities

- `bot-triggers`: the list is a table, the editor is a sheet, and validation waits for the user.

## Impact

Renderer only: `src/workspace/bots/BotTriggersPanel.tsx`, `BotTriggerEditor.tsx`, `botPanels.css`, and a screenshot step in `scripts/bots-ui.test.mjs`. No protocol or server change.
