# agent-provider-conformance Specification

## Purpose

Terminay publishes a provider capability matrix for Codex, Claude Code, Grok, and OpenCode, and verifies every claimed cell against that provider's real authenticated CLI through a shared conformance harness.

## Requirements

### Requirement: Provider capability matrix

Terminay SHALL publish a provider capability matrix stating, for every provider
it claims conformance for, a verdict on each of ten capabilities: **Detect**,
**Title**, the five canonical states **Idle**, **Working**, **Waiting**,
**Blocked**, and **Done**, the two subagent capabilities **Sub:Enumerate** and
**Sub:Status**, and **Resume**.

A verdict SHALL be one of:

- **Y** — the provider records the fact explicitly and the mapping reads it.
- **Y\*** — the provider records no explicit fact, and the state is derived from
  that provider's session journal by a named inference rule stated in its
  mapping requirement.
- **N** — neither is possible from the provider's own artifacts, with the reason
  stated.

There SHALL be no unstated cell. The matrix SHALL cover Codex, Claude Code,
Grok, and OpenCode.

| | Detect | Title | Idle | Working | Waiting | Blocked | Done | Sub:Enumerate | Sub:Status | Resume |
|---|---|---|---|---|---|---|---|---|---|---|
| Codex | Y | Y | Y | Y | N | Y | Y | Y | Y | Y |
| Claude Code | Y | Y | Y | Y | Y\* | Y\* | Y | Y | Y | Y |
| Grok | Y | Y | Y | Y | Y | N | Y | Y | Y | Y |
| OpenCode | Y | Y | Y | Y | N | Y* | Y | Y | Y | Y |

Grok's `Blocked` is `N` because Grok records no fault distinct from a turn
outcome: a failed turn is a `turn_ended` carrying an error, which is a
completion rather than a condition needing intervention.

A provider not listed SHALL still participate through the ordinary provider
contracts; it simply makes no conformance claim.

#### Scenario: Every cell has a verdict

- **WHEN** a provider is listed in the capability matrix
- **THEN** each of its ten capabilities carries `Y`, `Y*` with a named inference rule, or `N` with a stated reason

#### Scenario: Provider outside the matrix

- **WHEN** a provider makes no conformance claim
- **THEN** it participates through the ordinary provider contracts and no matrix verdict is asserted for it

### Requirement: Journal-derived inference

Where a provider records no explicit fact for a state, Terminay SHALL derive
that state from the provider's own session journal rather than declaring the
capability unavailable. Terminay SHALL NOT obtain the fact by installing a hook,
editing provider configuration, wrapping the CLI, or altering how the provider
runs.

An inference SHALL satisfy all of the following:

- **Journal basis.** Its evidence SHALL be records the provider writes to its
  session journal, or the absence of such records within a bounded window
  between two explicitly recorded boundaries. Terminal text, terminal titles,
  spinner frames, process names, escape-sequence message bodies, file
  modification times, and filename proximity SHALL NOT be evidence for a
  canonical state.
- **Named rule.** The rule SHALL be stated in that provider's mapping
  requirement, including the window it uses and the boundaries that bound it.
- **Suppression only.** Process observation MAY suppress an inference that would
  otherwise fire, and SHALL NOT create a state on its own. A live descendant
  performing work is grounds to withhold an inferred input-request state; a
  matching process name is never grounds to assert one.
- **Explicit evidence wins.** An explicit provider record SHALL override an
  inference immediately, in either direction.
- **Marked.** Every state reached by inference SHALL be `Y*` in the matrix, and
  the entry SHALL carry that it was inferred so surfaces can label it
  accordingly.

#### Scenario: Inference from recorded absence

- **WHEN** a provider records a turn start and then writes nothing for longer than its named window, with no completion record
- **THEN** the inferred state applies and the entry records that it was inferred

#### Scenario: Process evidence contradicts the inference

- **WHEN** an inference for an input-request state would fire while a live descendant is performing work
- **THEN** the inference is withheld

#### Scenario: Process evidence alone

- **WHEN** the only available evidence is a matching foreground process name
- **THEN** no canonical state is asserted

