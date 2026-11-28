## ADDED Requirements

### Requirement: Server desktop display environment

The host baseline of a newly launched terminal SHALL carry `DISPLAY` naming the server desktop's display and `XAUTHORITY` naming its authority cookie file whenever the server desktop is running at the moment of launch, so a graphical program started from the terminal opens on the server desktop. The server SHALL decide this for each launch, including a launch made through a session holder that outlived a server restart.

The two variables are baseline values, not protected ones: a profile overlay that sets or nulls either SHALL take effect. The server SHALL NOT add them when the desktop is not running, and SHALL NOT replace a display the server's own environment already names: where the server process itself has `DISPLAY` or `WAYLAND_DISPLAY`, launched terminals SHALL keep those values. A terminal that is already running SHALL NOT be changed.

#### Scenario: Graphical program from a new terminal

- **WHEN** a terminal is opened on a headless server whose desktop is running and the user runs a graphical program in it
- **THEN** the program's window opens on the server desktop without the user setting any variable

#### Scenario: Naming the display explicitly

- **WHEN** a user runs a graphical program with `DISPLAY` set to the server desktop's display number in a terminal that has the desktop's `XAUTHORITY`
- **THEN** the program's window opens on the server desktop

#### Scenario: Desktop started after the server

- **WHEN** the desktop starts while the server is running and a terminal is opened afterwards
- **THEN** that terminal has the display environment, and terminals opened earlier do not

#### Scenario: Profile overrides the display

- **WHEN** a profile's environment overlay sets `DISPLAY` to another value
- **THEN** terminals launched with that profile receive the profile's value

#### Scenario: Desktop not running

- **WHEN** a terminal is opened on a server whose desktop is off or not set up
- **THEN** the terminal's environment has no `DISPLAY` or `XAUTHORITY` added by Terminay

#### Scenario: Server that already has a display

- **WHEN** the server process itself runs with `DISPLAY` set
- **THEN** launched terminals keep that value and Terminay does not replace it
