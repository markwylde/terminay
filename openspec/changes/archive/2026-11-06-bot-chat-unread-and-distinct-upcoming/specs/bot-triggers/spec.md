## MODIFIED Requirements

### Requirement: Triggers tab

The Triggers tab SHALL list a bot's triggers. For each, it SHALL show the kind, a plain-words description, whether it is enabled, its last firing and that firing's outcome, and its next firing. It SHALL also show the bot's upcoming firings, across all its triggers, in time order for the next seven days.

Each trigger SHALL offer edit, enable or disable, delete, and **Run now**. Run now SHALL queue a session whose origin is Run now, whether or not the trigger is enabled.

The context rail of the bot tab SHALL show the next three distinct triggers to fire, each once at its next firing, in time order. A trigger with further firings in the upcoming window SHALL carry a repeat mark.

The Triggers page SHALL use the available panel width, retaining the panel's standard padding. Its toolbar, trigger list and empty state SHALL not be constrained by a fixed maximum content width.

#### Scenario: Wide bot panel

- **WHEN** a user opens Triggers in a wide bot panel
- **THEN** its toolbar and list or empty state span the available width inside the standard padding

#### Scenario: Run now

- **WHEN** a user chooses Run now on a disabled trigger of an idle bot
- **THEN** a session with origin Run now starts with that trigger's prompt, and the trigger stays disabled

#### Scenario: Upcoming firings

- **WHEN** a bot has an hourly trigger and a daily trigger
- **THEN** the Triggers tab shows their firings for the next seven days interleaved in time order

#### Scenario: Repeating trigger in the rail

- **WHEN** a bot has a trigger firing every minute and a daily trigger
- **THEN** the context rail lists each trigger once at its next firing, and the every-minute trigger shows a repeat mark