#### Scenario: Explicit record arrives

- **WHEN** the provider writes an explicit record for a state currently held by inference
- **THEN** the explicit record takes precedence immediately

#### Scenario: Terminal-derived evidence offered

- **WHEN** the only available evidence is terminal text, a spinner frame, an escape-sequence body, or a file timestamp
- **THEN** it is not used to reach a canonical state

### Requirement: Detect capability

**Detect** SHALL mean that starting the provider's CLI normally in an
interactive Terminay terminal produces an agent entry bound to that exact
terminal, visible in the Agents pane, without the user editing provider
configuration, installing a hook, or launching the CLI through a wrapper.
Detection SHALL be proven by the provider's documented terminal identity
evidence and SHALL NOT rest on a process name alone.

#### Scenario: CLI launched normally

- **WHEN** a user runs a matrix provider's CLI in an interactive terminal with no configuration changes
- **THEN** an agent entry bound to that exact terminal appears in the Agents pane

#### Scenario: Process name without evidence

- **WHEN** a process matching a provider's executable name runs but its terminal identity evidence cannot be proven
- **THEN** no agent entry is created and the terminal uses terminal-activity fallback

### Requirement: Title capability

**Title** SHALL mean the root entry carries a meaningful label at every point in
a session's life. Before the provider has chosen a title, the entry SHALL carry
a deterministic label — the provider's own pre-title identifier where it records
one, otherwise the first eligible user-facing message, otherwise the provider
display name. When the provider later records an explicit title, that title
SHALL replace the earlier label on the existing root entry in place, without
creating a second root, replaying lifecycle events, or changing the entry's
state.

#### Scenario: Before the provider chooses a title

- **WHEN** a session has started and the provider has recorded no explicit title
- **THEN** the root entry carries the provider's pre-title identifier, the first eligible user-facing message, or the provider display name

#### Scenario: Provider records a title later

- **WHEN** the provider records an explicit title for a bound session
- **THEN** the existing root entry's label is replaced in place and its state, root identity, and lifecycle history are unchanged

### Requirement: Idle capability

**Idle** SHALL mean the entry reaches the `idle` state when a live session
exists with no active work and no pending result — both immediately after the
session starts and before any turn has run. `idle` SHALL be distinct from
`done`: work that has completed SHALL be `done`, not `idle`. A provider's
per-turn header records SHALL NOT return a working entry to `idle`.

#### Scenario: Freshly started session

- **WHEN** a provider session starts and no turn has begun
- **THEN** the entry is `idle`

#### Scenario: Completed work is not idle

- **WHEN** a turn completes
- **THEN** the entry is `done` and not `idle`

#### Scenario: Per-turn header records

- **WHEN** a provider writes session header records at the start of each turn
- **THEN** they do not restart the session or return the entry to `idle`

### Requirement: Working capability

**Working** SHALL mean the entry is in the `working` state for the whole time
the provider is processing a turn or running tool or subagent work, and is not
in `working` once that work has stopped. Continuous provider output, spinner
repaints, or cosmetic redraws after the work has ended SHALL NOT hold or return
an entry to `working`.

Where a provider flushes a tool's start and completion records together on
completion, the entry SHALL remain `working` across that gap on the strength of
the turn boundary, and SHALL NOT drop out of `working` merely because no record
has appeared.

#### Scenario: Turn in progress

- **WHEN** the provider is processing a turn or running tool work
- **THEN** the entry is `working` for the duration of that work

#### Scenario: Records flushed on completion

- **WHEN** a provider writes no record while a tool runs and flushes its start and completion together afterwards
- **THEN** the entry remains `working` for the whole tool run

#### Scenario: Cosmetic output after work ends

- **WHEN** the provider continues repainting after its turn has ended
- **THEN** the entry is not `working`

### Requirement: Waiting capability

**Waiting** SHALL mean the entry reaches the `waiting` state when the provider
is explicitly requesting approval, an answer, or other user input, and leaves
`waiting` when that request is answered or resolved.

