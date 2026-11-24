## MODIFIED Requirements

### Requirement: Environment overview

Environment › Overview SHALL show:

- the bot's environment state and uptime;
- the image, and whether the container is current;
- the home volume;
- the resource limits;
- the shared engine proxy and its attribution rules;
- the lifecycle actions.

It SHALL show CPU use, memory use, and home size as read when the Overview opened, with a **Refresh** action. It SHALL NOT sample them on a timer. It SHALL show the container's recent log, capped at its last 256 KiB, with injected secrets redacted.

The Overview SHALL render from the container's state without waiting for CPU, memory, home size, the log, or an engine security probe. Until those figures are read, it SHALL show them as being read. A figure that could not be read SHALL be shown as unavailable, never as zero. Lifecycle changes SHALL re-read state only.

#### Scenario: Refresh usage

- **WHEN** a user chooses Refresh on a running bot's Overview
- **THEN** CPU, memory, and home size are read again and shown with the time they were read

#### Scenario: Overview renders before usage

- **WHEN** a user opens a bot's Overview and measuring its home takes several seconds
- **THEN** the state, image, limits, and lifecycle actions are shown at once, and home size shows as being read until it arrives

#### Scenario: Usage cannot be read

- **WHEN** the Overview's state is shown and reading usage then fails
- **THEN** the state stays shown, the figures show as unavailable rather than being read, the failure is shown, and Refresh reads them again

#### Scenario: Lifecycle change does not measure

- **WHEN** a user starts or stops a bot from its Overview
- **THEN** the Overview shows the new state without reading CPU, memory, home size, or the log

### Requirement: Shell

Environment › Shell SHALL open an interactive terminal in the bot's container, as the `bot` user, in `/home/bot`, while the container runs. Opening it SHALL NOT start the container, and the server SHALL refuse a shell while the container is not running. The terminal SHALL render, resize, copy, and paste like a Terminay terminal. It SHALL count as activity for idle stop. Closing it SHALL end the shell process.

#### Scenario: Open a shell

- **WHEN** a user opens Shell on a running bot and types `whoami`
- **THEN** the terminal prints `bot`

#### Scenario: Shell on a stopped bot

- **WHEN** a user opens Shell on a stopped bot
- **THEN** the container stays stopped and no shell is opened

#### Scenario: Machine stops before the shell opens

- **WHEN** a client asks to open a shell just as the bot's container stops
- **THEN** the server refuses it as the machine not being started, and does not start the container

## ADDED Requirements

### Requirement: Machine not running

While a bot's container is not running, Environment › Shell and Environment › Desktop SHALL show the machine's state instead of the view, with one action that brings it up. A stopped or not-created machine SHALL NOT be shown as an error; a failure to start SHALL be shown with its cause. The view SHALL open whenever the container runs, whatever started it.

#### Scenario: Desktop on a stopped bot

- **WHEN** a user opens Desktop on a stopped bot
- **THEN** it shows "Machine not started." with **Start machine**, shows no error, and opens no desktop stream

#### Scenario: Start from the panel

- **WHEN** a user chooses **Start machine** in Shell on a stopped bot
- **THEN** the container starts, and the shell opens once it runs

#### Scenario: Bot not created

- **WHEN** a user opens Shell on a bot whose container has never been created
- **THEN** it shows that the machine is not created, with **Create machine**

#### Scenario: Machine failed

- **WHEN** a user opens Desktop on a bot whose container failed
- **THEN** it shows that the machine failed to start, with **Try again**

#### Scenario: Machine starting

- **WHEN** a user opens Shell while the bot's container is starting
- **THEN** it shows that the machine is starting, with no available action, and opens the shell once it runs

#### Scenario: Start fails

- **WHEN** a user chooses **Start machine** and the start is refused
- **THEN** the panel shows the refusal's cause

#### Scenario: Machine stops while a view is open

- **WHEN** a bot's container stops while its Desktop is open
- **THEN** the desktop gives way to "Machine not started." with **Start machine**
