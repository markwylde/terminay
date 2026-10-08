## ADDED Requirements

### Requirement: Renaming a terminal from its row
Double-clicking a terminal's row in the Folders tree SHALL replace the row's title with a text input that holds the terminal's current title, focused with the whole title selected. Pressing Enter, or moving focus out of the input, SHALL save the trimmed text as the terminal's title and restore the row. Pressing Escape SHALL restore the row without changing the title. Text that is blank after trimming, or equal to the current title, SHALL change nothing. A saved title SHALL be the terminal's title on its tab, on its row, and on every client of the server that owns the terminal. While a row is being renamed, pointer and keyboard input inside the input SHALL edit the text only: it SHALL NOT select another terminal, open the row's menu, or start a drag. Pressing Enter or Escape SHALL return focus to that terminal. A card that only lists terminals, and offers no menu for them, SHALL NOT offer renaming.

#### Scenario: Starting a rename
- **WHEN** a user double-clicks the row of a terminal titled `Terminal 1`
- **THEN** the row shows a focused text input holding `Terminal 1` with all of it selected

#### Scenario: Saving with Enter
- **WHEN** a user types `api server` into a row's rename input and presses Enter
- **THEN** the row and the terminal's tab both read `api server`, the input is gone, and the terminal has focus

#### Scenario: Saving by leaving the input
- **WHEN** a user types `logs` into a row's rename input and clicks elsewhere
- **THEN** the terminal's title is `logs` and the input is gone

#### Scenario: Cancelling
- **WHEN** a user types into a row's rename input and presses Escape
- **THEN** the row shows the title it had before and the terminal's title is unchanged

#### Scenario: A blank name
- **WHEN** a user clears a row's rename input and presses Enter
- **THEN** the terminal keeps its title

#### Scenario: Another client
- **WHEN** a terminal is renamed from its row on one client
- **THEN** a second client of the same server shows the new title on that terminal's row and tab

#### Scenario: Selecting text in the input
- **WHEN** a user drags across the text of a row's rename input
- **THEN** the text is selected and the row is not dragged
