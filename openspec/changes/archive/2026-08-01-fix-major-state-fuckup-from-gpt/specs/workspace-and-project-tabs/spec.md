## MODIFIED Requirements

### Requirement: Terminal removal and reconciliation

Sequentially closing every canonical terminal while another local panel stays visible SHALL remove each terminal exactly once and SHALL leave workspace reconciliation current; the final removal SHALL NOT strand an exited terminal presentation. Closing an already-exited terminal tab SHALL succeed while another live terminal remains, SHALL NOT wait on killing a finished PTY, SHALL NOT offer a connection retry that replaces the workspace transport, and SHALL NOT stall sibling terminals.

#### Scenario: Closing every terminal in sequence
- **WHEN** every canonical terminal is closed one after another while a local file panel remains visible
- **THEN** each is removed exactly once, reconciliation stays current, and no exited terminal presentation is stranded

#### Scenario: Closing an exited terminal
- **WHEN** an already-exited terminal tab is closed while another live terminal remains
- **THEN** the close succeeds without waiting on the finished PTY, without offering a transport-replacing retry, and without stalling siblings

### Requirement: Renderer detachment is not a panel close

Reloading or closing a renderer SHALL detach its presentation and SHALL NOT turn Dockview disposal into canonical panel-close commands. Restored renderers SHALL hydrate the same panels and terminal sessions and SHALL be able to type into still-running shells.

#### Scenario: Renderer reload
- **WHEN** a renderer reloads or closes
- **THEN** its presentation detaches, no canonical panel-close commands are issued, and a restored renderer hydrates the same panels and can type into still-running shells
