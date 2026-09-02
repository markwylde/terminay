# shell-profiles-and-terminal-launch Specification

## Purpose

Launch every terminal from a server-owned shell profile through one canonical
launch policy that resolves the program, arguments, environment, and working
directory against the exact project environment, so startup, new-project,
new-tab, split, Desktop, browser, local, and remote creation all pass the same
boundary.

## Requirements

### Requirement: Single launch boundary for every creation route

Every terminal SHALL be launched from a server-owned shell profile and one
canonical launch policy. A profile SHALL describe the program, arguments,
environment, and presentation of a shell; the launch policy SHALL select the
profile and working directory from explicit, project, and server defaults.
Startup, new-project, new-tab, split, Desktop, browser, local, and remote
creation SHALL all resolve through this same boundary.

#### Scenario: All creation routes agree

- **WHEN** a terminal is created at app startup, for a new project, as a new
  tab, as a split, or through a one-off profile launch, on Desktop or in a
  browser
- **THEN** the same profile and working-directory resolver produces its launch

#### Scenario: Changes apply only to new terminals

- **WHEN** a profile or working-directory default changes
- **THEN** only terminals created after the change are affected, and no existing
  session's shell or working directory changes

### Requirement: Environment-scoped catalogues and defaults

Shell catalogue, System default, account home, executable validation, startup
mode, working directory, and launch environment SHALL resolve against the exact
project environment. Shell-profile catalogues SHALL belong to one Terminay
Server and SHALL be scoped by project-environment capability. A client connected
to another server SHALL see that server's catalogues and MUST NOT send a local
executable path as another environment's default. Project defaults SHALL be
valid for their environment; unavailable discovery or launch capability SHALL be
reported rather than substituted.

#### Scenario: SSH project exposes only its provider's catalogue

- **WHEN** a terminal is created in an SSH project
- **THEN** it uses that provider's Remote system default
- **AND** no local profile is executed with a remote root

#### Scenario: Server-local profiles remain valid locally

- **WHEN** a terminal is created in a This server project
- **THEN** existing server-local profiles resolve normally

#### Scenario: Discovery capability unavailable

- **WHEN** an environment cannot perform discovery or launch for a requested
  profile
- **THEN** the unavailability is reported and no substitute profile is used

#### Scenario: Cross-host boundary cannot be widened

- **WHEN** a remote client attempts to select a local-only profile
- **THEN** the request is rejected and its server, project, and session scope is
  unchanged, including across reconnect

### Requirement: Profile catalogue composition

The profile catalogue SHALL contain one reserved, undeletable **System default**
profile, read-only profiles discovered from the server operating system, and
durable custom profiles created or copied by the user. System default SHALL
require no configuration. Named custom profiles SHALL be supported where the
project environment permits them.

#### Scenario: System default cannot be deleted

- **WHEN** the user attempts to delete the reserved System default profile
- **THEN** the deletion is rejected

#### Scenario: Zero-configuration launch

- **WHEN** no profile has been configured
- **THEN** terminals launch from System default without further configuration

### Requirement: Profile identity and fields

Every profile SHALL have a stable opaque id, a unique display name, a launch
target, an ordered argument array, a startup mode, an environment overlay, and
optional terminal icon and colour metadata. Renaming or restyling a profile MUST
NOT change its identity. User-facing order SHALL be durable.

#### Scenario: Rename preserves identity

- **WHEN** a custom profile is renamed or its icon or colour changes
- **THEN** its opaque id is unchanged and existing references still resolve

#### Scenario: Duplicate display name

- **WHEN** a profile is saved with a display name already in use
- **THEN** validation reports the duplicate name inline and the record is not
  persisted

### Requirement: This server launch targets

A This server launch target SHALL be one of `system`, resolved from the server
account at launch time; `executable`, containing a native executable path or a
platform-valid executable name; or `wsl`, containing a Windows Subsystem for
Linux distribution and optional shell path. The WSL target's fields MUST NOT be
encoded into one command string.

#### Scenario: Executable target

- **WHEN** a profile uses an `executable` target
- **THEN** the server validates that native executable path or platform-valid
  name before spawn

#### Scenario: WSL target stays structured

- **WHEN** a profile uses a `wsl` target
- **THEN** the distribution and optional shell path remain separate structured
  fields, so spaces and command arguments cannot alter the selected distribution