Grok records the request explicitly and SHALL map it directly. Claude Code
writes no record while a request is outstanding and SHALL reach `waiting` by
its named journal-derived inference rule. Codex and OpenCode persist nothing
that distinguishes an outstanding prompt from ordinary work, so their `waiting`
is stated as unsupported and SHALL NOT be inferred.

A `waiting` state SHALL be reachable while a turn is in progress and SHALL NOT
require the provider to write anything at the moment the request is raised.

#### Scenario: Provider records the request

- **WHEN** a provider records an approval, permission, or user-input request
- **THEN** the entry is `waiting`

#### Scenario: Request answered

- **WHEN** that request is answered or resolved
- **THEN** the entry leaves `waiting` and resumes `working`

#### Scenario: Provider records nothing while waiting

- **WHEN** a provider raises an input request without writing any record
- **THEN** the entry reaches `waiting` through that provider's named inference rule

### Requirement: Blocked capability

**Blocked** SHALL mean the entry reaches the `blocked` state when the provider
cannot proceed without intervention, carrying an accessible label distinct from
`waiting`. Where a provider records an explicitly blocking condition, that
record SHALL be mapped directly. Where it does not, `blocked` SHALL be derived
from a recorded fault that halts a turn without completing it — an error record,
a failed authentication, or an exhausted quota — under the same journal-derived
inference rules.

An ordinary input request SHALL be `waiting`, not `blocked`. A tool failure the
agent then handles itself SHALL be neither.

#### Scenario: Explicit blocking record

- **WHEN** a provider records an explicitly blocking condition
- **THEN** the entry is `blocked` with an accessible label distinct from `waiting`

#### Scenario: Recorded fault halts a turn

- **WHEN** a provider records a fault that halts a turn without a completion record
- **THEN** the entry is `blocked` through that provider's named inference rule

#### Scenario: Handled tool failure

- **WHEN** a tool fails and the agent continues working
- **THEN** the entry is neither `blocked` nor `waiting`

### Requirement: Done capability

**Done** SHALL mean the entry reaches the `done` state when the current turn or
agent run completes, fails, or is cancelled, and that the entry remains `done`
and unacknowledged until the user views it. `done` SHALL carry the completion
outcome so a failed or cancelled run is distinguishable from a successful one.

#### Scenario: Turn completes

- **WHEN** the provider records that a turn completed, failed, or was cancelled
- **THEN** the entry is `done` with the corresponding outcome

#### Scenario: Done persists until viewed

- **WHEN** an entry becomes `done` and the user has not viewed it
- **THEN** it remains `done` and unacknowledged

### Requirement: Subagent enumeration capability

**Sub:Enumerate** SHALL mean that every subagent the provider starts beneath a
bound root appears as a named child of that root, for the life of the root
session. A child SHALL carry a label taken from the provider's own record of
what that child was asked to do. Children created after the root binds SHALL be
admitted live rather than only at discovery.

A child SHALL be attached to a root only on the provider's own parentage
evidence — a recorded parent identifier, or a journal location the provider
itself scopes to that root session. Timestamp, path proximity, and display text
SHALL NOT establish a parent-child relationship. A child SHALL NOT become a
second root binding, and SHALL NOT change its root's state merely by existing.

#### Scenario: Subagents started beneath a root

- **WHEN** a provider starts subagents beneath a bound root
- **THEN** each appears as a named child of that root

#### Scenario: Child created after the root binds

- **WHEN** a subagent starts after its root is already bound
- **THEN** it is admitted live as a child of that root

#### Scenario: Parentage not proven

- **WHEN** a candidate child's parentage rests only on timestamp, path proximity, or display text
- **THEN** it is not attached to the root

#### Scenario: Child does not become a root

- **WHEN** a child is admitted
- **THEN** it does not create a second root binding

### Requirement: Subagent status capability

**Sub:Status** SHALL mean each enumerated child carries its own canonical state,
independent of its root and of its siblings: `working` while that child is
doing work, `done` when it completes, fails, or is cancelled, with its outcome.
A child's state SHALL come from that child's own provider records.

A root SHALL remain `working` while any child is working, and a child completing
SHALL NOT complete its root. Where a provider records no per-child lifecycle,
`Sub:Status` SHALL be `N` and the root SHALL remain `working` for the duration
of the child work rather than a child state being synthesized from the root's.

