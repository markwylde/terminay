# language-intelligence Specification

## Purpose
Terminay computes diagnostics, completion, hover, and definition for a project's files on the Terminay Server that owns them, from language servers contributed by extensions, behind a small core-owned protocol surface that keeps the Language Server Protocol off the application protocol and out of the client.

## Requirements

### Requirement: Language sessions are per project and language, shared and idle-reaped

The server SHALL keep language sessions keyed by project id and language server id. One session SHALL serve every client of that project. A session SHALL start on the first language request for a file it serves, and SHALL be stopped after a bounded idle period with no open documents and no requests. Each server SHALL enforce a cap on concurrent language sessions; a request that would exceed it SHALL return a typed unavailable outcome rather than starting a session. A session SHALL report a `starting`, `ready`, or `unavailable` state.

#### Scenario: Two clients open the same project

- **WHEN** two clients request language features for files in one project and language
- **THEN** both are served by the same language session rather than one session each

#### Scenario: Idle session

- **WHEN** a session has no open documents and receives no request for the bounded idle period
- **THEN** the session is shut down and its language server process exits

#### Scenario: Session cap reached

- **WHEN** a request would start a session beyond the server's concurrent session cap
- **THEN** the request returns a typed unavailable outcome and no session is started

### Requirement: Bounded core-owned language protocol surface

Terminay Server core SHALL own the language surface. `language.capabilities`, `language.completion`, `language.hover`, and `language.definition` SHALL be read-scoped queries with deadlines, and `language.diagnostics` SHALL be an event on the revisioned workspace journal. Request payloads SHALL carry a project id, a project-relative path, a document revision, and where the operation needs one, a position. Results SHALL carry the revision they were computed against and SHALL be bounded by a per-operation byte and item cap, marked with `isTruncated` when the cap truncates them. Language Server Protocol JSON-RPC and editor worker protocols SHALL NOT cross the application protocol.

#### Scenario: Completion query

- **WHEN** a client issues `language.completion` with a project id, project-relative path, revision, and position
- **THEN** the result carries that revision and is capped by bytes and items, with `isTruncated` set when it was truncated

#### Scenario: Raw language protocol traffic

- **WHEN** a language server produces Language Server Protocol JSON-RPC or editor worker messages
- **THEN** they stay on the server side and only bounded core-owned DTOs cross the application protocol

### Requirement: Document text comes from the editor, project state from disk

A client SHALL send a document's full text with a revision when it opens the document and when it changes. A request SHALL name the revision it was made against, a result SHALL carry that revision back, and a client SHALL drop a result whose revision is stale. The language session SHALL read every other file of the project from disk, and a change to a file on disk SHALL reach the session through the server's watch registry.

#### Scenario: Document changes while a query is in flight

- **WHEN** a result arrives for a revision older than the client's current document revision
- **THEN** the client drops the result and does not apply it to the editor

#### Scenario: A sibling file changes on disk

- **WHEN** a project file the editor has not opened changes on disk
- **THEN** the watch registry informs the language session so subsequent results reflect the change

### Requirement: Every language path is resolved by the canonical project resolver

The server SHALL resolve every path in a language payload through the canonical project resolver for the named project. An absolute path, or a path that escapes the project root, SHALL be rejected. A definition result SHALL name its target as a project-relative path and SHALL NOT expose a host filesystem path.

#### Scenario: Escaping path

- **WHEN** a language request names an absolute path or one that escapes the project root
- **THEN** the request is rejected and no language session is consulted

#### Scenario: Definition target

- **WHEN** a definition resolves to another file of the project
- **THEN** the result names it as a project-relative path and carries no host filesystem path

### Requirement: Diagnostics are pushed and other features are pulled

The session SHALL publish diagnostics as a `language.diagnostics` event per file on the workspace journal, debounced on the server so a burst of language server output becomes one event per file. Completion, hover, and definition SHALL be queries, debounced by the client, and a query superseded by a newer one SHALL be cancelled.

#### Scenario: Burst of diagnostics

- **WHEN** a language server publishes diagnostics for one file repeatedly within the debounce window
- **THEN** one `language.diagnostics` event for that file is written to the journal

#### Scenario: Superseded completion

- **WHEN** the client issues a completion query while an earlier one for the same document is in flight
- **THEN** the earlier query is cancelled and its result is not applied

### Requirement: A file is served by the language server whose selector matches it

For a given project file, the server SHALL select the contributed language server whose file selector matches it. When no contributed language server matches, `language.capabilities` SHALL report that no provider serves the file, the editor SHALL remain a highlighting and editing surface for it, and no error SHALL be surfaced to the user.

#### Scenario: Matching selector

- **WHEN** a file matches a contributed language server's selector
- **THEN** language requests for that file are served by that language server's session

#### Scenario: No provider for a file

- **WHEN** no contributed language server's selector matches the file
- **THEN** `language.capabilities` reports no provider, the editor stays highlighting-only, and no error is surfaced

### Requirement: Session failure degrades quietly

When a language server or its extension crashes, or a session fails to start or becomes unhealthy, in-flight and subsequent language requests for that session SHALL return a typed unavailable outcome. The editor SHALL degrade to highlighting and editing. The client SHALL NOT retry an unavailable session in a tight loop.

#### Scenario: Language server crashes

- **WHEN** a running language server exits unexpectedly
- **THEN** requests for its session return a typed unavailable outcome and the editor degrades to highlighting and editing

#### Scenario: Client sees unavailable

- **WHEN** a client receives a typed unavailable outcome
- **THEN** it does not immediately reissue the request in a retry loop

### Requirement: The client computes no language intelligence

Diagnostics, completion, hover, and definition SHALL be computed on the Terminay Server that owns the project, or not at all. A client SHALL NOT run a language service, a language worker, or a semantic analyser of its own to produce them.

#### Scenario: Feature with no server provider

- **WHEN** no language session can serve a file
- **THEN** the feature is absent rather than computed locally by the client