### Requirement: Startup modes and argument handling

The startup mode SHALL be **Shell default**, **Login**, or **Non-login**. Shell
default SHALL use the selected shell's normal interactive PTY behaviour. Login
and non-login SHALL be translated only for shells whose semantics Terminay
knows; an unsupported combination SHALL be rejected rather than receiving a
guessed flag. Additional arguments SHALL remain an array and SHALL be passed
directly to the program without shell parsing, interpolation, or command-string
execution.

#### Scenario: Unsupported startup mode

- **WHEN** a login or non-login mode is selected for a shell whose semantics
  Terminay does not know
- **THEN** the combination is rejected and no guessed flag is passed

#### Scenario: Arguments are not shell-parsed

- **WHEN** an argument contains spaces, quotes, or shell metacharacters
- **THEN** it is passed to the program as one array element without parsing,
  interpolation, or command-string execution

### Requirement: This server System default platform policy

For This server, the reserved System default profile SHALL follow the host's
platform policy. On macOS it SHALL launch a supported POSIX account shell as a
login shell, matching a normal terminal login and allowing the user's login
startup files to establish `PATH` and related command-discovery environment.
This policy MUST NOT inspect or hard-code installed tool paths. An explicit
custom profile's Shell default mode SHALL remain the selected shell's unmodified
default behaviour. Other providers SHALL define their own bounded catalogue and
system-default semantics.

#### Scenario: macOS default gives a login shell

- **WHEN** a macOS user whose account shell is zsh creates a terminal with
  default settings
- **THEN** an interactive login zsh starts in the project or inherited working
  directory, with the login-file environment available for discovering
  user-installed commands

#### Scenario: Custom profile is not silently upgraded to login

- **WHEN** a custom profile uses Shell default mode
- **THEN** the selected shell runs with its unmodified default behaviour

### Requirement: WSL profile constraints

A WSL profile SHALL name an explicit Linux shell before it can use startup mode,
arguments, or an environment overlay. Terminay SHALL translate the structured
WSL target without treating arguments as an implicit Linux command. Windows
environment keys SHALL be compared case-insensitively, and `WSLENV` SHALL remain
server-managed.

#### Scenario: WSL profile without an explicit shell

- **WHEN** a WSL profile names no Linux shell and sets a startup mode, arguments,
  or an environment overlay
- **THEN** the profile is rejected

#### Scenario: Windows environment key comparison

- **WHEN** an overlay key differs only by case from an existing Windows
  environment key
- **THEN** the keys are treated as the same variable

### Requirement: Server-supplied terminal capability variables

Every PTY SHALL receive `TERM=xterm-256color` and `COLORTERM=truecolor` from the
server launch resolver rather than inheriting the environment of the process
which started Terminay. WSL launches SHALL propagate both values explicitly
through `WSLENV`. Every xterm-backed host SHALL advertise `COLORTERM=truecolor`
in the canonical launch environment.

#### Scenario: Consistent colour capability across routes

- **WHEN** the initial terminal and a later terminal created through
  `terminal.create` both start
- **THEN** each exposes the same `TERM` and `COLORTERM` capability to child
  programs, and creation route and attachment timing do not change ANSI
  background or true-colour rendering

#### Scenario: WSL propagation

- **WHEN** a WSL profile launches
- **THEN** `TERM` and `COLORTERM` are propagated explicitly through `WSLENV`

### Requirement: Environment overlay semantics and protected variables

An environment overlay SHALL map variable names to string values or `null`,
where `null` removes a non-protected inherited variable. It MUST NOT contain
secret references or expansion syntax. Terminay SHALL apply the host baseline
first, then the profile overlay, then server-managed terminal identity,
authorization, control, locale, and compatibility values. Profiles MUST NOT
replace or remove protected server-managed variables, including the `TERMINAY_`
namespace.

#### Scenario: Overlay attempts to override a protected variable

- **WHEN** an overlay sets or nulls a variable in the `TERMINAY_` namespace or
  another protected server-managed variable
- **THEN** the protected value is preserved and the overlay entry does not take
  effect

#### Scenario: Null removes an inherited variable

- **WHEN** an overlay maps a non-protected inherited variable to `null`
- **THEN** that variable is absent from the launched process environment

### Requirement: Profile bounds