#### Scenario: Child completes before its siblings

- **WHEN** one child of several completes
- **THEN** that child is `done` with its outcome, its siblings are unchanged, and the root remains `working`

#### Scenario: Provider records no child lifecycle

- **WHEN** a provider runs subagents without recording per-child lifecycle
- **THEN** `Sub:Status` is `N` and the root remains `working` for the duration of the child work

#### Scenario: Child state not synthesized

- **WHEN** a provider declares `Sub:Status` unsupported
- **THEN** no child state is derived from the root's state

### Requirement: Resume capability

**Resume** SHALL mean that quitting the CLI and resuming the same provider
session in a new process returns that session to the Agents surfaces, still
bound to the terminal it was resumed in.

On quit, the root SHALL become inactive rather than being deleted or left
reporting `working`. On resume, the extension SHALL rebind the same provider
session, SHALL NOT create a second root for it, and SHALL NOT replay the
session's earlier transitions as new activity. A resumed session whose last
recorded lifecycle fact is a completion SHALL be `done`, not `working`. Further
work in the resumed session SHALL move the same root through its states
normally.

Where a provider switches session within one live process, authority SHALL move
to the newly active session and the previous root SHALL be retired.

#### Scenario: CLI quits

- **WHEN** a bound provider CLI exits
- **THEN** its root becomes inactive and is not left reporting `working`

#### Scenario: Session resumed in a new process

- **WHEN** the same provider session is resumed in a new process
- **THEN** the same root rebinds, no second root is created, and earlier transitions are not replayed as new activity

#### Scenario: Resumed session that had completed

- **WHEN** a session is resumed whose last recorded lifecycle fact is a completion
- **THEN** the entry is `done` rather than `working`

#### Scenario: Work continues after resume

- **WHEN** the user gives the resumed session further work
- **THEN** the same root moves through `working` and `done` normally

### Requirement: Real-CLI conformance verification

Every verdict in the matrix SHALL be backed by an integration test that owns a
real, authenticated provider CLI for its whole run. Each such test SHALL live in
that provider's own extension package, beside its unit tests, and SHALL exercise
the extension's own observation runtime. It SHALL NOT require a running Terminay
server, workspace, or user interface.

Each test SHALL spawn a real shell in a real PTY, launch the provider's CLI in
it as a user would, and drive that CLI by writing to the PTY. The extension's
provider SHALL discover and bind that CLI through the same public observation
API it uses in production, over the real process tree and the real filesystem.
Assertions SHALL be made against the canonical lifecycle events the extension
emits, as they arrive, and SHALL NOT read provider files directly.

Each provider's test SHALL drive one session that:

- launches the CLI and asserts the root binds to that PTY, with a label before
  the provider has chosen a title and the provider's title replacing it after;
- is `idle` before any work;
- runs a prompt that starts several subagents concurrently with staggered
  completions, asserting each child is enumerated with its label, that children
  reach `working` and `done` independently of one another, and that the root
  stays `working` until the last child finishes;
- reaches `waiting` when an input request is left outstanding, and returns to
  `working` when it is answered;
- reaches `blocked` on a halting fault;
- is `done` with an outcome when the turn ends, and `idle` again before the next;
- becomes inactive when the CLI is quit, rebinds to the same root when the
  session is resumed in a new process without creating a second root or
  replaying old transitions, and moves through `working` and `done` again on
  further work.

An inferred (`Y*`) cell SHALL be exercised through the real condition — an
actual permission prompt left outstanding, an actual halting fault — and never
by injecting the inference's inputs. A capability a provider declares `N` SHALL
be asserted as unsupported, so a provider that gains it fails the test until its
matrix verdict is updated.

Each test SHALL be opt-in and credential-gated, SHALL skip rather than fail
without an explicitly provisioned and authenticated CLI, and SHALL NOT run on
ordinary pull requests. It SHALL run in a disposable working directory, SHALL
neither read nor modify files outside it, and SHALL NOT access the network
beyond the provider's own model calls. It SHALL terminate its CLI and its PTY on
completion, timeout, and failure alike.

