## MODIFIED Requirements

### Requirement: Standalone configuration and diagnostics

The foreground entry SHALL accept explicit `--data-root`, `--server-id`, `--endpoint`, `--log-sink`, `--ui-bundle`, `--app-server`, `--session-server`, `--expose`, and `--direct-origin` values with corresponding `TERMINAY_*` environment variables as fallbacks, and command-line values SHALL take precedence over environment values. `--app-server` SHALL name the connection-manager origin that hosted pairing links point at and SHALL default to `https://app.terminay.com`. `--session-server` SHALL name the session-origin template from which the server provisions its session origin. The template contains `<session>` once, in its leftmost label, and SHALL default to `https://<session>.terminay.com`. `--expose` SHALL accept `hosted`, `direct`, `hosted,direct`, or `off` and SHALL default to `off`. `--direct-origin` SHALL name the advertised HTTPS origin of the server's own signaling listener and SHALL be required when `direct` exposure is enabled. `--version` SHALL be diagnostic only. `--status` SHALL report phase, identity, version, runtime mode, enabled exposure modes, and configured-resource metadata without workspace names, paths, terminal data, device records, or secrets. Health and version diagnostics SHALL similarly expose no workspace, terminal, device, or secret content. For every protocol connection that the server fails or that closes, it SHALL write one JSON line to stderr and the configured log sink naming the route (`hosted` or `local`), the close class, and the queued byte and frame counts, and nothing that identifies the client, its address, or the connection's content.

#### Scenario: Conflicting configuration sources

- **WHEN** both a command-line value and its `TERMINAY_*` environment variable are supplied
- **THEN** the command-line value takes precedence

#### Scenario: Direct exposure without an origin

- **WHEN** `--expose` includes `direct` and no `--direct-origin` is configured
- **THEN** startup fails before any listener opens and names the missing option

#### Scenario: Invalid hosted endpoints

- **WHEN** `--app-server` or `--session-server` breaks the hosted-endpoint rules
- **THEN** startup fails before any listener opens and names the offending option

#### Scenario: Status output

- **WHEN** `--status` is invoked
- **THEN** the output contains only redacted phase, identity, version, runtime-mode, exposure-mode, and configured-resource metadata

#### Scenario: Readiness output

- **WHEN** a normal foreground start emits readiness
- **THEN** the local operator output may identify configured paths, the bound protocol endpoint, and one short-lived pairing handoff per active exposure mode

#### Scenario: A protocol connection ends

- **WHEN** a hosted or local protocol connection is failed by the server or closes
- **THEN** one `server-connection` record names its route, close class, and queued bytes and frames
- **AND** it carries no client identity, address, or protocol payload
