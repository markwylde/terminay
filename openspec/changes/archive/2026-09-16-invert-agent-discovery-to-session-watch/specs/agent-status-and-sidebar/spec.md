## MODIFIED Requirements

### Requirement: Discovery windows and retries

Every transition away from the shell SHALL start a journal-discovery attempt even when the foreground name is not a recognized provider, so a resumed session launched long after terminal startup can bind its reopened journal without treating the wrapper as an agent. Discovery SHALL run once after terminal startup and once whenever the shell loses foreground. A blank or unknown process name SHALL NOT be a leave-shell edge and SHALL NOT start discovery.

A discovery attempt SHALL be re-run only when a change is observed in a directory the provider named as the reason it could not bind. A provider that reports `not-bound` SHALL name the directories whose contents decide its answer; the runtime SHALL watch exactly those directories for the current foreground incarnation and SHALL re-run observation on the first change in any of them. A `not-bound` result that names no directory SHALL end discovery for that incarnation until the next foreground edge. No timer SHALL re-run observation, and the runtime SHALL NOT sample the process table or open-file table to decide whether to re-run observation.

Re-observation SHALL be damped by the shared ramping schedule: the first change after a quiet period SHALL re-run observation promptly, and sustained churn in a watched directory SHALL widen the minimum interval between runs to its ceiling. Changes arriving inside an interval SHALL collapse into exactly one run at its end. A provider whose observation throws SHALL be treated as `not-bound` with the directories it named on its previous attempt, or with none if it never named any.

An empty process snapshot SHALL be treated as ordinary transient evidence rather than a reason to give up: the provider SHALL still name the directory its session record will appear in, so the attempt is re-run when that record is written.

Watches opened for discovery SHALL be closed when the incarnation binds, returns to the shell, is replaced, exits, or when agent integration is switched off, so an unbound terminal holds no open watch beyond the directories its provider named.

#### Scenario: Not-bound provider

- **WHEN** a provider reports `not-bound` for the current foreground incarnation and names one or more directories
- **THEN** the runtime watches those directories and re-runs observation on the first change in any of them, and no timer is scheduled

#### Scenario: Journal appears after the fast window

- **WHEN** a provider opens its writable journal after the initial discovery attempt found only its session record
- **THEN** the change in the directory the provider named re-runs observation and the terminal binds without a process-table sweep having run in between

#### Scenario: Not-bound with nothing to await

- **WHEN** a provider reports `not-bound` and names no directory
- **THEN** discovery for that incarnation ends and is armed again only by the next foreground edge

#### Scenario: Terminal that never binds

- **WHEN** a watched directory changes repeatedly while the terminal stays unbound
- **THEN** observation re-runs at most once per ramp interval, the interval widens to its ceiling, and it resets after a quiet period

#### Scenario: Evidence arrives after backing off

- **WHEN** the foreground returns to the shell for a terminal whose discovery watches are open
- **THEN** the watches are closed and no further observation runs for that incarnation

#### Scenario: Blank foreground name

- **WHEN** the foreground process name is blank or unknown
- **THEN** no leave-shell discovery attempt starts

#### Scenario: Empty process snapshot

- **WHEN** a process snapshot returns empty
- **THEN** the provider names the directory its session record will appear in and observation re-runs when that directory changes

#### Scenario: Idle bound terminal

- **WHEN** a terminal is bound and nothing changes
- **THEN** the runtime spawns no process and runs no observation for it

### Requirement: An unresolved journal binds nothing

A search that cannot single out one journal for a session SHALL leave the terminal unbound rather than bind a candidate. A journal whose first record names a different session SHALL be rejected. More than one surviving candidate SHALL bind nothing. A search stopped early by host listing limits SHALL bind nothing, and the provider SHALL name the searched directory so that a later change there re-runs the search.

The search SHALL declare the filename it is resolving, so that unrelated journals are neither considered nor charged against its limits. A project root holding many journals, or very large ones, SHALL NOT prevent the journal being resolved from being found.

#### Scenario: Project root crowded with unrelated journals

- **WHEN** the provider's project root holds hundreds of journals, or journals far larger than the one being resolved
- **THEN** the journal for the named session is still found and bound

#### Scenario: Journal names a different session

- **WHEN** a candidate journal's first record names a session other than the one being resolved
- **THEN** it is rejected and the terminal remains unbound

#### Scenario: Search reaches a listing limit

- **WHEN** host listing limits stop the search before the journal is found
- **THEN** the terminal remains unbound, no partial or guessed binding is published, and the searched directory is named for re-observation

#### Scenario: Two candidates for one session

- **WHEN** more than one journal survives verification for the same session id
- **THEN** nothing is bound

### Requirement: Agent extension observation environment

Foreground-process and journal discovery SHALL be observation the server provides for every terminal. Agent extensions SHALL be ordinary trusted Node.js programs that combine the host-issued terminal context including the PTY shell PID with Node process and filesystem APIs through the public observation helpers. Those helpers run in the extension child, SHALL NOT be described as a sandbox, and SHALL NOT round-trip local process-listing snapshots through host IPC. The child SHALL inherit a bounded host environment covering `PATH`, `HOME`, and locale so the same process-inspection binaries still resolve, and installer-style sterile `NODE_OPTIONS` SHALL NOT be applied to agent observation.

Process inspection SHALL run only inside an observation attempt. An observation attempt SHALL start only from a foreground edge or from a change in a directory the provider named. While a terminal is idle, bound or unbound, no process-listing or open-file binary SHALL be spawned on its behalf.

#### Scenario: Observing on the server host

- **WHEN** an agent extension observes a terminal
- **THEN** it inspects processes and files in its own child using the host-issued terminal context, without routing those snapshots through host IPC

#### Scenario: Child environment

- **WHEN** the extension child is spawned for agent observation
- **THEN** it inherits a bounded `PATH`, `HOME`, and locale and is not given sterile `NODE_OPTIONS`

#### Scenario: Process inspection only inside an attempt

- **WHEN** a terminal is idle with no foreground edge and no change in a named directory
- **THEN** no process-listing or open-file binary is spawned for that terminal
