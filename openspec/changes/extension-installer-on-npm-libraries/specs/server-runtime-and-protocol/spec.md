## MODIFIED Requirements

### Requirement: Extension runtime hosting

The server SHALL include the extension installer needed by the extension platform while standalone support continues to require no system Node, npm, compiler, or browser. Official pinned extension tarballs SHALL be release inputs. Installed packages SHALL live under the writable server data root and SHALL NOT mutate the signed or content-addressed UI and application bundle. Each enabled extension SHALL run in a supervised server child process with bounded private IPC, and extension failure SHALL be provider-scoped and SHALL NOT prevent core or server readiness. Custom extensions remain trusted server-account code; process separation SHALL NOT be described as hostile-code sandboxing.

#### Scenario: Installing an extension

- **WHEN** an extension package is installed
- **THEN** it is written under the writable server data root and the signed bundle is unchanged

#### Scenario: Extension crash

- **WHEN** an enabled extension's child process fails
- **THEN** the failure is provider-scoped and core and server readiness are unaffected

#### Scenario: Standalone install without system npm

- **WHEN** an extension is installed on a standalone server whose host has no
  Node or npm
- **THEN** the server's own extension installer completes the install
