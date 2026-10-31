## MODIFIED Requirements

### Requirement: Supported-architecture release verification

Built-in extension artifacts SHALL be verified on the declared supported distribution matrix: Terminay Desktop on macOS arm64, GNU/Linux x64, and Windows x64, and standalone Terminay Server on GNU/Linux x64 and arm64. Verification SHALL run from a clean dependency install, SHALL assert the runtime and machine architecture it claims to prove, and SHALL NOT accept an emulated build as evidence for an architecture it did not natively execute. The Electron resource inventory and the standalone payload inventory SHALL be byte-identical.

#### Scenario: Architecture assertion

- **WHEN** a packaged built-in lifecycle job runs on a release runner
- **THEN** it asserts the runtime and machine architecture before running the offline lifecycle check

#### Scenario: Emulated build

- **WHEN** an architecture is exercised only through emulation
- **THEN** the run is not accepted as evidence for that architecture

#### Scenario: Inventory parity

- **WHEN** the Electron and standalone inventories for one release are compared
- **THEN** they are byte-identical and rehash to the same built-in packages

#### Scenario: Windows built-ins

- **WHEN** the packaged Windows build starts on the Windows release runner
- **THEN** every built-in extension that supports Windows activates, and each native module it loads is the win32-x64 build

#### Scenario: A built-in for other platforms

- **WHEN** a built-in extension's manifest declares platforms that exclude the server's platform
- **THEN** the server records it as incompatible rather than failed, never activates it, and Settings shows it as not available on that platform
- **AND** a desktop connected to a server on a supported platform still gets the extension from that server
