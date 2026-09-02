## ADDED Requirements

### Requirement: Extensions management routes

The client SHALL present an Extensions route in both wide and narrow layouts, with search, a list, a detail view, the dependants that block an action, and the extension lifecycle actions. Desktop native auxiliary routes and browser in-page routes SHALL issue the same semantic commands against the same server-owned state.

#### Scenario: Blocked action reports its dependants

- **WHEN** an extension cannot be disabled or uninstalled because another record depends on it
- **THEN** the route reports the blocking dependants instead of offering the action

### Requirement: Catalogue preview and provenance disclosure

The Extensions route SHALL present official and custom catalogue previews. Before a custom installation is confirmed, it SHALL disclose the extension's requested permissions, its provenance facts, and the audit facts the server records, and SHALL warn that extension code runs on the selected server. Extension-supplied HTML or code SHALL NOT be rendered, and secrets SHALL NOT be displayed.

#### Scenario: Custom installation review

- **WHEN** the user reviews a custom extension before installing it
- **THEN** requested permissions, provenance, and audit facts are shown together with the selected-server trusted-code warning

#### Scenario: Contributions stay declarative

- **WHEN** an extension contributes UI
- **THEN** it is rendered from its declarative contribution and no extension-supplied HTML or code is executed in the client
