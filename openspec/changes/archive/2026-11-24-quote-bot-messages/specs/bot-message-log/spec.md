## ADDED Requirements

### Requirement: Quote in the message menu

Every chat message whose text is not blank, whether the user or the bot wrote it, SHALL offer Quote as the first item of its message menu, above Edit message and Delete message. The menu SHALL open on right-click and, when the message has focus, on the context-menu key or Shift+F10. A menu opened from the keyboard SHALL appear at the message with its first item focused, SHALL be operable with Up, Down, Home, End and Enter, and SHALL return focus to the message when Escape closes it. A message whose text is empty or only whitespace SHALL NOT offer Quote.

#### Scenario: Message with only an attachment
- **WHEN** the user opens the menu on a message that has an image and no text
- **THEN** the menu offers Edit message and Delete message but not Quote

#### Scenario: Quote from the keyboard
- **WHEN** a message has focus and the user presses Shift+F10
- **THEN** the menu appears at the message with Quote focused
- **AND** pressing Enter inserts the quote and focuses the composer

#### Scenario: Dismiss from the keyboard
- **WHEN** a keyboard-opened message menu is open and the user presses Escape
- **THEN** the menu closes and the message has focus again

### Requirement: Quote text

Quote SHALL quote the message's stored text, its Markdown source, unless the user has a non-empty text selection lying wholly inside that message's body when the menu opens; then only the selected text, as displayed, SHALL be quoted. A selection outside the message, or spanning it and another message, SHALL be ignored. Choosing a quote SHALL NOT change what Edit message edits.

The quoted text SHALL have CRLF and CR line endings turned into LF and blank lines at its start and end removed; other lines SHALL be kept as they are, trailing spaces included. Each line SHALL then be prefixed with `> `, an empty line written as `>`, and the quote followed by one blank line.

Quoted text longer than 2,000 characters, counted as Unicode code points, SHALL be cut to at most 2,000 code points, at the last line break when one falls in the second half of the cut, and never inside a code point. When the cut leaves a fenced code block open, a closing fence SHALL be added. The quote SHALL then end with a `>` line and a `> …` line.

#### Scenario: Multi-line bot reply
- **WHEN** the user quotes the bot message "Build passed.\r\n\r\nDeployed to staging.\n"
- **THEN** the quote is "> Build passed.\n>\n> Deployed to staging.\n\n"

#### Scenario: Markdown is kept
- **WHEN** the user quotes a message containing a fenced code block and a list
- **THEN** every line of the fence and the list appears in the quote prefixed with `> `, unchanged otherwise

#### Scenario: Quote a selection
- **WHEN** the user selects one sentence inside a long bot message and chooses Quote on that message
- **THEN** only that sentence is quoted
- **AND** choosing Edit message on the same message still edits its full text

#### Scenario: Selection elsewhere
- **WHEN** the user has text selected in another message and chooses Quote on this message
- **THEN** the whole of this message is quoted

#### Scenario: Long message cut at a line break
- **WHEN** the user quotes a message of 10,000 characters made of 80-character lines
- **THEN** the quote holds the message's first whole lines up to 2,000 characters and ends with ">\n> …\n\n"

#### Scenario: Long message cut inside a code block
- **WHEN** the 2,000-character cut falls inside a fenced code block
- **THEN** the quote closes the fence before its `> …` line

### Requirement: Quote into the composer

Choosing Quote SHALL append the quote to the composer's draft and SHALL NOT change the existing draft text or the pending files. An empty draft SHALL become the quote. A draft that ends in a blank line SHALL be followed directly by the quote; one that ends in a single line break SHALL get one more; any other draft, whitespace-only drafts included, SHALL get a blank line before the quote. The composer SHALL then have focus with the caret at the end of the draft. Quoting SHALL NOT send anything.

#### Scenario: Quote into an empty composer
- **WHEN** the composer is empty and the user quotes the bot message "Ship it"
- **THEN** the draft is "> Ship it\n\n"
- **AND** the composer has focus with the caret at the end
- **AND** no message is sent

#### Scenario: Quote the user's own message after a draft
- **WHEN** the draft is "About this:" and the user quotes their own message "Ship it"
- **THEN** the draft is "About this:\n\n> Ship it\n\n" and the caret is at the end

#### Scenario: Draft ending in a line break
- **WHEN** the draft is "Two things:\n" and the user quotes "A"
- **THEN** the draft is "Two things:\n\n> A\n\n"

#### Scenario: Two quotes in a row
- **WHEN** the user quotes "A" and then quotes "B"
- **THEN** the draft is "> A\n\n> B\n\n"

#### Scenario: Pending files are kept
- **WHEN** an image is pending in the composer and the user quotes a message
- **THEN** the image is still pending
