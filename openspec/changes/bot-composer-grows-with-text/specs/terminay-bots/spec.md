## ADDED Requirements

### Requirement: Bot chat composer sizes to its text

The message box in a bot tab's Chat mode SHALL be at least three lines tall and SHALL grow to show all of its text, wrapped lines included, up to a maximum of twelve lines or 40% of the window height, whichever is smaller, but never under three lines. Text beyond the maximum SHALL scroll inside the box. The box SHALL shrink as text is removed and re-fit when its width or the window height changes. The limits apply to the text box only.

#### Scenario: Empty composer

- **WHEN** a user opens a bot's chat with no unsent text
- **THEN** the message box is three lines tall and does not scroll

#### Scenario: Shift+Enter lines grow the box

- **WHEN** a user types five lines with Shift+Enter between them
- **THEN** the message box grows to show all five lines without scrolling, and nothing is sent

#### Scenario: A long line wraps and grows the box

- **WHEN** a user types one line long enough to wrap onto several lines
- **THEN** the message box grows to show every wrapped line

#### Scenario: Long paste stops at the maximum

- **WHEN** a user pastes forty lines of text into a tall window
- **THEN** the message box stops growing at twelve lines and the text scrolls inside it

#### Scenario: A short window lowers the maximum

- **WHEN** the window is short enough that 40% of its height is less than twelve lines, or becomes so while text is in the box
- **THEN** the message box is at most 40% of the window height, and never less than three lines, and its text scrolls inside it

#### Scenario: Deleting text shrinks the box

- **WHEN** a user deletes lines from a grown message box, or clears it without sending
- **THEN** the box shrinks to fit the remaining text, and an empty box is three lines tall

#### Scenario: Narrowing the tab re-fits the text

- **WHEN** a bot tab narrows so the text in its message box wraps onto more lines
- **THEN** the box grows to show the extra lines, up to its maximum

#### Scenario: Restored draft keeps its size

- **WHEN** a user leaves a multi-line unsent message, opens another Home tab, and returns
- **THEN** the message box is tall enough to show the draft, as it was before

### Requirement: Sending from a grown bot chat composer

Enter without Shift SHALL send the message, except while an input method is composing text; Shift+Enter SHALL insert a new line. When a post succeeds and empties the message box, the box SHALL return to three lines. When a post fails, or the user types more while it is being posted, the box SHALL keep that text at the height it needs.

#### Scenario: Sending shrinks the box

- **WHEN** a user presses Enter to send a grown multi-line message and the post succeeds
- **THEN** the message is sent and the empty message box is three lines tall again

#### Scenario: A failed post keeps the text

- **WHEN** a user sends a grown multi-line message and the post fails
- **THEN** the text stays in the message box at the height it needs
