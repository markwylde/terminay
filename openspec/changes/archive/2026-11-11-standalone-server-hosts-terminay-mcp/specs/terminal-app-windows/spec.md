## MODIFIED Requirements

### Requirement: App windows capability and host parity

App windows SHALL be offered behind a protocol capability, and a client that does not negotiate it SHALL behave as though no terminal has windows. Every Terminay Server, embedded in Desktop or standalone, SHALL offer app windows, the view mirror, and attachments. Placement, the rail, tabs, badges, the view contract, and isolation SHALL be identical in the Desktop and browser hosts, and SHALL be usable by touch on a phone-width client.

#### Scenario: Older client

- **WHEN** a client that lacks the capability attaches to a terminal that has windows
- **THEN** it shows the terminal as usual with no window, tab, rail, or badge

#### Scenario: Same window on both hosts

- **WHEN** the same window is opened in the Desktop host and in a browser host at the same pane size
- **THEN** its placement, controls, and behaviour are the same

#### Scenario: Window on a standalone server

- **WHEN** an agent in a terminal on a standalone server calls `show_window`
- **THEN** the window opens beside that terminal in the client presenting it, as it would on Desktop's own server
