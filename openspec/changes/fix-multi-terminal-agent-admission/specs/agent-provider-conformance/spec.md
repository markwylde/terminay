## MODIFIED Requirements

### Requirement: Real-CLI conformance verification

Every verdict in the matrix SHALL be backed by an integration test that owns a real, authenticated provider CLI for its whole run. Each such test SHALL live in that provider's own extension package, beside its unit tests, and SHALL exercise the extension's own observation runtime. It SHALL NOT require a running Terminay server, workspace, or user interface.

Each test SHALL spawn a real shell in a real PTY, launch the provider's CLI in it as a user would, and drive that CLI by writing to the PTY. The extension's provider SHALL discover and bind that CLI through the same public observation API it uses in production, over the real process tree and the real filesystem. Assertions SHALL be made against the canonical lifecycle events the extension emits, as they arrive, and SHALL NOT read provider files directly.

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

Before the first session under test is launched, the harness SHALL seed the working directory with at least one earlier session of the same provider: it SHALL start a session there, drive one turn, and quit it. Every process under test therefore starts in a directory whose provider store already holds a journal that process did not write and that is older than it. A directory empty of prior sessions SHALL NOT be accepted as the conformance working directory.

Each provider's test SHALL additionally drive a second concurrent session of the same provider, in its own PTY and in the same working directory as the first, and SHALL assert that both sessions are admitted, that each binds its own distinct provider session, that the first terminal's binding does not move when the second binds, that work in one moves only that session's state, and that quitting one leaves the other bound. A provider that binds only one of two concurrent sessions, or binds both to one session, SHALL fail.

While the second session is still bound, the test SHALL resume the first session by its provider session id in a fresh PTY and SHALL assert that the resumed process binds that id and not the second session's, and that the second terminal's binding does not move. A provider whose resumed process binds the most recently active session rather than the resumed one SHALL fail.

An inferred (`Y*`) cell SHALL be exercised through the real condition — an actual permission prompt left outstanding, an actual halting fault — and never by injecting the inference's inputs. A capability a provider declares `N` SHALL be asserted as unsupported, so a provider that gains it fails the test until its matrix verdict is updated.

Each test SHALL be opt-in and credential-gated, SHALL skip rather than fail without an explicitly provisioned and authenticated CLI, and SHALL NOT run on ordinary pull requests. It SHALL run in a disposable working directory, SHALL neither read nor modify files outside it, and SHALL NOT access the network beyond the provider's own model calls. It SHALL terminate its CLI and its PTY on completion, timeout, and failure alike.

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

#### Scenario: Two concurrent sessions of one provider

- **WHEN** the test launches a second session of the same provider in its own PTY and the same working directory
- **THEN** both sessions are admitted, each binds its own distinct provider session, and work in one moves only that session's state

#### Scenario: Only one of two concurrent sessions binds

- **WHEN** a provider binds one of two concurrent sessions and not the other, or binds both to one provider session
- **THEN** its conformance test fails

#### Scenario: Directory seeded with an earlier session

- **WHEN** a conformance run begins
- **THEN** its working directory already holds a quit session of the same provider, older than every process the run launches

#### Scenario: Resume while another session runs

- **WHEN** the first session is resumed by id in a fresh PTY while the second session is still bound
- **THEN** the resumed process binds the first session's id, and the second terminal's binding does not move

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

The mechanics of real-CLI conformance SHALL live in one shared testing harness rather than being reimplemented per extension. The harness SHALL own spawning a PTY and shell, launching a CLI in it, writing input to it, building a real terminal observation context over the live process tree and filesystem, running a provider's `observe` against it, collecting emitted lifecycle events, awaiting an expected state with a timeout, and tearing everything down. It SHALL be able to hold more than one such PTY and context at once so concurrent sessions of one provider can be driven together, and SHALL own seeding the working directory with a quit earlier session before the matrix begins.

Each provider's test SHALL supply only what is provider-specific: how its CLI is launched, the prompt that starts subagents, the gesture that leaves an input request outstanding, the gesture that produces a halting fault, how the CLI is quit, how the session is resumed, and the matrix row to assert.

