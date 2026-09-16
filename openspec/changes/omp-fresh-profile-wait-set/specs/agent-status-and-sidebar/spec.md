## ADDED Requirements

### Requirement: omp names where its evidence will appear before it exists

When an omp sessions root or terminal-breadcrumb directory does not yet exist, the omp provider SHALL name the nearest existing directory above it, up to the terminal's home directory or the declared environment variable's root, as a shallow wait-set entry. Once the sessions root exists it SHALL be named as a tree, as it is for an established profile. The provider SHALL NOT name a home directory or environment root as a tree.

#### Scenario: Profile configured but never run

- **WHEN** omp is launched under a profile whose agent directory exists but holds no sessions or terminal-sessions directory
- **THEN** the provider names the agent directory shallowly, and the write that creates a sessions directory re-runs discovery

#### Scenario: Home with no omp directory

- **WHEN** omp is launched in a terminal whose home directory holds no omp directory at all
- **THEN** the provider names the home directory shallowly, never as a tree, and discovery re-runs when omp creates its directory
