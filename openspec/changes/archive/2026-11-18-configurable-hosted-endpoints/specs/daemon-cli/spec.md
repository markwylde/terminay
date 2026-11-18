## MODIFIED Requirements

### Requirement: Service unit and configuration

The CLI SHALL write an environment file readable only by the run-as account and a systemd unit whose `ExecStart` runs `<prefix>/current/bin/terminay-server`, restarts on failure, stops with `SIGTERM` within a bounded timeout, and carries `NoNewPrivileges=true` and `PrivateTmp=true`. The environment file SHALL set a stable server id defaulting to the machine hostname, the data root, the project root, `TERMINAY_EXPOSE` defaulting to `hosted,direct`, the App Server and Session Server defaulting to the production values, a direct origin derived from the machine's primary address and the chosen port, agent integration enabled, AI providers disabled, and a loopback-only health endpoint. The CLI SHALL never write a vault passphrase, device key, or pairing material into the environment file or unit.

Install SHALL leave the running service on the configuration it just wrote. A service that is already running SHALL be restarted, because enabling a unit that is already active changes nothing and would leave the operator testing the previous configuration against the new output.

#### Scenario: Unit installed and enabled

- **WHEN** install completes
- **THEN** the unit is enabled and started and `daemon status` reports the server ready

#### Scenario: Re-installing with changed options takes effect

- **WHEN** `daemon install` runs on a machine whose service is already running and writes a different advertised address
- **THEN** the service is restarted and the running server carries the new address

#### Scenario: Hosted endpoints are written

- **WHEN** `daemon install` runs with `--app-server` and `--session-server`
- **THEN** the environment file sets `TERMINAY_APP_SERVER` and `TERMINAY_SESSION_SERVER` to those values

#### Scenario: Secrets stay out of configuration

- **WHEN** the environment file and unit are written
- **THEN** they contain no passphrase, key, or pairing token

#### Scenario: Server id is stable

- **WHEN** the server is upgraded or reinstalled over the same data root
- **THEN** the server id in the environment file is unchanged
