## MODIFIED Requirements

### Requirement: Native window reload preserves binding

Reloading a native window SHALL preserve its exact primary binding and its attached set. A reload is a load of the window's main frame; a frame loading inside the window's document, such as an app window's view, SHALL NOT be treated as a reload and SHALL leave every channel the document holds open. Desktop SHALL discard every document-scoped byte channel, reconnect each remembered profile in the composition with its OS-protected credential, and transfer a fresh channel per connection to the new document. A reload SHALL never change which connection is primary merely because a renderer transport was destroyed with the previous document.

#### Scenario: Remote window reload stays remote

- **WHEN** a window with attached remote connections is reloaded
- **THEN** each remote profile reconnects with its OS-protected credential and a fresh channel per connection is transferred to the new document

#### Scenario: A frame loading inside a remote window keeps its channel

- **WHEN** an app window's view loads inside a window attached to a remote server
- **THEN** the window keeps its channel and its session stays connected
- **AND** switching away and back, reloading, or relaunching Desktop reconnects to a working session
