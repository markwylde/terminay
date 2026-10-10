## RENAMED Requirements

- FROM: `### Requirement: Program title is a synced workspace fact`
- TO: `### Requirement: Program title is a live server fact`

- FROM: `### Requirement: Title bursts are coalesced`
- TO: `### Requirement: Title publication is coalesced`

## MODIFIED Requirements

### Requirement: Displayed title resolution

A terminal panel SHALL have a default name, an optional named title, and an optional program title. The default name SHALL be `Terminal N`, assigned by the server when the terminal is created. The terminal's displayed title SHALL be its named title when it has one, otherwise its program title when it has one, otherwise its default name. The server SHALL resolve the displayed title and publish it, per terminal, as a live terminal title fact to every connection authorized to see that terminal; a client SHALL present that value and SHALL NOT resolve a title itself. A client that connects SHALL receive the displayed title of every terminal it may see.

#### Scenario: New terminal

- **WHEN** a terminal is created and no program has set a title
- **THEN** its tab shows its default name, `Terminal N`

#### Scenario: Program title with no named title

- **WHEN** a terminal has a program title and no named title
- **THEN** its tab shows the program title

#### Scenario: Named title and program title together

- **WHEN** a terminal has both a named title and a program title
- **THEN** its tab shows the named title

#### Scenario: Client connects after a title was set

- **WHEN** a client connects to a server on which a program has already set a terminal's title
- **THEN** that terminal's tab shows the program title without the program writing it again

#### Scenario: Terminal outside a connection's scope

- **WHEN** a program sets the title of a terminal a connection is not authorized to see
- **THEN** that connection receives no title fact for it

### Requirement: Program title is a live server fact

A program title SHALL be live state the server holds in memory for the terminal's session. It SHALL NOT be a field of workspace state, SHALL NOT be written to the server's persisted state, and a program title change SHALL NOT advance the workspace revision or the panel's metadata revision. It SHALL reach every authorized connected client, SHALL be shown again after a client reloads, SHALL stay with the terminal when its panel moves to another project, and SHALL remain after the terminal's session exits for as long as the server runs. After a server restart a terminal SHALL have no program title until a program sets one.

#### Scenario: Second device

- **WHEN** a program sets a title while two devices are connected
- **THEN** both devices show that title on the terminal's tab

#### Scenario: Reload

- **WHEN** a client reloads after a program set a title
- **THEN** the tab shows that title

#### Scenario: Server restart

- **WHEN** the server restarts after a program set a title on a terminal with no named title
- **THEN** the tab shows the terminal's default name until a program sets a title again

#### Scenario: Moved to another project

- **WHEN** a terminal with a program title is moved to another project
- **THEN** its tab shows the same title in the target project

#### Scenario: Session exit

- **WHEN** the session of a terminal with a program title exits
- **THEN** the tab keeps that title

#### Scenario: Metadata revision

- **WHEN** a program changes its title
- **THEN** the panel's metadata revision is unchanged

#### Scenario: Workspace revision

- **WHEN** a program changes its title
- **THEN** the workspace revision is unchanged

#### Scenario: Persisted state

- **WHEN** a program changes its title
- **THEN** the server's persisted workspace state is not written

### Requirement: Title publication is coalesced

The server SHALL publish at most one displayed-title change per terminal in any 250 ms window, and that publication SHALL carry the title current at the end of the window. A title sequence that leaves the terminal's displayed title unchanged SHALL publish nothing. A title waiting to be delivered to a connection SHALL be replaced by a newer title for the same terminal rather than queued behind it.

#### Scenario: Animated title

- **WHEN** a program sets twenty different titles within 250 ms
- **THEN** at most two title changes are published and the displayed title is the last one set

#### Scenario: Repeated identical title

- **WHEN** a program sets the same title it already has
- **THEN** nothing is published

#### Scenario: Program title under a named title

- **WHEN** a program sets a title on a terminal that has a named title
- **THEN** nothing is published, and the program title is the one shown if the name is later cleared

#### Scenario: Slow connection

- **WHEN** a connection has an undelivered title for a terminal and that terminal's title changes again
- **THEN** the connection receives the newer title and not the older one