#### Scenario: Test drives the real CLI

- **WHEN** a provider's conformance test runs with an authenticated CLI
- **THEN** it spawns that CLI in a real PTY and asserts the extension's canonical events against every capability the matrix claims

#### Scenario: No Terminay instance

- **WHEN** a provider's conformance test runs
- **THEN** it requires no Terminay server, workspace, or user interface

#### Scenario: Assertions on emitted events

- **WHEN** the test checks a capability
- **THEN** it asserts the extension's emitted lifecycle events rather than reading provider files directly

#### Scenario: Quit and resume

- **WHEN** the test quits the CLI and resumes the same session in a new process
- **THEN** the root becomes inactive and then rebinds without a second root or replayed transitions

#### Scenario: Inferred cell exercised for real

- **WHEN** the test verifies a `Y*` capability
- **THEN** it produces the real condition rather than injecting the inference's inputs

#### Scenario: Declared limitation gains support

- **WHEN** a provider begins recording a capability its matrix declares `N`
- **THEN** the test fails until the matrix verdict is updated

#### Scenario: CLI not provisioned

- **WHEN** an authenticated CLI for a provider is not provisioned
- **THEN** that provider's conformance test is skipped rather than failing

#### Scenario: Ordinary pull request

- **WHEN** an ordinary pull request runs CI
- **THEN** the real-CLI conformance tests do not run

#### Scenario: Test aborts

- **WHEN** a conformance test times out or fails
- **THEN** its CLI process and PTY are terminated

### Requirement: Shared conformance harness

The mechanics of real-CLI conformance SHALL live in one shared testing harness
rather than being reimplemented per extension. The harness SHALL own spawning a
PTY and shell, launching a CLI in it, writing input to it, building a real
terminal observation context over the live process tree and filesystem, running
a provider's `observe` against it, collecting emitted lifecycle events, awaiting
an expected state with a timeout, and tearing everything down.

Each provider's test SHALL supply only what is provider-specific: how its CLI is
launched, the prompt that starts subagents, the gesture that leaves an input
request outstanding, the gesture that produces a halting fault, how the CLI is
quit, how the session is resumed, and the matrix row to assert.

A capability assertion SHALL be expressed once in the harness and run for every
provider, so a capability cannot be verified for one provider and silently
skipped for another.

#### Scenario: Provider supplies only its own specifics

- **WHEN** a provider's conformance test is written
- **THEN** it supplies its launch, prompt, input-request, fault, quit, and resume gestures and its matrix row, and inherits every assertion from the harness

#### Scenario: Capability assertion shared

- **WHEN** a capability assertion changes
- **THEN** it changes once in the harness and applies to every provider

### Requirement: Inference tuning is evidence-based

Every window an inference rule uses SHALL be derived from measured provider
behaviour and SHALL be recorded with the measurement that justifies it. A window
SHALL exceed the longest quiet interval that provider produces during ordinary
uninterrupted work by a stated margin. Windows SHALL be re-measured whenever a
provider's mapping version changes.

#### Scenario: Window chosen

- **WHEN** an inference rule declares a window
- **THEN** the measurement of that provider's ordinary quiet intervals is recorded alongside it

#### Scenario: Mapping version changes

- **WHEN** a provider's mapping version changes
- **THEN** its inference windows are re-measured

### Requirement: Fixture parity with observed provider behaviour

A provider's unit-test fixtures SHALL reproduce the discovery evidence and the
record-flush timing its real CLI actually presents. A fixture SHALL NOT supply
binding evidence the provider does not produce in normal operation, SHALL NOT
present a record earlier than the real CLI writes it, and a provider whose real
CLI holds no open writable journal handle SHALL NOT have its binding proven only
by a fixture that supplies one.

#### Scenario: Fixture supplies evidence the CLI never produces

- **WHEN** a provider's real CLI does not present a form of binding evidence
- **THEN** no fixture proves that provider's binding using only that evidence

#### Scenario: Fixture presents a record early

- **WHEN** a real CLI flushes a record only on completion
- **THEN** no fixture presents that record as available beforehand