Profiles and their fields SHALL be bounded. The server SHALL accept at most 64
durable profiles, 64 arguments per profile, and 128 environment entries per
profile, with bounded names, paths, keys, and values. One encoded profile SHALL
be at most 16 KiB and the complete durable profile configuration at most 32 KiB.
Invalid or over-budget records SHALL be reported without being persisted or
executed.

#### Scenario: Over-budget profile

- **WHEN** a profile exceeds an argument, environment-entry, or encoded-size
  bound
- **THEN** the server reports the violation and neither persists nor executes the
  record

### Requirement: Environment-routed shell discovery

Discovery SHALL execute through the target project environment and SHALL return
capability data rather than persisted settings. Refreshing discovery MAY add,
remove, or mark candidates unavailable without rewriting a custom profile or
changing the selected default. Providers MAY expose a smaller provider-owned
catalogue.

#### Scenario: Refresh does not rewrite configuration

- **WHEN** discovery is refreshed and a candidate disappears
- **THEN** custom profiles and the selected default are unchanged and the
  candidate is marked unavailable

#### Scenario: Discovery lists only the PTY host's profiles

- **WHEN** discovery runs for a Linux, macOS, Windows native, Windows WSL, or
  remote-server environment
- **THEN** only profiles available on the machine that will run the PTY are
  exposed

### Requirement: POSIX discovery and fallback order

On macOS and Linux, Terminay SHALL prefer the server account's configured login
shell, then a valid absolute `SHELL` value, then executable entries from
`/etc/shells`. If none is usable, macOS SHALL try zsh, then bash, then sh; Linux
SHALL try bash, then zsh, then sh. Every candidate MUST exist and be executable.
Terminay SHALL canonicalize and deduplicate executable paths. The inherited
Electron or service environment is not by itself proof of the account default.

#### Scenario: No configured login shell is usable

- **WHEN** neither the account login shell, an absolute `SHELL` value, nor an
  `/etc/shells` entry is usable on macOS
- **THEN** zsh, bash, and sh are tried in that order and each candidate must
  exist and be executable

#### Scenario: Duplicate paths collapse

- **WHEN** discovery finds the same executable through different path spellings
- **THEN** the paths are canonicalized and deduplicated into one candidate

### Requirement: Windows discovery and system default order

On Windows, Terminay SHALL discover PowerShell 7, Windows PowerShell, Command
Prompt, Git Bash, and installed WSL distributions when available. System default
SHALL try a validated `SHELL`, the OpenSSH `DefaultShell`, Windows PowerShell,
and `ComSpec`, in that order, and SHALL fail if none is usable. PowerShell 7
SHALL be offered when discovered but MUST NOT be silently substituted for the
operating-system default. WSL distribution identity SHALL remain structured.

#### Scenario: PowerShell 7 is offered, not substituted

- **WHEN** PowerShell 7 is discovered on Windows
- **THEN** it appears as a candidate but System default still resolves through
  the validated `SHELL`, `DefaultShell`, Windows PowerShell, `ComSpec` order

#### Scenario: No usable Windows system default

- **WHEN** none of the Windows system-default candidates is usable
- **THEN** resolution fails visibly

### Requirement: Discovered profile metadata, copying, and availability

Discovered profiles SHALL include availability and source metadata. Copying one
SHALL create an independent custom profile; otherwise it SHALL remain read-only
and MAY change with the host installation. A custom profile whose target
disappears SHALL be retained and shown as unavailable.

#### Scenario: Copying a discovered profile

- **WHEN** the user copies a discovered profile
- **THEN** an independent custom profile is created from its structured launch
  configuration

#### Scenario: Custom target disappears

- **WHEN** a custom profile's executable is removed from the host
- **THEN** the profile is retained and shown as unavailable

### Requirement: Durable defaults reference durable profiles

Runtime-only discovered profiles MAY be used for a one-off launch, but a server
or project default SHALL reference System default or a durable custom profile.
Choosing a discovered profile as a default SHALL first copy its structured
launch configuration into a custom profile.

#### Scenario: Discovered profile chosen as a default

- **WHEN** the user selects a discovered profile as the server or project
  default
- **THEN** its structured launch configuration is first copied into a custom
  profile, and the default references that custom profile

#### Scenario: One-off use of a discovered profile

- **WHEN** the user launches once from a discovered profile
- **THEN** the terminal starts and no default changes

