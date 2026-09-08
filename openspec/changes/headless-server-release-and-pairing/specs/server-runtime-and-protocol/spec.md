## MODIFIED Requirements

### Requirement: Standalone server operation

The standalone foreground command SHALL report readiness and a clear data and log location. The pairing command SHALL ask the running server, through the owner-only socket inside its data root, for its live pairing handoff and SHALL print a short-lived secure pairing URL for each active exposure mode; every device that opens one MUST be approved on the host with the match code. The pairing command SHALL fail with a clear message when no server owns the data root. The runtime SHALL handle `SIGINT` and `SIGTERM` with bounded graceful shutdown that finalizes recordings, closes clients, and terminates or preserves child processes according to the session-lifetime policy. Unsupported native dependencies SHALL fail during startup with actionable platform and architecture guidance.

#### Scenario: Foreground start

- **WHEN** the standalone server starts in the foreground
- **THEN** it emits a bounded readiness record naming the data and log locations

#### Scenario: Pairing command

- **WHEN** the operator runs the pairing command against a data root a live server owns
- **THEN** the printed pairing URL belongs to a room that server has registered
- **AND** a device that opens it reaches that server's approval queue and requires explicit approval

#### Scenario: Pairing command with no running server

- **WHEN** the operator runs the pairing command and no server owns the data root
- **THEN** the command fails with a message that names the missing server and prints no pairing material

#### Scenario: Termination signal

- **WHEN** the process receives `SIGINT` or `SIGTERM`
- **THEN** it performs bounded graceful shutdown, finalizing recordings and closing clients

#### Scenario: Unsupported native dependency

- **WHEN** a required native dependency is unsupported on the host
- **THEN** startup fails with actionable platform and architecture guidance

### Requirement: Standalone configuration and diagnostics

The foreground entry SHALL accept explicit `--data-root`, `--server-id`, `--endpoint`, `--log-sink`, `--ui-bundle`, `--hosted-domain`, `--expose`, and `--direct-origin` values with corresponding `TERMINAY_*` environment variables as fallbacks, and command-line values SHALL take precedence over environment values. `--hosted-domain` SHALL name the hosted signaling domain under which the server provisions its session origin and SHALL default to `terminay.com`. `--expose` SHALL accept `hosted`, `direct`, `hosted,direct`, or `off` and SHALL default to `off`. `--direct-origin` SHALL name the advertised HTTPS origin of the server's own signaling listener and SHALL be required when `direct` exposure is enabled. `--version` SHALL be diagnostic only. `--status` SHALL report phase, identity, version, runtime mode, enabled exposure modes, and configured-resource metadata without workspace names, paths, terminal data, device records, or secrets. Health and version diagnostics SHALL similarly expose no workspace, terminal, device, or secret content.

#### Scenario: Conflicting configuration sources

- **WHEN** both a command-line value and its `TERMINAY_*` environment variable are supplied
- **THEN** the command-line value takes precedence

#### Scenario: Direct exposure without an origin

- **WHEN** `--expose` includes `direct` and no `--direct-origin` is configured
- **THEN** startup fails before any listener opens and names the missing option

#### Scenario: Status output

- **WHEN** `--status` is invoked
- **THEN** the output contains only redacted phase, identity, version, runtime-mode, exposure-mode, and configured-resource metadata

#### Scenario: Readiness output

- **WHEN** a normal foreground start emits readiness
- **THEN** the local operator output may identify configured paths, the bound protocol endpoint, and one short-lived pairing handoff per active exposure mode

### Requirement: Release packaging validation

Release packaging SHALL publish, for every tagged release, one self-contained server archive per supported Linux architecture, named `terminay-server-<version>-linux-<arch>.tar.gz`, together with a SHA-256 sidecar and an Ed25519 signature over the archive bytes made with the release signing key. Release packaging SHALL validate the standalone distribution manifest, pinned Node engine, required CLI entrypoints, payload hashes, native architecture of the bundled Node and `node-pty`, and absence of Electron imports before publication. Native OS, architecture, and ABI probes SHALL remain release evidence. Native standalone release jobs SHALL establish a version-controlled checkout before building or probing the archive, and runner evidence SHALL be valid only when it binds the probed bytes to the checked-out commit and proves that worktree clean. A `main` prerelease SHALL be rebuilt with the same archives, sidecars, and signatures on every merge to `main`, and its assets SHALL be replaced so a reader sees either the previous complete set or the new complete set.

#### Scenario: Tagged release assets

- **WHEN** a release tag is published
- **THEN** the release carries a linux-x64 and a linux-arm64 server archive, each with a matching SHA-256 sidecar and Ed25519 signature

#### Scenario: Electron import in a server payload

- **WHEN** packaging detects an Electron import in the standalone payload
- **THEN** publication fails

#### Scenario: Architecture mismatch

- **WHEN** the bundled Node binary or `node-pty` addon does not match the archive's declared architecture
- **THEN** publication fails

#### Scenario: Rolling main prerelease

- **WHEN** a commit lands on `main`
- **THEN** the `main` prerelease is rebuilt with archives whose manifests record that commit

#### Scenario: Release evidence

- **WHEN** a native release job records probe evidence
- **THEN** the evidence binds the probed bytes to the checked-out commit and proves the worktree clean

### Requirement: Deterministic artifact manifest verification

Standalone packaging SHALL emit a deterministic `artifact-manifest.json` containing the package version, release channel (`tag` or `main`), built commit, target architecture, pinned Node engine, the exact `terminay-server` and `terminay-mcp` entrypoint paths, SHA-256 payload hashes, and provenance pointers. The verification script SHALL re-hash a candidate payload and fail on missing files, changed or additional executable bins, tampering, unsafe manifest paths, or Electron imports. This SHALL be a pre-release integrity check; signatures, notarization, and native release certification remain separate gates.

#### Scenario: Tampered payload

- **WHEN** a candidate payload's re-hashed contents do not match the manifest
- **THEN** verification fails

#### Scenario: Unexpected executable bin

- **WHEN** a candidate payload adds or changes an executable bin relative to the manifest
- **THEN** verification fails

#### Scenario: Channel and revision recorded

- **WHEN** an archive is built for a tag or for `main`
- **THEN** its manifest records the channel, the version, the commit, and the architecture

## ADDED Requirements

### Requirement: Live pairing lookup over the data-root socket

The running standalone server SHALL answer a `pairing` request on the owner-only data-root socket with its current pairing handoff for each enabled exposure mode: the pairing URL, its expiry, the exposure mode, and the server id. A request MAY ask for a fresh room, in which case the server SHALL rotate the pairing room without disturbing live peers or reconnect availability. The response SHALL contain no host key, device record, or application credential beyond the URL fragment, and the socket SHALL remain unreachable from any network listener.

#### Scenario: Current handoff

- **WHEN** an owner of the data root sends a `pairing` request
- **THEN** the response lists one live pairing URL per enabled exposure mode with its expiry

#### Scenario: Fresh room requested

- **WHEN** the request asks for a fresh room
- **THEN** a replacement room is registered and its URL returned
- **AND** live connections and reconnect registration are unchanged

#### Scenario: Exposure disabled

- **WHEN** no exposure mode is enabled
- **THEN** the response says so and carries no pairing URL
