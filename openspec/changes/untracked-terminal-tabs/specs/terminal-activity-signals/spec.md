## ADDED Requirements

### Requirement: Untracked terminals

Each terminal tab SHALL carry a **Track activity** setting, offered in that tab's Edit Tab window and on by default. Its description SHALL say that turning it off stops the tab's activity being shown on its tab, its project, the sidebar, Home, notifications, and phone notifications. A terminal whose **Track activity** is off is **untracked**. The setting SHALL be per panel, SHALL be stored with the panel in server-owned workspace state, and SHALL travel with the panel when it moves between projects or windows.

An untracked terminal SHALL present no activity state on any surface a person reads activity from: its terminal tab, its project-tab activity dot, project switcher rows, the header Notifications list, the application icon badge, phone push notifications, the left-column tree and its collapsed-folder dots, the compact switcher, the Agents pane, and the Home dashboard. This SHALL hold for raw-output activity, terminal signals, bell and OSC notifications, and the canonical state of an agent bound to the terminal. Wherever such a surface lists the terminal or its agent, it SHALL present it as idle and SHALL still list it. The Home dashboard Board is the one exception: there, an untracked terminal is placed in the Untracked column rather than read as idle.

The server SHALL NOT raise, publish, or push a notification record from an untracked terminal's activity, including the state of its bound agent, and turning **Track activity** off SHALL withdraw any activity record the terminal holds. A notification a process in the terminal sends deliberately through the control endpoint is a message, not activity, and SHALL still be delivered. Activity that arose while a terminal was untracked SHALL NOT be reported once tracking is turned back on: turning tracking on SHALL acknowledge the terminal's current activity, and only state that arises after that SHALL be reported.

Untracked status SHALL govern presentation only. It SHALL NOT change activity detection, agent lifecycle observation, or canonical agent state, and the MCP terminal status tools SHALL keep reporting an untracked terminal's real activity.

#### Scenario: Long-running command in an untracked tab

- **WHEN** a user turns off **Track activity** for a tab and runs `caffeinate` in it
- **THEN** the tab, its project-tab dot, the left-column tree, the compact switcher, and the Home dashboard List and Projects views all show the tab as idle, and the Home dashboard Board places it in the Untracked column

#### Scenario: Bell in an untracked tab

- **WHEN** an unfocused untracked terminal rings a bell or emits an OSC notification
- **THEN** no attention state is shown for it, no header notification is listed, the application icon badge does not count it, and no phone push is sent

#### Scenario: Agent in an untracked tab

- **WHEN** an agent bound to an untracked terminal becomes working, waiting, blocked, or done
- **THEN** no surface shows that state, the Agents pane still lists the agent without a state glyph, and no notification is raised for it

#### Scenario: Turning tracking off withdraws a notification

- **WHEN** a terminal has an unread finished notification and a user turns off its **Track activity**
- **THEN** that notification is removed from the header Notifications list and the icon badge

#### Scenario: Process sends a notification from an untracked tab

- **WHEN** a process in an untracked terminal sends a notification through the control endpoint
- **THEN** that notification is delivered like any other

#### Scenario: Turning tracking back on

- **WHEN** an untracked terminal finished a command while untracked and a user then turns **Track activity** back on
- **THEN** no finished state or notification is shown for that earlier command, and activity that starts afterwards is shown as for any tracked terminal

#### Scenario: MCP still sees real activity

- **WHEN** an MCP client calls `get_terminal_status` or `wait_for_idle` on an untracked terminal that is running a command
- **THEN** it receives the terminal's real activity state

#### Scenario: Setting moves with the panel

- **WHEN** an untracked terminal is moved to another project or window
- **THEN** it stays untracked
