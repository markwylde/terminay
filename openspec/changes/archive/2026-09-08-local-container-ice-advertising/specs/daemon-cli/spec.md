## ADDED Requirements

### Requirement: Advertised ICE address flag

`daemon install` and `daemon upgrade` SHALL accept `--advertise-address <host>:<port>`, validate it as a literal IPv4 or IPv6 address with a port before writing anything, record it in the install record, and write it into the service environment so the server offers it as an additional ICE candidate. `upgrade` with no `--advertise-address` SHALL keep the recorded value, because an upgrade is not the moment to change how a server is reached. `--advertise-address ''` SHALL remove it.

The CLI SHALL print, after an install that supplied one, the UDP port that must be reachable for the advertised candidate to work, because forwarding that port is a step the CLI cannot take on the operator's behalf.

#### Scenario: Install with an advertised address

- **WHEN** `daemon install --advertise-address 127.0.0.1:51000` runs
- **THEN** the service environment carries that address and port
- **AND** the install record carries it
- **AND** the output names UDP port 51000 as the port that must be reachable

#### Scenario: Malformed address is refused before anything is written

- **WHEN** `--advertise-address` is not a literal address and port
- **THEN** the command fails naming the value, and no unit, environment file, or version is written

#### Scenario: A hostname is refused

- **WHEN** `--advertise-address box.example.com:51000` runs
- **THEN** the command fails and says an ICE candidate must be a literal address

#### Scenario: Upgrade keeps the advertised address

- **WHEN** `daemon upgrade` runs with no `--advertise-address` on a server installed with one
- **THEN** the upgraded service keeps the recorded advertised address

#### Scenario: Clearing the advertised address

- **WHEN** `daemon upgrade --advertise-address ''` runs
- **THEN** the recorded advertised address is removed and the server returns to gathered candidates only

### Requirement: Status reports the advertised address

`daemon status` SHALL report the advertised ICE address when one is configured. It is service configuration an operator needs when a connection fails, and it names no workspace, path, account, or device.

#### Scenario: Status shows the advertised address

- **WHEN** `daemon status` runs on a server configured with an advertised ICE address
- **THEN** the report includes that address and port

#### Scenario: Status omits it when unset

- **WHEN** `daemon status` runs on a server with no advertised ICE address
- **THEN** the report does not mention one

### Requirement: Documented local-container flow

The operations runbook SHALL document connecting Terminay Desktop to a server running in a container on the same machine: publishing the advertised UDP port, installing with `--advertise-address`, and pairing through the hosted signaling service. It SHALL state why the container's own address does not work — on macOS and Windows the container runs inside a virtual machine whose network the client cannot route to, and `--network host` does not change that — so an operator who hits the failure recognises it rather than assuming the server is broken.

#### Scenario: An operator follows the container flow

- **WHEN** an operator wants to try a server in a local container
- **THEN** the runbook gives the `docker run` publishing the UDP port, the `daemon install` naming it, and the pairing step