### Requirement: Catalogue responses redact environment values

Catalogue responses SHALL contain profile summaries and environment-entry
counts, not environment values. A write-authorized detail query SHALL return one
bounded custom profile for editing. Generic settings reads and change events
SHALL also redact profile environment values, and generic settings mutation MUST
NOT modify the reserved profile subtree.

#### Scenario: Catalogue listing

- **WHEN** a client lists the profile catalogue
- **THEN** it receives summaries and environment-entry counts and no environment
  values

#### Scenario: Generic settings mutation targets the reserved subtree

- **WHEN** a generic settings mutation targets the reserved profile subtree
- **THEN** it is rejected

### Requirement: Profile resolution order for terminal creation

The server SHALL have one default shell-profile selector, initially System
default. A project MAY select its own default profile. Creating a terminal SHALL
resolve the profile in this order: an explicit existing custom or currently
discovered profile id from a user-initiated create action; the project's default
profile id; the server's default profile id; then the reserved System default
profile.

#### Scenario: Project default overrides server default

- **WHEN** a project has its own default profile and no explicit profile is
  supplied
- **THEN** the project's default is used in preference to the server default

#### Scenario: No defaults configured

- **WHEN** neither a project nor a server default is set and no explicit profile
  is supplied
- **THEN** the reserved System default profile is used

### Requirement: Create protocol accepts only a profile id

The create protocol SHALL accept only a profile id and MUST NOT accept an
executable, argument string, environment map, or WSL distribution supplied ad hoc
by a client. The server SHALL resolve the id against its current authorized
profile catalogue.

#### Scenario: Ad-hoc launch configuration is rejected

- **WHEN** a client sends an executable, argument string, environment map, or
  WSL distribution in a terminal create command
- **THEN** the command is rejected

### Requirement: New Terminal actions and splits

The normal **New Terminal** action SHALL use the resolved default. **New
Terminal with Profile…** SHALL provide a one-time choice without changing any
default. Split creation SHALL follow the same selection rules and MUST NOT
silently clone the running process configuration of the active terminal.

#### Scenario: One-time profile choice

- **WHEN** the user launches through **New Terminal with Profile…**
- **THEN** the chosen profile is used for that terminal only and no default
  changes

#### Scenario: Splitting a terminal

- **WHEN** the user splits a terminal that is running a non-default profile
- **THEN** the new terminal resolves through the normal selection order rather
  than cloning the active terminal's running process configuration

### Requirement: Referenced profile deletion and unavailable selections

Deleting a referenced custom profile SHALL be rejected with the server and
project references that must first be reassigned or cleared. Deletion SHALL
recheck those references under the server's profile-mutation lock, so a
disconnected or stale client cannot leave a dangling profile id. If a profile
becomes unavailable after selection, launch SHALL fail visibly and SHALL retain
that selection; Terminay MUST NOT silently run a different custom profile. The
System default profile MAY use its documented fallback chain.

#### Scenario: Deleting a referenced profile

- **WHEN** the user deletes a custom profile referenced by a server or project
  default
- **THEN** the deletion is rejected and the blocking references are listed for
  reassignment or clearing

#### Scenario: Selected profile becomes unavailable

- **WHEN** a selected custom profile's target is no longer available at launch
- **THEN** launch fails visibly, the selection is retained, and no other custom
  profile runs

### Requirement: New terminals start in policy

The server setting **New terminals start in** SHALL support **Current terminal
or panel** (the default), which inherits the active terminal's live working
directory, the active folder, or the containing directory of the active file in
the target project; **Project folder**, which uses the canonical root of the
target project; and **Home folder**, which uses the verified account home
reported by the exact project environment. Working-directory selection SHALL be
part of the canonical launch resolver but SHALL be configured separately from
shell profiles.

#### Scenario: Current terminal or panel

- **WHEN** the policy is Current terminal or panel and a file panel is active
- **THEN** the new terminal starts in the containing directory of that file in
  the target project

#### Scenario: Home folder

- **WHEN** the policy is Home folder
- **THEN** the new terminal starts in the account home verified by the exact
  project environment

### Requirement: Working-directory resolution order

