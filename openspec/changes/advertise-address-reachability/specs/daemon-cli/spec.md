## MODIFIED Requirements

### Requirement: Advertised ICE address flag

`daemon install` and `daemon upgrade` SHALL accept `--advertise-address <host>:<port>`, validate it as a literal IPv4 or IPv6 address with a port before writing anything, record it in the install record, and write it into the service environment so the server offers it as an additional ICE candidate. `upgrade` with no `--advertise-address` SHALL keep the recorded value, because an upgrade is not the moment to change how a server is reached. `--advertise-address ''` SHALL remove it.

The CLI SHALL refuse a loopback host, naming the machine's routable address as the value to use instead. A browser is not obliged to send connectivity checks to a remote loopback candidate and Firefox does not, so a loopback address produces a server that pairs from one browser family and hangs with no diagnosis from the other. The routable address is reachable by every browser and is the address a published container port already answers on.

The CLI SHALL print, after an install that supplied one, the UDP port that must be reachable for the advertised candidate to work, because forwarding that port is a step the CLI cannot take on the operator's behalf.

#### Scenario: Install with an advertised address

- **WHEN** `daemon install --advertise-address 192.168.2.218:51000` runs
- **THEN** the service environment carries that address and port
- **AND** the install record carries it
- **AND** the output names UDP port 51000 as the port that must be reachable

#### Scenario: Malformed address is refused before anything is written

- **WHEN** `--advertise-address` is not a literal address and port
- **THEN** the command fails naming the value, and no unit, environment file, or version is written

#### Scenario: A hostname is refused

- **WHEN** `--advertise-address box.example.com:51000` runs
- **THEN** the command fails and says an ICE candidate must be a literal address

#### Scenario: A loopback address is refused

- **WHEN** `--advertise-address 127.0.0.1:51000` or `--advertise-address [::1]:51000` runs
- **THEN** the command fails, says a browser need not send connectivity checks to a loopback candidate, and tells the operator to use the machine's routable address
- **AND** no unit, environment file, or version is written

#### Scenario: Upgrade keeps the advertised address

- **WHEN** `daemon upgrade` runs with no `--advertise-address` on a server installed with one
- **THEN** the upgraded service keeps the recorded advertised address

#### Scenario: Clearing the advertised address

- **WHEN** `daemon upgrade --advertise-address ''` runs
- **THEN** the recorded advertised address is removed and the server returns to gathered candidates only

### Requirement: Documented local-container flow

The operations runbook SHALL document connecting Terminay Desktop to a server running in a container on the same machine: publishing the advertised UDP port, installing with `--advertise-address` naming the machine's routable address, and pairing through the hosted signaling service. It SHALL state why the container's own address does not work — on macOS and Windows the container runs inside a virtual machine whose network the client cannot route to, and `--network host` does not change that — so an operator who hits the failure recognises it rather than assuming the server is broken. Every documented example SHALL use a routable address, because a loopback example is a value the CLI refuses.

#### Scenario: An operator follows the container flow

- **WHEN** an operator wants to try a server in a local container
- **THEN** the runbook gives the `docker run` publishing the UDP port, the `daemon install` naming the machine's routable address, and the pairing step

### Requirement: Service unit and configuration

The CLI SHALL write an environment file readable only by the run-as account and a systemd unit whose `ExecStart` runs `<prefix>/current/bin/terminay-server`, restarts on failure, stops with `SIGTERM` within a bounded timeout, and carries `NoNewPrivileges=true` and `PrivateTmp=true`. The environment file SHALL set a stable server id defaulting to the machine hostname, the data root, the project root, `TERMINAY_EXPOSE` defaulting to `hosted,direct`, the hosted domain, a direct origin derived from the machine's primary address and the chosen port, agent integration enabled, AI providers disabled, and a loopback-only health endpoint. The CLI SHALL never write a vault passphrase, device key, or pairing material into the environment file or unit.

Install SHALL leave the running service on the configuration it just wrote. A service that is already running SHALL be restarted, because enabling a unit that is already active changes nothing and would leave the operator testing the previous configuration against the new output.

#### Scenario: Unit installed and enabled

- **WHEN** install completes
- **THEN** the unit is enabled and started and `daemon status` reports the server ready

#### Scenario: Re-installing with changed options takes effect

- **WHEN** `daemon install` runs on a machine whose service is already running and writes a different advertised address
- **THEN** the service is restarted and the running server carries the new address

#### Scenario: Secrets stay out of configuration

- **WHEN** the environment file and unit are written
- **THEN** they contain no passphrase, key, or pairing token

#### Scenario: Server id is stable

- **WHEN** the server is upgraded or reinstalled over the same data root
- **THEN** the server id in the environment file is unchanged