A capability assertion SHALL be expressed once in the harness and run for every provider, so a capability cannot be verified for one provider and silently skipped for another.

#### Scenario: Provider supplies only its own specifics

- **WHEN** a provider's conformance test is written
- **THEN** it supplies its launch, prompt, input-request, fault, quit, and resume gestures and its matrix row, and inherits every assertion from the harness

#### Scenario: Capability assertion shared

- **WHEN** a capability assertion changes
- **THEN** it changes once in the harness and applies to every provider

#### Scenario: Two sessions driven together

- **WHEN** a conformance run drives two concurrent sessions of one provider
- **THEN** the harness holds a PTY and observation context for each and reports their events separately

## ADDED Requirements

### Requirement: Running end-to-end proof of the Agents pane

Every provider that ships an agent extension SHALL have an Electron end-to-end specification that drives its CLI in the running application and asserts the resulting rows in the Agents pane. That specification SHALL run on every ordinary end-to-end run rather than only when a real-CLI credential gate is set, using a stub CLI that writes the provider's real journal format where a real authenticated CLI cannot run unattended.

Each such specification SHALL drive at least two terminals of that provider in one project and assert a row for each, and SHALL start them in a project whose provider store already holds an earlier session of that provider. Where the provider binds through a per-process record — Claude Code's `sessions/<pid>.json`, Grok's `active_sessions.json` — the stub SHALL write that record with its own real pid, working directory, and start time, exactly as the CLI does, so a provider that ignores the record and guesses from journals cannot pass. The Claude Code specification SHALL additionally launch one terminal with `--resume` of the earlier session while the other terminal is live, and assert the resumed terminal's row is that session and the live terminal's row is unchanged.

A provider whose extension ships without this specification SHALL be treated as unverified at the application surface, whatever its unit or conformance coverage states.

#### Scenario: Ordinary end-to-end run

- **WHEN** the end-to-end suite runs without any real-CLI credential gate set
- **THEN** each agent extension's Agents-pane specification runs

#### Scenario: Two terminals in the application

- **WHEN** an agent extension's specification drives two terminals of its provider in one project that already holds an earlier session
- **THEN** the Agents pane shows a row for each, and neither row is the earlier session

#### Scenario: Stub writes the per-process record

- **WHEN** a provider binds through a per-process record
- **THEN** its stub CLI writes that record with its own pid, working directory, and start time

#### Scenario: Resumed terminal beside a live one

- **WHEN** the Claude Code specification resumes the earlier session in one terminal while another terminal's session is live
- **THEN** the resumed terminal's row is the resumed session and the live terminal's row is unchanged

#### Scenario: Extension without application coverage

- **WHEN** an agent extension ships with no Agents-pane specification
- **THEN** it is treated as unverified at the application surface

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
| Codex | Y | Y | Y | Y | N | N | Y | Y | Y | Y |
| Claude Code | Y | Y | Y | Y | Y\* | Y | Y | Y | Y | Y |
| Grok | Y | Y | Y | Y | Y | N | Y | Y | Y | Y |
| OpenCode | Y | Y | Y | Y | N | Y* | Y | Y | Y | Y |

Grok's `Blocked` is `N` because Grok records no fault distinct from a turn
outcome: a failed turn is a `turn_ended` carrying an error, which is a
completion rather than a condition needing intervention.

Codex's `Blocked` is `N` because Codex records a halting fault as the completion
of the turn it halted — an `event_msg task_complete` carrying `error` — rather
than as a condition the session sits in.

Claude Code's `Blocked` is `Y` because it is read from an explicit
`isApiErrorMessage` record carrying `apiErrorStatus` and `error`; nothing about
it is inferred.

A provider not listed SHALL still participate through the ordinary provider
contracts; it simply makes no conformance claim.

#### Scenario: Every cell has a verdict

- **WHEN** a provider is listed in the capability matrix
- **THEN** each of its ten capabilities carries `Y`, `Y*` with a named inference rule, or `N` with a stated reason

#### Scenario: Provider outside the matrix

- **WHEN** a provider makes no conformance claim
- **THEN** it participates through the ordinary provider contracts and no matrix verdict is asserted for it