For the default policy, the resolver SHALL consider inputs in this order: an
explicit working directory from an authorized user action; a verified live
working directory from the active terminal, folder, or file panel; the target
project's canonical root; then the project environment's verified account home,
only when the project has no usable root by design. An explicitly requested
missing or non-directory path SHALL fail and MUST NOT be retargeted. A stale
observed panel working directory MAY fall through to the canonical project root.
A configured project root that has become missing or inaccessible SHALL remain a
recoverable project error and MUST NOT be silently replaced with home.

#### Scenario: Explicit path is missing

- **WHEN** an authorized action requests a working directory that does not exist
  or is not a directory
- **THEN** creation fails and the request is not retargeted to another directory

#### Scenario: Missing project root

- **WHEN** the configured project root is missing or inaccessible
- **THEN** a recoverable project error is presented and home is not substituted

#### Scenario: Stale panel cwd

- **WHEN** the observed panel working directory is stale
- **THEN** resolution falls through to the canonical project root

#### Scenario: Project opened at home

- **WHEN** a project rooted at the user's home directory creates its first and
  subsequent terminals
- **THEN** each starts in that home directory

### Requirement: Safe implicit working directories

Implicit values MUST NOT use `"."`, `process.cwd()`, an Electron application
directory, a drive root, or the filesystem root. A root directory SHALL remain
valid when the user explicitly chose it as the project root or explicit working
directory. If no safe implicit directory exists, creation SHALL fail with a
bounded actionable error.

#### Scenario: No safe implicit directory

- **WHEN** no safe implicit working directory can be resolved
- **THEN** terminal creation fails with a bounded actionable error and no
  implicit route starts at `/` or the application process directory

#### Scenario: Explicitly chosen root directory

- **WHEN** the user explicitly chose a root directory as the project root or
  explicit working directory
- **THEN** that directory remains a valid launch target

### Requirement: Project root provenance

Canonical projects SHALL retain root provenance as **explicit**, **server
default**, or **legacy unverified**. A root-like value with legacy unverified
provenance SHALL produce an `unsafe_legacy_root` error until the user confirms or
changes it. Newly selected roots SHALL be explicit, Desktop home seeds SHALL be
server defaults, and operator-supplied standalone roots SHALL be explicit.

#### Scenario: Root-like unverified value

- **WHEN** a project's root is a root-like value with legacy unverified
  provenance
- **THEN** launch produces an `unsafe_legacy_root` error until the user confirms
  or changes the root

#### Scenario: Newly selected root

- **WHEN** the user selects a project root, including a root directory
- **THEN** its provenance is explicit and launch proceeds

### Requirement: Final working-directory validation before spawn

The server SHALL validate and canonicalize the final working directory
immediately before spawn. The resolved working directory returned by terminal
creation and stored in session metadata SHALL be the exact working directory
passed to the PTY.

#### Scenario: Reported cwd matches the PTY

- **WHEN** terminal creation succeeds
- **THEN** the working directory reported in the creation result and session
  metadata is the exact one passed to the PTY

### Requirement: Canonical launch resolution snapshot

One privileged server component SHALL resolve a terminal launch into an
immutable snapshot containing the selected profile id and revision, executable
launch descriptor, argument array, working directory, environment, dimensions,
and safe presentation metadata. Every production creation route SHALL invoke
this component; renderer, Electron bootstrap, protocol adapter, and PTY service
code MUST NOT hold an independent shell or working-directory fallback list.
Resolution and spawn SHALL use one settings and workspace snapshot. A concurrent
profile, project, or settings mutation SHALL either precede that snapshot or
affect the next terminal, and MUST NOT produce a mixed launch.

#### Scenario: Concurrent mutation during launch

- **WHEN** a profile, project, or settings mutation commits while a terminal is
  being resolved and spawned
- **THEN** the launch uses one consistent snapshot and the mutation affects only
  the next terminal

#### Scenario: No independent fallback lists

- **WHEN** any production creation route runs
- **THEN** it resolves through the privileged component rather than a
  renderer, bootstrap, adapter, or PTY-service fallback list

### Requirement: Session metadata retention and environment redaction

The resolved profile identity, target summary, working directory, and creation
time SHALL be retained as terminal-session metadata. Environment values MUST NOT
be retained in workspace snapshots, events, recordings, diagnostics, or error
reports.

#### Scenario: Session records what was resolved

- **WHEN** a profile or default changes after a session was created
- **THEN** that session's metadata still records the profile identity, target
  summary, working directory, and creation time resolved at its creation

#### Scenario: Environment values are absent from diagnostics

