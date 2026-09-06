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

Each provider's test SHALL additionally drive a second concurrent session of the same provider, in its own PTY and in the same working directory as the first, and SHALL assert that both sessions are admitted, that each binds its own distinct provider session, that work in one moves only that session's state, and that quitting one leaves the other bound. A provider that binds only one of two concurrent sessions SHALL fail.

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

- **WHEN** a provider binds one of two concurrent sessions and not the other
- **THEN** its conformance test fails

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

The mechanics of real-CLI conformance SHALL live in one shared testing harness rather than being reimplemented per extension. The harness SHALL own spawning a PTY and shell, launching a CLI in it, writing input to it, building a real terminal observation context over the live process tree and filesystem, running a provider's `observe` against it, collecting emitted lifecycle events, awaiting an expected state with a timeout, and tearing everything down. It SHALL be able to hold more than one such PTY and context at once so concurrent sessions of one provider can be driven together.

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

Each such specification SHALL drive at least two terminals of that provider in one project and assert a row for each. A provider whose extension ships without this specification SHALL be treated as unverified at the application surface, whatever its unit or conformance coverage states.

#### Scenario: Ordinary end-to-end run

- **WHEN** the end-to-end suite runs without any real-CLI credential gate set
- **THEN** each agent extension's Agents-pane specification runs

#### Scenario: Two terminals in the application

- **WHEN** an agent extension's specification drives two terminals of its provider in one project
- **THEN** the Agents pane shows a row for each

#### Scenario: Extension without application coverage

- **WHEN** an agent extension ships with no Agents-pane specification
- **THEN** it is treated as unverified at the application surface
