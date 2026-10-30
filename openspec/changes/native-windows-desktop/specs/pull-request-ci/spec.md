## ADDED Requirements

### Requirement: Windows platform decisions are tested on every pull request

Every decision that the server, session holder, or Desktop main process makes
differently on Windows SHALL be a function of an injected platform and host. On
every pull request, the Linux CI jobs SHALL run unit tests that pass Windows
inputs to those functions. That covers shell discovery and launch arguments,
holder enablement and pipe naming, control-pipe naming, process-table parsing
and foreground selection, the Trace2 directory target, and update-metadata
selection. No CI job SHALL decide its test inputs from `process.platform`.

#### Scenario: A Windows-only branch regresses

- **WHEN** a pull request changes the Windows pipe name so that it no longer
  includes the user's security identifier
- **THEN** a Linux CI job fails before the pull request can merge

### Requirement: Native Windows behaviour is verified after merge

Pull-request CI SHALL NOT be taken to prove native Windows behaviour. The
packaged Windows probe SHALL run on every `main` prerelease and every tag
release. A failure SHALL withhold that run's Windows assets and fail that run.

#### Scenario: A merge breaks ConPTY

- **WHEN** a merged change stops PowerShell from starting in the packaged
  Windows build
- **THEN** the `main` prerelease run fails, no Windows asset or `beta.yml` is
  replaced, and Windows beta clients stay on the previous build
