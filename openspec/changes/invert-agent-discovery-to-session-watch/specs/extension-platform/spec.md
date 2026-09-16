## ADDED Requirements

### Requirement: Not-bound observation names the directories it awaits

An agent provider's observation result SHALL be able to report `not-bound` together with a list of terminal-scoped directory handles whose contents decide whether the provider can bind, each marked as the directory's own entries or its whole tree. Each handle SHALL be one the provider obtained through the same terminal context's file observation broker; a handle the context never issued SHALL be dropped, and a result whose handles are all dropped SHALL be treated as `not-bound` with no wait set. The extension child SHALL report only the canonical directory paths the broker resolved for those handles, bounded in number, and the host SHALL watch each such directory for that terminal incarnation, recursively only where the provider asked, and SHALL re-run the provider's observation on the first change in any of them. The host SHALL close those watches when the incarnation binds, is cancelled, or is retired, SHALL bound how many directories one incarnation holds open, and SHALL open no watch and schedule no timer for a `not-bound` result that names no directory.

#### Scenario: Provider awaits its session directory

- **WHEN** a provider returns `not-bound` naming a directory handle from its terminal context
- **THEN** the host watches that directory for the incarnation and re-runs observation when it changes

#### Scenario: Awaited handle the context never issued

- **WHEN** a provider names a directory handle its terminal context never resolved
- **THEN** the handle is dropped, no watch is opened for it, and a result with no remaining handles is treated as `not-bound` with nothing to await

#### Scenario: Tree and directory watches

- **WHEN** a provider names one directory as a tree and another as a plain directory
- **THEN** the host watches the first recursively and the second shallowly, and a directory named both ways is watched once, as a tree

#### Scenario: Incarnation retired while awaiting

- **WHEN** a terminal incarnation with open discovery watches is cancelled or retired
- **THEN** every watch opened for it is closed exactly once

#### Scenario: Nothing to await

- **WHEN** a provider returns `not-bound` with no directory handles
- **THEN** the host opens no watch and schedules no timer for that incarnation
