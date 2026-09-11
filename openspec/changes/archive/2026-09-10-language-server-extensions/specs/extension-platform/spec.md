## ADDED Requirements

### Requirement: Language server contribution and registration

A language server contribution SHALL declare a namespaced language server id, the
language ids it serves, the file selectors it matches, a display name, and the
runtime notes Settings shows for it. At activation the extension SHALL register
that contribution with a `launch` callback that, given a project root, returns the
argv, cwd policy, environment, and optional initialisation options for the
language server. The host SHALL own everything else: spawning the language server
as a child of the extension process with the project root as its working
directory, stdio framing, initialise, lifecycle, deadlines, and translation into
core's bounded DTOs. A language server extension SHALL contribute no UI, register
no protocol operations, and never enter the renderer.

#### Scenario: Registering a declared language server

- **WHEN** an extension registers a language server id its manifest contributed,
  supplying a `launch` callback
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Undeclared language server id

- **WHEN** an extension registers a language server id its manifest did not
  contribute, or registers the same id twice
- **THEN** the registration is refused

#### Scenario: Host owns the language server process

- **WHEN** a language session starts for a project
- **THEN** the host spawns the language server as a child of the extension process
  with the project root as its working directory and owns its stdio framing,
  initialise, lifecycle, deadlines, and translation

### Requirement: Language session lifecycle in the extension host

Language sessions SHALL be counted and reaped as child resources of the
extension that contributed them, under the same supervision, cancellation, and
shutdown rules as the extension's other bounded work. A language server child
that dies SHALL count against that extension's crash accounting exactly once.
When an extension is quarantined, disabled, or shut down, its language sessions
SHALL end and their pending and subsequent requests SHALL return a typed
unavailable outcome.

#### Scenario: Language server child dies

- **WHEN** a language server child process exits unexpectedly
- **THEN** the death counts once against the contributing extension's crash
  accounting and the diagnostic history records it

#### Scenario: Extension quarantined

- **WHEN** a language server extension is quarantined or disabled
- **THEN** its language sessions end and requests for them return a typed
  unavailable outcome

#### Scenario: Shutdown

- **WHEN** the extension host shuts down
- **THEN** its language sessions are cancelled and their language server children
  are terminated with the extension's other bounded work

## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support the capabilities needed by the official Codex,
Claude Code, Cursor Agent, Grok, and omp extensions and the official language
server extensions. Themes, editor plugins, autocomplete sources, arbitrary
commands, renderer components, and generic Server Core operation registration
SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

#### Scenario: Language server contribution

- **WHEN** a package declares a language server contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Contribution arrays

`contributes.agentProviders` and `contributes.languageServers` SHALL be the
supported contribution arrays, and at least one supported contribution SHALL be
required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more agent providers
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

#### Scenario: Language-server-only package

- **WHEN** a package contributes one or more language servers and no agent
  provider
- **THEN** it passes contribution validation

### Requirement: Extensions section content

The Extensions section SHALL name the selected Terminay Server as the authority
and SHALL show built-in Codex, Claude Code, Cursor Agent, Grok, omp, and
TypeScript language cards, installed and disabled states, available explicit
updates, compatibility and failure details, permissions, dependants, and
**Install from npm…**. A language server extension's card SHALL show the
languages it serves and an enable toggle for that extension.

#### Scenario: Viewing extension state

- **WHEN** the user opens Extensions
- **THEN** the selected server is named as the authority and built-in cards,
  installed and disabled state, available explicit updates, compatibility and
  failure detail, permissions, dependants, and **Install from npm…** are shown

#### Scenario: Viewing a language server extension

- **WHEN** the user views a language server extension's card
- **THEN** it shows the languages that extension serves and a per-extension enable
  toggle
