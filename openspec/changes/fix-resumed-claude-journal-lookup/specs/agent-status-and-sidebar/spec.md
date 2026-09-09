## ADDED Requirements

### Requirement: A session's journal is resolved by the session its process names

Claude Code SHALL resolve a bound session's journal from the session id its own pid-keyed session file names, rather than from the process working directory alone. The directory derived from that working directory SHALL be tried first. When no journal for that session exists there, Terminay SHALL make one bounded search for that session's journal below the provider's project root and SHALL accept a candidate only when the journal's own first record names the same session.

This resolution SHALL apply both to the initial binding and to a conversation switch inside a live session, so a conversation resumed from another directory binds and relabels the same way one started in place does.

#### Scenario: Conversation resumed in another directory

- **WHEN** a terminal runs a Claude Code conversation that was started in a different directory, and its journal is therefore filed under that other directory
- **THEN** the terminal binds that journal and shows its agent

#### Scenario: Journal beside the working directory

- **WHEN** the journal exists in the directory derived from the process working directory
- **THEN** it is bound without searching

#### Scenario: Switching to a conversation from another directory

- **WHEN** a bound session switches to a conversation whose journal is filed under a different directory
- **THEN** the row follows the new conversation rather than remaining on the retired one

### Requirement: An unresolved journal binds nothing

A search that cannot single out one journal for a session SHALL leave the terminal unbound rather than bind a candidate. A journal whose first record names a different session SHALL be rejected. More than one surviving candidate SHALL bind nothing. A search stopped early by host listing limits SHALL bind nothing, and ordinary discovery retries SHALL remain free to resolve it later.

#### Scenario: Journal names a different session

- **WHEN** a candidate journal's first record names a session other than the one being resolved
- **THEN** it is rejected and the terminal remains unbound

#### Scenario: Search reaches a listing limit

- **WHEN** host listing limits stop the search before the journal is found
- **THEN** the terminal remains unbound and no partial or guessed binding is published

#### Scenario: Two candidates for one session

- **WHEN** more than one journal survives verification for the same session id
- **THEN** nothing is bound

## MODIFIED Requirements

### Requirement: Heuristics never establish binding

CWD, filename timestamps, terminal title, active tab, and closest-match logic SHALL NOT independently establish an authoritative binding. Claude Code SHALL use the pid-keyed session file its own descendant process wrote to name the session that process holds, and SHALL then resolve that exact session's journal — by the directory derived from the process CWD where it exists, otherwise by a bounded search for that session id whose result is verified against the journal's own first record. Neither the search nor the CWD selects between conversations: the process's own file names the session, and the journal must name it back. OMP SHALL use its own terminal-scoped breadcrumb whose terminal ID derives from the PTY TTY running OMP and whose target is validated under OMP's allowed session root. A host that cannot establish provider proof SHALL use terminal fallback.

#### Scenario: Nearest-timestamp candidate

- **WHEN** a candidate journal matches only by timestamp, filename, terminal title, or proximity
- **THEN** it is not admitted as an authoritative binding

#### Scenario: Session named by the process, journal named by itself

- **WHEN** a Claude Code journal is resolved for a bound session
- **THEN** the session id comes from the process's own pid-keyed file and the journal's own first record must name that same session
