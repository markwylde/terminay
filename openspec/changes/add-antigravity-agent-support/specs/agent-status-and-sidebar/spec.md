## MODIFIED Requirements

### Requirement: Provider ids are extension contributions

Session source ids SHALL be namespaced extension contributions rather than a closed core union, and every entry SHALL carry the source id and the harness name the source reported. Terminay SHALL bundle one enabled-by-default session source reporting Claude Code, Codex, Grok, oh-my-pi, and Antigravity sessions. A third-party source SHALL participate through the same validated manifest, hosted runtime, snapshot, Settings, and disablement contracts. Persisted unknown or disabled source ids SHALL remain bounded metadata and SHALL NOT cause extension code to load in a client.

#### Scenario: Third-party provider

- **WHEN** a third-party session source extension is installed
- **THEN** it participates through the same manifest, runtime, snapshot, Settings, and disablement contracts as the bundled source

#### Scenario: Unknown persisted provider id

- **WHEN** persisted state references an unknown or disabled source id
- **THEN** it remains bounded metadata and no extension code loads in a client
