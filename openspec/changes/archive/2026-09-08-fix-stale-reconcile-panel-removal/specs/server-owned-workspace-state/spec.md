## ADDED Requirements

### Requirement: Presentation reconciliation follows the newest projection

A client SHALL reconcile its presentation only against the newest workspace
projection it has confirmed. A reconciliation pass that is deferred, retried, or
superseded SHALL read the current projection when it runs rather than replaying
the projection it was scheduled with, and a newer projection SHALL cancel every
pass still pending from an older one.

A reconciliation pass SHALL NOT remove a panel that the newest confirmed
projection still contains. Because canonical panel removal closes the terminal
session behind it, a pass that has fallen behind the confirmed projection can
neither remove a presented panel nor end a live terminal session.

#### Scenario: Retried reconciliation reads the current projection

- **WHEN** a reconciliation pass is retried after the client has confirmed a newer
  projection
- **THEN** it reconciles against the newer projection, and no panel that
  projection contains is removed

#### Scenario: Terminals created while another window presents a project

- **WHEN** the user creates terminals in one window while another window presents
  a project of the same workspace
- **THEN** every created terminal keeps its tab and its live session

#### Scenario: Sessions this window does not present

- **WHEN** the workspace projection holds terminal sessions that this window does
  not present
- **THEN** they leave the panels this window does present untouched
