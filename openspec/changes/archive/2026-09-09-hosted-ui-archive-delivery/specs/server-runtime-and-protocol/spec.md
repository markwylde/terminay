## ADDED Requirements

### Requirement: A standalone artifact carries a servable workspace UI

A standalone server artifact SHALL contain the server-served workspace UI — the same bundle an embedded server hands its renderer — including the entry file the hosted UI archive loader reads. The Desktop renderer bundle is a different artifact with a different entry and SHALL NOT be staged in its place.

Building an artifact whose staged UI cannot satisfy the hosted archive loader SHALL fail, naming the missing entry, and probing an already-built artifact whose UI cannot SHALL fail the same way. A published artifact that cannot serve a workspace to a paired device is not a releasable artifact, and neither the build nor the probe may pass one.

#### Scenario: The staged UI carries the hosted entry

- **WHEN** a standalone artifact is built
- **THEN** its `ui/` directory contains the entry the hosted UI archive loader reads
- **AND** that entry is the server-served workspace UI, not the Desktop renderer bundle

#### Scenario: A UI without the hosted entry fails the build

- **WHEN** the staged UI has no hosted archive entry
- **THEN** the build fails and names the entry it looked for

#### Scenario: A built artifact is probed for a servable UI

- **WHEN** a built artifact is probed
- **THEN** the probe fails unless its `ui/` directory carries the hosted archive entry

### Requirement: A server without a renderer directory says so

A standalone server configured to expose itself SHALL treat a missing renderer directory as a configuration failure rather than serving a placeholder workspace. A device that pairs successfully and then receives a page with no workspace in it cannot tell a broken server from a broken network, and the server is the only party that knows which.

#### Scenario: Exposed with no renderer directory

- **WHEN** a server is exposed and no renderer directory is configured
- **THEN** it reports that its workspace UI is not configured, rather than serving a placeholder to a paired device

#### Scenario: Renderer directory present

- **WHEN** a renderer directory is configured and carries the hosted entry
- **THEN** a paired device receives that workspace UI
