## ADDED Requirements

### Requirement: Supervised commands never auto-launch a session bus

Every supervised command in a bot container SHALL get a session bus address set by the supervisor. This covers agent executions, trigger sources, shells and desktop launches. The address SHALL replace any value the caller supplied, including an empty or `autolaunch:` address. When the bot's desktop session bus is running, the address SHALL be that bus. Otherwise it SHALL be the disabled address. A D-Bus client that only opens the session bus SHALL therefore never start a session bus daemon.

#### Scenario: Command-line tool that uses a keyring

- **WHEN** a trigger source runs a command that opens the D-Bus session bus 35 times a minute for an hour
- **THEN** the bot container has no more `dbus-daemon` processes at the end of the hour than at the start

#### Scenario: Desktop not running

- **WHEN** a supervised command runs before the desktop session has started
- **THEN** its session bus address is the disabled address and no `dbus-daemon` is started for it

#### Scenario: Caller asks for auto-launch

- **WHEN** a supervised command is started with `DBUS_SESSION_BUS_ADDRESS=autolaunch:`
- **THEN** the command sees the desktop bus address or the disabled address instead

### Requirement: Process exhaustion is reported as its own cause

An execution or trigger check SHALL be recorded as having run out of processes only when it failed with an `EAGAIN` failure to create a process or thread and the container engine reports the container's process count within 16 of its limit. The reason SHALL then give the count and the limit and tell the user to restart the bot container. The server SHALL read the count and limit from the container engine, never by running a command inside the container.

#### Scenario: Agent cannot spawn

- **WHEN** the agent CLI fails with `spawn ... EAGAIN` while the container is at 1013 of 1024 processes
- **THEN** the execution's reason says the bot container has run out of processes, shows 1013 of 1024, and says to restart the bot container

### Requirement: EAGAIN without engine evidence is reported neutrally

When an `EAGAIN` failure to create a process or thread is seen but the engine cannot report the process count, or the count is not near the limit, the reason SHALL say that the agent could not start a process. The failure SHALL NOT be recorded as process exhaustion.

#### Scenario: Engine cannot report the count

- **WHEN** the agent fails with `EAGAIN` and the engine's stats do not include a process count
- **THEN** the reason says the agent could not start a process, and the failure is not recorded as process exhaustion

#### Scenario: Trigger check cannot spawn

- **WHEN** a trigger's condition command fails to start with `EAGAIN` while the container is at its process limit
- **THEN** the trigger's health error says the bot container has run out of processes, with the count and limit
