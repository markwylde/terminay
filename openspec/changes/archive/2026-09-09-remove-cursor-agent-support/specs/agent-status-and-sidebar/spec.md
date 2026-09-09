## MODIFIED Requirements
### Requirement: Foreground process matching

Process-name matching SHALL be a prompt rather than proof. `codex` and `codex-tui` SHALL bind Codex and `grok` SHALL bind Grok, while an unmatched `node` or `bun` wrapper SHALL try every capable provider until one proves a writer-held journal. Observation SHALL also inspect the PTY shell PID itself so an `exec`'d CLI still has its open files examined. The Grok CLI's `agent` symlink SHALL NOT be a Grok process matcher, because a bare `agent` name is not evidence of any particular provider.

#### Scenario: Recognized provider name

- **WHEN** the terminal's foreground process is named `codex` or `codex-tui`
- **THEN** the Codex provider is attempted for binding

#### Scenario: Generic wrapper name

- **WHEN** the terminal's foreground process is a `node` or `bun` wrapper
- **THEN** every capable provider is tried until one proves a writer-held journal

#### Scenario: Exec'd CLI

- **WHEN** a CLI replaces the shell through `exec`
- **THEN** observation inspects the PTY shell PID's own open files

#### Scenario: Grok launched as `agent`

- **WHEN** a process appears under the `agent` executable name
- **THEN** it does not match Grok

### Requirement: Provider ids are extension contributions

Provider ids SHALL be namespaced extension contributions rather than a closed core union. Terminay SHALL bundle enabled-by-default Codex, Claude Code, Grok, OpenCode, and omp providers. A third-party provider SHALL appear through the same validated manifest, hosted runtime, canonical event, Settings, and disablement contracts. Persisted unknown or disabled provider ids SHALL remain bounded metadata and SHALL NOT cause provider code to load in a client.

#### Scenario: Third-party provider

- **WHEN** a third-party agent provider extension is installed
- **THEN** it participates through the same manifest, runtime, canonical event, Settings, and disablement contracts as the bundled providers

#### Scenario: Unknown persisted provider id

- **WHEN** persisted state references an unknown or disabled provider id
- **THEN** it remains bounded metadata and no provider code loads in a client

## REMOVED Requirements

### Requirement: Cursor Agent binding and privacy

**Reason:** Cursor Agent support is removed. Its only authentication is a monthly subscription with no metered API key, so the provider cannot be verified against its real CLI the way every other bundled provider now is.

### Requirement: Cursor Agent record mapping

**Reason:** Cursor Agent support is removed. Its only authentication is a monthly subscription with no metered API key, so the provider cannot be verified against its real CLI the way every other bundled provider now is.

### Requirement: Cursor waiting states and task calls are not projected

**Reason:** Cursor Agent support is removed. Its only authentication is a monthly subscription with no metered API key, so the provider cannot be verified against its real CLI the way every other bundled provider now is.