- **WHEN** a diagnostic, recording, event, or error report is produced
- **THEN** it contains no launch environment values

### Requirement: Server-side authority over client-supplied launch inputs

The renderer MAY contribute active panel identity and an explicit user choice,
but the server SHALL read the authoritative project, profile, and panel records
and SHALL perform final path and executable validation. Local and remote
transports SHALL use the same command and result shape.

#### Scenario: Client asserts a panel identity

- **WHEN** the renderer supplies an active panel identity and profile choice
- **THEN** the server resolves the authoritative project, profile, and panel
  records itself and validates path and executable before spawn

### Requirement: Shell settings page

The Shell settings page SHALL begin with the server default profile and **New
terminals start in** controls. Shell profile controls SHALL use the same section
headers, grouped setting rows, inputs, buttons, spacing, colours, and responsive
behaviour as every other Settings category. The page MUST NOT repeat the
currently connected server, because all Settings are scoped to that server.
Server locality SHALL be explained only where it affects an operation, such as
executable discovery or profile validation. Profile catalogues SHALL use
contiguous grouped rows rather than visually independent dashboard cards.

#### Scenario: Default configuration needs no editing

- **WHEN** a user opens the Shell settings page without customizing anything
- **THEN** the server default profile reads System default and **New terminals
  start in** reads Current terminal or panel

#### Scenario: Catalogue presentation

- **WHEN** the profile catalogue is rendered
- **THEN** it uses contiguous grouped Settings rows, not independent dashboard
  cards

### Requirement: Profile manager and editor

The profile manager SHALL list System default, discovered profiles, and custom
profiles with availability, source, and default or project-use status. Users
SHALL be able to create, copy, rename, reorder, edit, validate, and delete
custom profiles. The editor SHALL expose target, startup mode, ordered
arguments, environment variables, icon, and colour without requiring JSON or a
quoted command line. Advanced fields SHALL be visually separated and SHALL
explain that profiles can execute programs on the connected server.

#### Scenario: Editing without JSON

- **WHEN** the user edits a custom profile
- **THEN** target, startup mode, ordered arguments, environment variables, icon,
  and colour are editable through fields, with no JSON or quoted command line
  required

#### Scenario: Advanced fields carry a warning

- **WHEN** advanced profile fields are shown
- **THEN** they are visually separated and explain that profiles can execute
  programs on the connected server

### Requirement: Default selectors and discovered-profile actions

Default selectors SHALL contain System default and durable custom profiles. A
discovered profile SHALL offer **Use once** and **Copy to custom profile**
actions and MUST NOT be stored directly as a server or project default.

#### Scenario: Discovered profile in a default selector

- **WHEN** the user views a default selector
- **THEN** it lists System default and durable custom profiles only, while
  discovered profiles offer **Use once** and **Copy to custom profile**

### Requirement: Settings clarity, accessibility, and validation

The UI SHALL clearly identify the server whose profiles are being edited and
MUST NOT imply that a profile is shared across Local and remote connections.
Changes SHALL be revisioned, conflict-aware, keyboard accessible, searchable,
and announced to assistive technology. Validation SHALL report unavailable
targets, duplicate names, unsupported modes, invalid environment keys, and
referenced-profile deletion conflicts inline.

#### Scenario: Invalid environment key

- **WHEN** the user enters an invalid environment key
- **THEN** an inline validation message identifies the field

#### Scenario: Concurrent edit conflict

- **WHEN** a profile change is submitted against a stale revision
- **THEN** the conflict is reported rather than silently overwriting

### Requirement: Ownership of profile and launch persistence

Profiles, server default selection, profile order, and working-directory policy
SHALL be server-owned revisioned settings. Project default profile ids SHALL be
server-owned project state because they affect every client opening a terminal
in that project. Discovered candidates and availability SHALL be runtime
capabilities and MUST NOT be durable configuration.

#### Scenario: Project default visible to every client

- **WHEN** a project's default profile id is set from one client
- **THEN** every client opening a terminal in that project resolves the same
  default

#### Scenario: Discovery results are not persisted

- **WHEN** discovery runs
- **THEN** its candidates and availability are returned as runtime capability
  data and not written to durable configuration

### Requirement: Legacy shell settings migration

