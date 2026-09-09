## MODIFIED Requirements

### Requirement: Resume capability

**Resume** SHALL mean that quitting the CLI and restoring the same provider
session in a new process, using that CLI's documented restore command, returns
that session to the Agents surfaces, still bound to the terminal it was
restored in.

The restore command used to prove Resume SHALL be a command the CLI documents
for that purpose — a session picker, a last-session shortcut (`--continue`,
`resume --last`), or an explicit session id — not a new launch and not a
fixture that injects a UUID the command does not put on argv.

On quit, the root SHALL become inactive rather than being deleted or left
reporting `working`. On restore, the extension SHALL rebind the same provider
session, SHALL NOT create a second root for it, and SHALL NOT replay the
session's earlier transitions as new activity. A restored session whose last
recorded lifecycle fact is a completion SHALL be `done`, not `working`. Further
work in the restored session SHALL move the same root through its states
normally.

Where a provider switches session within one live process, authority SHALL move
to the newly active session and the previous root SHALL be retired.

#### Scenario: CLI quits

- **WHEN** a bound provider CLI exits
- **THEN** its root becomes inactive and is not left reporting `working`

#### Scenario: Session resumed in a new process

- **WHEN** the same provider session is restored with that CLI's documented restore command in a new process
- **THEN** the same root rebinds, no second root is created, and earlier transitions are not replayed as new activity

#### Scenario: Resume picker

- **WHEN** Resume is proven for a CLI whose default restore command is a picker
- **THEN** the test drives that picker, selects the session just quit, and asserts the same root rebinds

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
  session is restored with that CLI's documented restore command in a new
  process without creating a second root or replaying old transitions, and
  moves through `working` and `done` again on further work.

The restore command in that last step SHALL be the CLI's documented resume,
continue, or session-restore invocation. A test that relaunches the CLI as a
new conversation, or that injects a session UUID the restore command does not
place on argv, SHALL NOT count as proving Resume.

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

A Resume `Y` in the matrix SHALL mean that opt-in real-CLI test passed for that
restore command. A skipped test, a fixture-only test, or a test of a different
argv SHALL NOT keep the cell at `Y`.

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

- **WHEN** the test quits the CLI and restores the same session with that CLI's documented restore command in a new process
- **THEN** the root becomes inactive and then rebinds without a second root or replayed transitions

#### Scenario: Resume command matches the CLI

- **WHEN** the conformance descriptor names a resume gesture
- **THEN** that gesture is a documented restore command of that CLI, including a picker when the CLI's default restore is a picker

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

### Requirement: Fixture parity with observed provider behaviour

A provider's unit-test fixtures SHALL reproduce the discovery evidence and the
record-flush timing its real CLI actually presents. A fixture SHALL NOT supply
binding evidence the provider does not produce in normal operation, SHALL NOT
present a record earlier than the real CLI writes it, and a provider whose real
CLI holds no open writable journal handle SHALL NOT have its binding proven only
by a fixture that supplies one.

A restore-command fixture SHALL use the argv the real CLI presents for that
command. A fixture that puts a session UUID on argv SHALL NOT be the only proof
that a picker or `--continue` / `--last` restore binds.

#### Scenario: Fixture supplies evidence the CLI never produces

- **WHEN** a provider's real CLI does not present a form of binding evidence
- **THEN** no fixture proves that provider's binding using only that evidence

#### Scenario: Fixture presents a record early

- **WHEN** a real CLI flushes a record only on completion
- **THEN** no fixture presents that record as available beforehand

#### Scenario: Resume fixture matches argv

- **WHEN** a unit test claims a picker or last-session restore binds
- **THEN** its fixture argv is that restore command, not an injected session UUID
