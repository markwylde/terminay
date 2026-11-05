## Context

`BotTriggersPanel` showed cards in a two-column layout, with the editor in the right column. The trigger engine already distinguishes edge firing from repeat firing (`sourceState.ts`: `matching && (repeat || !wasMatching)`), but the form exposed this only as an ambiguous checkbox.

## Decisions

- **Table plus sheet.** A table compares triggers at a glance, and showing "last checked" beside "last fired" makes an edge-firing trigger visibly alive. The editor sits in an overlay positioned inside the panel, not portalled to the document. It stays scoped to the bot tab, so tab-scoped tests and focus behave as before. The sheet stays mounted while hidden, which keeps a draft across close and reopen.
- **Validation waits for input.** Client-side problems appear only after the first edit, and save always validates. Preview requests that the server refuses are dropped silently: they are advisory, and the server validates again on save. No boundary is crossed; the renderer still only calls the existing trigger commands.
- **Fire wording.** A two-option picker names both behaviours, replacing a checkbox whose unchecked meaning was hidden in brackets.
