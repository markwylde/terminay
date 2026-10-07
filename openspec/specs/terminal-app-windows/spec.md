# terminal-app-windows Specification

## Purpose
App windows are small interactive views that an agent, or a connected MCP server's tool, shows over the terminal that asked for them. Each belongs to one terminal session and is presented, moved, minimised, and closed in that terminal's pane.

## Requirements

### Requirement: A window is presented only over its own terminal

A client SHALL present a window only while the terminal that owns it is shown: its project is the one in front and its terminal's pane is the presented pane of its group. While its terminal is not shown, a window SHALL NOT be visible, SHALL NOT receive pointer or keyboard input, and SHALL NOT cover any part of another terminal, another project, Home, or the workspace chrome. A terminal in a project that is not in front SHALL be treated as not shown whatever size its pane has in the layout. A window SHALL be positioned from its own terminal's pane and from no other.

#### Scenario: A window arrives while another project is in front

- **WHEN** a terminal in project A opens a window while the user is viewing project B
- **THEN** no window is visible over project B, and project A's tab badge and that terminal's tab badge pulse

#### Scenario: Returning to the project that asked

- **WHEN** the user then switches to project A with that terminal presented
- **THEN** the window is visible at its place over that terminal's pane and the badges stop pulsing

#### Scenario: Switching away from a project with an open window

- **WHEN** the user has an open window over a terminal in project A and switches to project B or to Home
- **THEN** the window is no longer visible and does not intercept clicks in what is now in front

#### Scenario: Two projects each have a window

- **WHEN** a terminal in project A and a terminal in project B each have an open window and the user views project B
- **THEN** only project B's window is visible
