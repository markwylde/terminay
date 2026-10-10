# program-set-tab-titles Specification

## Purpose
A program running in a terminal names its tab by writing an xterm title sequence. The server that owns the session reads it, treats it as untrusted display text, and resolves what the tab shows, so that a name a person gave always wins.

## Requirements

### Requirement: Displayed title resolution

A terminal panel SHALL have a default name, an optional named title, and an optional program title. The default name SHALL be `Terminal N`, assigned by the server when the terminal is created. The terminal's displayed title SHALL be its named title when it has one, otherwise its program title when it has one, otherwise its default name. The server SHALL resolve the displayed title and publish it in workspace state; a client SHALL present that value and SHALL NOT resolve a title itself.

#### Scenario: New terminal

- **WHEN** a terminal is created and no program has set a title
- **THEN** its tab shows its default name, `Terminal N`

#### Scenario: Program title with no named title

- **WHEN** a terminal has a program title and no named title
- **THEN** its tab shows the program title

#### Scenario: Named title and program title together

- **WHEN** a terminal has both a named title and a program title
- **THEN** its tab shows the named title

### Requirement: Programs set the title with xterm title sequences

A program running in a terminal SHALL set that terminal's program title by writing `OSC 0 ; <text>` or `OSC 2 ; <text>` to its output, terminated by `BEL` or `ST`. The server that owns the session SHALL read these sequences from the session's PTY output; they SHALL be recognised when split across output chunks. A sequence with empty text SHALL clear the program title. `OSC 1` SHALL NOT change the title. A sequence whose payload exceeds the parser's payload bound SHALL be ignored and SHALL leave the program title unchanged.

#### Scenario: Program sets a title

- **WHEN** a program in a terminal with no named title writes `OSC 2 ; build watcher BEL`
- **THEN** that terminal's tab shows "build watcher"

#### Scenario: Icon-and-title sequence

- **WHEN** a program writes `OSC 0 ; deploy ST`
- **THEN** the terminal's program title is "deploy"

#### Scenario: Sequence split across chunks

- **WHEN** a title sequence arrives in two separate PTY output chunks
- **THEN** the program title is set once, to the complete text

#### Scenario: Program clears its title

- **WHEN** a program writes `OSC 2 ; BEL` in a terminal with no named title
- **THEN** the terminal's tab shows its default name

#### Scenario: Icon-name sequence

- **WHEN** a program writes `OSC 1 ; name BEL`
- **THEN** the terminal's title is unchanged

#### Scenario: Oversized payload

- **WHEN** a program writes a title sequence whose payload exceeds the parser's payload bound
- **THEN** the sequence is ignored and the program title is unchanged

### Requirement: A named title outranks the program

A title set in the tab editor SHALL be a named title. While a terminal has a named title, a program title sequence SHALL update the stored program title and SHALL NOT change the displayed title. Clearing the name in the tab editor SHALL remove the named title, returning the tab to its program title when it has one and to its default name otherwise. The tab editor's name field SHALL hold the named title only, and SHALL show the title the tab would otherwise display as its placeholder when no named title exists.

#### Scenario: Program writes a title to a renamed tab

- **WHEN** a user has renamed a tab to "api" and the program in it writes `OSC 2 ; claude BEL`
- **THEN** the tab still shows "api"

#### Scenario: Clearing a rename with a program title present

- **WHEN** a user clears the name of a tab whose program title is "claude"
- **THEN** the tab shows "claude"

#### Scenario: Clearing a rename with no program title

- **WHEN** a user clears the name of a tab that has no program title
- **THEN** the tab shows its default name

#### Scenario: Editing a tab with no named title

- **WHEN** a user opens the tab editor for a terminal showing a program title
- **THEN** the name field is empty and shows the program title as its placeholder

### Requirement: Program titles are untrusted display text

A program title SHALL be treated as untrusted text. Before it is stored the server SHALL remove C0 and C1 control characters and Unicode bidirectional override and isolate characters, collapse runs of whitespace to a single space, trim the ends, and truncate the result to the length bound a named title has. A title that is empty after this SHALL clear the program title. A program title SHALL be display text only: it SHALL NOT select, authorize, or scope any operation. Terminay SHALL NOT report a terminal's title back to the program in response to a title query.

#### Scenario: Control characters in a title

- **WHEN** a program sets a title containing a carriage return and an escape character
- **THEN** the stored program title contains neither

#### Scenario: Direction override in a title

- **WHEN** a program sets a title containing a right-to-left override character
- **THEN** the stored program title does not contain it

#### Scenario: Over-long title

- **WHEN** a program sets a title longer than the named-title length bound
- **THEN** the stored program title is truncated to that bound

#### Scenario: Title of only whitespace

- **WHEN** a program sets a title that is only whitespace and control characters
- **THEN** the program title is cleared

#### Scenario: Title query

- **WHEN** a program writes a sequence asking the terminal to report its title
- **THEN** nothing is written to the program's input

#### Scenario: Title naming another terminal

- **WHEN** a program sets its title to the title of a terminal in another project
- **THEN** no operation reaches that terminal because of it

### Requirement: Program title is a synced workspace fact

A program title SHALL be server workspace state. It SHALL reach every authorized connected client, SHALL persist across a client reload and a server restart, and SHALL stay with the terminal when its panel moves to another project. It SHALL remain after the terminal's session exits. A program title change SHALL NOT advance the panel's metadata revision.

#### Scenario: Second device

- **WHEN** a program sets a title while two devices are connected
- **THEN** both devices show that title on the terminal's tab

#### Scenario: Reload

- **WHEN** a client reloads after a program set a title
- **THEN** the tab shows that title

#### Scenario: Server restart

- **WHEN** the server restarts after a program set a title
- **THEN** the tab shows that title

#### Scenario: Moved to another project

- **WHEN** a terminal with a program title is moved to another project
- **THEN** its tab shows the same title in the target project

#### Scenario: Session exit

- **WHEN** the session of a terminal with a program title exits
- **THEN** the tab keeps that title

#### Scenario: Metadata revision

- **WHEN** a program changes its title
- **THEN** the panel's metadata revision is unchanged

### Requirement: Title bursts are coalesced

The server SHALL commit at most one program title change per terminal in any 250 ms window, and that commit SHALL carry the most recent title the program set. A title sequence that leaves the stored program title unchanged SHALL commit nothing.

#### Scenario: Animated title

- **WHEN** a program sets twenty different titles within 250 ms
- **THEN** at most two changes are committed and the stored program title is the last one set

#### Scenario: Repeated identical title

- **WHEN** a program sets the same title it already has
- **THEN** no workspace change is committed