Migration from legacy `shell.program`, `shell.startupMode`, and
`shell.extraArgs` SHALL be idempotent. An empty program, automatic mode, and
empty arguments SHALL become System default with no custom profile. Any legacy
override SHALL become one deterministic **Migrated shell** profile, targeting
System default when the program was empty or the configured executable
otherwise. The existing argument parser SHALL convert the legacy string once
into an ordered argument array, and the migrated profile SHALL become the server
default. A value that cannot be represented safely SHALL be retained as an
unavailable migrated profile requiring review, and MUST NOT be discarded or
executed differently. Migration SHALL advance the settings schema, create the
repository's recoverable backup, preserve unrelated settings and revisions, and
produce the same result when retried.

#### Scenario: No legacy override present

- **WHEN** the legacy program is empty, the mode is automatic, and arguments are
  empty
- **THEN** the result is System default with no custom profile

#### Scenario: Legacy override becomes a Migrated shell profile

- **WHEN** a legacy shell override exists
- **THEN** one deterministic **Migrated shell** profile is created from it, its
  legacy argument string is parsed once into an ordered array, and it becomes
  the server default

#### Scenario: Unsafe legacy value

- **WHEN** a legacy value cannot be represented safely
- **THEN** it is retained as an unavailable migrated profile requiring review

#### Scenario: Retried migration

- **WHEN** migration runs again
- **THEN** it produces the same result, preserves unrelated settings and
  revisions, and leaves the recoverable backup intact

### Requirement: Resetting shell profiles

Resetting shell profiles SHALL restore only System default and the default
working-directory policy. It MUST NOT terminate or recreate existing terminals.

#### Scenario: Reset with live terminals

- **WHEN** the user resets shell profiles while terminals are running
- **THEN** System default and the default working-directory policy are restored
  and no running terminal is terminated or recreated

### Requirement: Privileged profile configuration authority

Creating or editing a profile SHALL be privileged server configuration with the
same write authorization as other server settings. Selecting a profile for one
terminal MUST NOT grant permission to create or edit profiles. Executable,
distribution, working-directory, argument, and environment validation SHALL
occur on the server machine.

#### Scenario: Launch-only authority

- **WHEN** a client authorized only to create terminals attempts to create or
  edit a profile
- **THEN** the mutation is rejected

#### Scenario: Forged identity cannot widen scope

- **WHEN** a client asserts an identity or scope it does not hold
- **THEN** validation on the server machine rejects the profile mutation

### Requirement: Profiles contain no secrets or executable script

Profiles MUST NOT contain vault values, secret interpolation, shell command
strings, startup scripts, or arbitrary pre-launch commands. Errors and audit
records MAY identify the profile and invalid field but MUST NOT include
environment values, control tokens, or raw provider or process output.

#### Scenario: Secret reference in a profile

- **WHEN** a profile field contains a secret reference or expansion syntax
- **THEN** it is rejected

#### Scenario: Audit record contents

- **WHEN** a profile error or audit record is written
- **THEN** it names the profile and invalid field and contains no environment
  values, control tokens, or raw provider or process output

### Requirement: Launch failure behaviour

An unavailable target, invalid working directory, unsupported startup mode,
invalid WSL distribution, or PTY spawn failure SHALL leave no live session and
no durable terminal panel. The client SHALL receive a bounded error code and
actionable message. Profile validation SHALL be advisory; launch SHALL always
validate again to cover host changes and races.

#### Scenario: PTY spawn fails

- **WHEN** the PTY fails to spawn
- **THEN** no live session and no durable terminal panel remain, and the client
  receives a bounded error code with an actionable message

#### Scenario: Host changes after validation

- **WHEN** a profile validated successfully but its target changed before launch
- **THEN** launch validates again and fails visibly

### Requirement: Shell profile non-goals

Terminay MUST NOT synchronize profiles between different Terminay Servers,
import shell profiles from another terminal application's private format,
persist environment values in terminal or recording metadata, run arbitrary
pre-launch or post-launch hooks from a profile, or change the shell or working
directory of an already running terminal.

#### Scenario: Profiles are not shared across servers

- **WHEN** the user connects to a second Terminay Server
- **THEN** that server's own profile catalogue is presented and no profile is
  synchronized between servers

#### Scenario: Running terminal is unchanged

- **WHEN** a profile or working-directory setting changes while a terminal runs
- **THEN** that terminal's shell and working directory are unchanged
