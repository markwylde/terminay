## ADDED Requirements

### Requirement: Terminal overlays stay clear of the workflow panel

The connection-recovery banner, input notices, paste and file-upload progress, the find bar, and the dictation overlay SHALL lie within the terminal's own area: left of the vertical workflow panel or rail, above the horizontal workflow drawer or strip, and above the rail of minimised app windows. None of them SHALL be drawn under or over the docked panel, drawer, strip or rail, and each SHALL fit within the terminal's width.

#### Scenario: Finding text beside the workflow panel

- **WHEN** the user opens find in a terminal with an expanded workflow panel
- **THEN** the find bar ends to the left of the panel and the panel's collapse control stays visible and operable

#### Scenario: Notices above the workflow drawer

- **WHEN** the layout is horizontal and a terminal with an expanded workflow drawer shows its paste progress or an input notice
- **THEN** the progress or notice sits above the drawer

#### Scenario: Notices above a minimised app window

- **WHEN** a terminal with a minimised app window shows its paste progress or an input notice
- **THEN** the progress or notice sits above the app-window rail

### Requirement: Bottom overlays stack without covering each other

When a terminal shows more than one of the connection-recovery banner, an input notice, and paste or file-upload progress at once, they SHALL stack vertically at the bottom of the terminal's area with the recovery banner nearest the bottom edge, and none SHALL cover another. When the stack is taller than the terminal's area, it SHALL scroll within that area.

#### Scenario: A notice and the recovery banner together

- **WHEN** a terminal shows an input notice while its recovery banner is showing
- **THEN** the notice shows above the banner and both the notice's button and **Retry connection** can be clicked

### Requirement: The connection-recovery banner stays operable

A terminal's connection-recovery banner SHALL keep its message and actions fully visible and operable by pointer and keyboard whatever workflow panel, drawer or app-window rail the pane shows, and SHALL be drawn above the workflow panel's and drawer's narrow-pane overlays. When the terminal's area is too narrow for the message and actions on one line, the message SHALL wrap and the actions SHALL move below it rather than be clipped or hidden.

#### Scenario: Retrying with the workflow panel expanded

- **WHEN** a terminal with an expanded workflow panel shows a connection-recovery banner such as "Terminal recovery timed out. Retry the connection to continue."
- **THEN** the banner and its **Retry connection** button end to the left of the panel, and clicking **Retry connection** retries the connection

#### Scenario: Retrying from the keyboard

- **WHEN** the recovery banner shows beside an expanded workflow panel and the user focuses **Retry connection** and presses Enter
- **THEN** the connection is retried

#### Scenario: Retrying with the workflow rail

- **WHEN** a terminal whose workflow panel is collapsed to the rail shows the recovery banner
- **THEN** the banner ends to the left of the rail and **Retry connection** can be clicked

#### Scenario: Retrying with the workflow drawer

- **WHEN** the layout is horizontal and a terminal with an expanded workflow drawer shows the recovery banner
- **THEN** the banner sits above the drawer and **Retry connection** can be clicked

#### Scenario: Retrying while a narrow-pane overlay is open

- **WHEN** the workflow panel's or drawer's overlay is open in a narrow or short pane and the terminal shows the recovery banner
- **THEN** the banner is drawn above the overlay and **Retry connection** can be clicked

#### Scenario: A narrow terminal wraps the banner

- **WHEN** the terminal's area beside the workflow panel is too narrow for the banner's message and **Retry connection** on one line
- **THEN** the message wraps, **Retry connection** shows in full below it, and neither extends under the panel
