## MODIFIED Requirements

### Requirement: Canonical metadata mutation

The title command SHALL replace the terminal's display title. The note command SHALL replace or fill the terminal note. Both updates SHALL be canonical server mutations that the server applies to the terminal panel as part of the generation request, and SHALL reach every authorized connected client. A client SHALL present a generated title or note only as it appears in server workspace state and SHALL NOT apply the generated text to its own presentation independently. A generated title or note SHALL persist exactly as a manually entered one does.

#### Scenario: Title applied

- **WHEN** a generated title is applied
- **THEN** the terminal's display title is replaced through a canonical server mutation

#### Scenario: Note applied

- **WHEN** a generated note is applied
- **THEN** the terminal note is replaced or filled through a canonical server mutation

#### Scenario: Multiple connected clients

- **WHEN** a metadata update is confirmed by the server
- **THEN** every authorized connected client sees the same update

#### Scenario: Generated title survives later workspace changes

- **WHEN** a title has been generated for a terminal and the workspace then changes, such as another terminal being opened
- **THEN** the terminal still shows the generated title

#### Scenario: Generated metadata survives a fresh client

- **WHEN** a client reconnects or reloads after a title or note was generated
- **THEN** it shows the generated title and note from server state

### Requirement: Revision-checked application

Each terminal panel SHALL carry a metadata revision that advances whenever its title or note changes. The server SHALL capture that revision when a generation request starts and SHALL apply the result only if the revision is unchanged, checking and applying as one step. A concurrent manual edit SHALL produce a conflict instead of being overwritten, and the client SHALL be able to retry against the new revision.

#### Scenario: Concurrent manual edit

- **WHEN** a user manually edits the title or note while generation is in flight
- **THEN** applying the generated result produces a conflict and the manual edit is preserved

#### Scenario: Retry after conflict

- **WHEN** a client receives a revision conflict
- **THEN** it can retry the generation against the new revision

#### Scenario: Unrelated change does not conflict

- **WHEN** a terminal's colour or emoji, or another terminal's title, changes while generation is in flight
- **THEN** the generated result is still applied

## ADDED Requirements

### Requirement: Generation progress indication

While a title generation is in flight, the requesting client SHALL show a pending indication on that terminal's tab. The indication SHALL be transient client presentation: it SHALL NOT change the terminal's title in server state and SHALL NOT be visible to other clients as a title. When the request completes or fails, the tab SHALL show the terminal's canonical title.

#### Scenario: Pending indication during generation

- **WHEN** a user invokes **Set tab title with AI** and the provider has not yet answered
- **THEN** the requesting client's tab shows that a title is being generated
- **AND** the terminal's title in server state is unchanged

#### Scenario: Failure restores the canonical title

- **WHEN** a title generation fails or is rejected with a conflict
- **THEN** the tab shows the terminal's current canonical title

### Requirement: Identical generation behaviour on every server

A Terminay Server embedded in Desktop and a standalone Terminay Server SHALL resolve the generation target, check its metadata revision, and apply the resulting mutation through the same server implementation, and SHALL produce the same results and errors for the same request.

#### Scenario: Standalone server generates a title

- **WHEN** a client connected to a standalone Terminay Server with an enabled provider invokes **Set tab title with AI**
- **THEN** the terminal's canonical title is replaced with the generated title

#### Scenario: Embedded server generates a title

- **WHEN** a Desktop client using its embedded server invokes **Set tab title with AI**
- **THEN** the terminal's canonical title is replaced with the generated title
