## ADDED Requirements

### Requirement: Trigger source picker and quick start

The trigger editor SHALL choose a trigger's source from a single picker that groups the sources under Files, Network, Commands, and Time, and that describes each source in a line of its own. The editor's other choices SHALL use the same picker.

A bot with no triggers SHALL show one empty state that offers a quick start for each source, and choosing one SHALL open the editor on that source. While a bot with no triggers is being given its first, the editor SHALL be shown without an empty list beside it.

#### Scenario: Choosing a source

- **WHEN** a user opens the Source picker in the trigger editor
- **THEN** it lists the sources under Files, Network, Commands, and Time, each with a description, and choosing one switches the editor to that source

#### Scenario: Quick start

- **WHEN** a bot has no triggers and the user chooses File or folder changes in the empty state
- **THEN** the trigger editor opens alone, on the File or folder changes source
