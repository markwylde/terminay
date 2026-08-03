# Shell profiles and terminal launch

## Summary

Terminay launches every terminal from a server-owned shell profile and one
canonical launch policy. A profile describes the program, arguments,
environment, and presentation of a shell; the launch policy selects the
profile and working directory from explicit, project, and server defaults.
Startup, new-project, new-tab, split, Desktop, browser, local, and remote
creation all resolve through this same boundary.

Terminay provides a **System default** profile that requires no configuration,
discovers useful profiles on the server machine, and supports named custom
profiles. Profile and working-directory changes affect only terminals created
after the change.

Related features:

- [Terminal workspace](./terminal-workspace.md)
- [Settings, shortcuts, and desktop integration](./settings-shortcuts-and-desktop-integration.md)
- [Workspace and project tabs](./workspace-and-project-tabs.md)
- [Server-owned workspace state](./server-owned-workspace-state.md)

## Profile model

Shell profiles belong to one Terminay Server. A client connected to another
server sees that server's profiles and never sends a local executable path as
the remote server's default.

The profile catalogue contains one reserved, undeletable **System default**
profile, read-only profiles discovered from the server operating system, and
durable custom profiles created or copied by the user.

Every profile has a stable opaque id, a unique display name, a launch target,
an ordered argument array, a startup mode, an environment overlay, and optional
terminal icon and colour metadata. Renaming or restyling a profile does not
change its identity. User-facing order is durable.

A launch target is one of:

- `system`, resolved from the server account at launch time;
- `executable`, containing a native executable path or a platform-valid
  executable name; or
- `wsl`, containing a Windows Subsystem for Linux distribution and optional
  shell path without encoding those fields into one command string.

The startup mode is **Shell default**, **Login**, or **Non-login**. Shell
default uses the selected shell's normal interactive PTY behaviour. Login and
non-login are translated only for shells whose semantics Terminay knows; an
unsupported combination is rejected instead of receiving a guessed flag.
Additional arguments remain an array and are passed directly to the program
without shell parsing, interpolation, or command-string execution.

A WSL profile must name an explicit Linux shell before it can use startup mode,
arguments, or an environment overlay. Terminay translates the structured WSL
target without treating arguments as an implicit Linux command. Windows
environment keys are compared case-insensitively, and `WSLENV` remains
server-managed.

An environment overlay maps variable names to string values or `null`; `null`
removes a non-protected inherited variable. It contains no secret references or
expansion syntax. Terminay applies the host baseline first, then the profile
overlay, then server-managed terminal identity, authorization, control, locale,
and compatibility values. Profiles cannot replace or remove protected
server-managed variables, including the `TERMINAY_` namespace.

Profiles and their fields are bounded. The server accepts at most 64 durable
profiles, 64 arguments per profile, 128 environment entries per profile, and
bounded names, paths, keys, and values. One encoded profile is at most 16 KiB
and the complete durable profile configuration is at most 32 KiB, leaving
headroom beneath every production application-frame limit. Invalid or
over-budget records are reported without being persisted or executed.

## Discovery and system defaults

Discovery executes on Terminay Server and returns capability data rather than
persisted settings. Refreshing discovery can add, remove, or mark candidates
unavailable without rewriting a custom profile or changing the selected
default.

On macOS and Linux, Terminay prefers the server account's configured login
shell, then a valid absolute `SHELL` value, then executable entries from
`/etc/shells`. If none is usable, macOS tries zsh, bash, then sh; Linux tries
bash, zsh, then sh. Every candidate must exist and be executable. Terminay
canonicalizes and deduplicates executable paths. The inherited Electron or
service environment is not by itself proof of the account default.

On Windows, Terminay discovers PowerShell 7, Windows PowerShell, Command Prompt,
Git Bash, and installed WSL distributions when available. System default tries
a validated `SHELL`, the OpenSSH `DefaultShell`, Windows PowerShell, and
`ComSpec`, in that order, and fails if none is usable. PowerShell 7 is offered
when discovered but is not silently substituted for the operating-system
default. WSL distribution identity remains structured so spaces and command
arguments cannot alter the selected distribution.

Discovered profiles include availability and source metadata. Copying one
creates an independent custom profile; otherwise it remains read-only and may
change with the host installation. A custom profile whose target disappears is
retained and shown as unavailable.

Runtime-only discovered profiles may be used for a one-off launch, but a server
or project default must reference System default or a durable custom profile.
Choosing a discovered profile as a default first copies its structured launch
configuration into a custom profile. This keeps durable references meaningful
when host discovery changes and avoids inventing an incomplete tombstone for a
profile that was never persisted.

Catalogue responses contain profile summaries and environment-entry counts,
not environment values. A write-authorized detail query returns one bounded
custom profile for editing. Generic settings reads/change events also redact
profile environment values, and generic settings mutation cannot modify the
reserved profile subtree.

## Defaults and selection

The server has one default shell-profile selector, initially **System
default**. A project may optionally select its own default profile. Creating a
terminal resolves the profile in this order:

1. an explicit existing custom or currently discovered profile id from a
   user-initiated create action;
2. the project's default profile id;
3. the server's default profile id; and
4. the reserved System default profile.

The create protocol accepts only a profile id, never an executable, argument
string, environment map, or WSL distribution supplied ad hoc by a client. The
server resolves the id against its current authorized profile catalogue.

The normal **New Terminal** action uses the resolved default. **New Terminal
with Profile…** provides a one-time choice without changing any default. Split
creation follows the same selection rules; it does not silently clone the
running process configuration of the active terminal.

Deleting a referenced custom profile is rejected with the server and project
references that must first be reassigned or cleared. Deletion rechecks those
references under the server's profile-mutation lock, so a disconnected or stale
client cannot leave a dangling profile id. Terminay does not describe a sequence
of independent settings/workspace commits as atomic. If a profile becomes
unavailable after selection, launch fails visibly and retains that selection;
Terminay does not silently run a different custom profile. The System default
profile may use its documented fallback chain.

## Working-directory policy

Working-directory selection is part of the canonical launch resolver but is
configured separately from shell profiles. The server setting **New terminals
start in** supports:

- **Current terminal or panel** (default): inherit the active terminal's live
  cwd, the active folder, or the containing directory of the active file in the
  target project;
- **Project folder**: use the canonical root of the target project; and
- **Home folder**: use the verified home of the server account.

For the default policy, the resolver considers inputs in this order:

1. an explicit cwd from an authorized user action;
2. a verified live cwd from the active terminal, folder, or file panel;
3. the target project's canonical root; and
4. the server account's verified home only when the project has no usable root
   by design.

An explicitly requested missing or non-directory path fails; it is not
retargeted. A stale observed panel cwd may fall through to the canonical project
root. A configured project root that has become missing or inaccessible remains
a recoverable project error and is not silently replaced with home.

Implicit values never use `"."`, `process.cwd()`, an Electron application
directory, a drive root, or filesystem root. A root directory remains valid
when the user explicitly chose it as the project root or explicit cwd. If no
safe implicit directory exists, creation fails with a bounded actionable error.

Canonical projects retain root provenance as **explicit**, **server default**,
or **legacy unverified**. Workspace migration cannot infer whether an old
root-like value was intentional, so it marks legacy roots unverified. A
root-like legacy value produces an `unsafe_legacy_root` error until the user
confirms or changes it; newly selected roots are explicit, Desktop home seeds
are server defaults, and operator-supplied standalone roots are explicit.

The server validates and canonicalizes the final cwd immediately before spawn.
The resolved cwd returned by terminal creation and stored in session metadata
is the exact cwd passed to the PTY.

## Canonical launch resolution

One privileged server component resolves a terminal launch into an immutable
snapshot containing the selected profile id and revision, executable launch
descriptor, argument array, cwd, environment, dimensions, and safe presentation
metadata. Every production creation route invokes this component; renderer,
Electron bootstrap, protocol adapter, and PTY service code have no independent
shell or cwd fallback lists.

Resolution and spawn use one settings/workspace snapshot. A concurrent profile,
project, or settings mutation either precedes that snapshot or affects the next
terminal; it cannot produce a mixed launch. The resolved profile identity,
target summary, cwd, and creation time are retained as terminal-session
metadata. Environment values are not retained in workspace snapshots, events,
recordings, diagnostics, or error reports.

The renderer may contribute active panel identity and an explicit user choice,
but the server reads the authoritative project, profile, and panel records and
performs final path and executable validation. Local and remote transports use
the same command and result shape.

Every xterm-backed host advertises `COLORTERM=truecolor` in the canonical
launch environment. The initial terminal and terminals created later through
`terminal.create` therefore expose the same colour capability to child
programs; creation route and attachment timing must not change ANSI background
or true-colour rendering.

## Settings experience

The Shell settings page begins with the server default profile and **New
terminals start in** controls. Most users can leave both at **System default**
and **Current terminal or panel**.

Shell profile controls use the same section headers, grouped setting rows,
inputs, buttons, spacing, colours, and responsive behaviour as every other
Settings category. The page does not repeat the currently connected server,
because all Settings are scoped to that server. Server locality is explained
only where it affects an operation, such as executable discovery or profile
validation. Profile catalogues use contiguous grouped rows rather than visually
independent dashboard cards.

The profile manager lists System default, discovered profiles, and custom
profiles with availability, source, and default/project-use status. Users can
create, copy, rename, reorder, edit, validate, and delete custom profiles. The
editor exposes target, startup mode, ordered arguments, environment variables,
icon, and colour without requiring JSON or a quoted command line. Advanced
fields are visually separated and explain that profiles can execute programs on
the connected server.

Default selectors contain System default and durable custom profiles. A
discovered profile offers **Use once** and **Copy to custom profile** actions;
it is not stored directly as a server or project default.

The UI clearly identifies the server whose profiles are being edited. It does
not imply that a profile is shared across Local and remote connections. Changes
are revisioned, conflict-aware, keyboard accessible, searchable, and announced
to assistive technology. Validation reports unavailable targets, duplicate
names, unsupported modes, invalid environment keys, and referenced-profile
deletion conflicts inline.

## Persistence and migration

Profiles, server default selection, profile order, and cwd policy are
server-owned revisioned settings. Project default profile ids are server-owned
project state because they affect every client opening a terminal in that
project. Discovered candidates and availability are runtime capabilities and
are not durable configuration.

Migration from legacy `shell.program`, `shell.startupMode`, and
`shell.extraArgs` is idempotent:

- an empty program, automatic mode, and empty arguments become System default
  with no custom profile;
- any legacy override becomes one deterministic **Migrated shell** profile,
  targeting System default when the program was empty or the configured
  executable otherwise;
- the existing argument parser converts the legacy string once into an ordered
  argument array, and the migrated profile becomes the server default; and
- a value that cannot be represented safely is retained as an unavailable
  migrated profile requiring review, not discarded or executed differently.

Migration advances the settings schema, creates the repository's recoverable
backup, preserves unrelated settings and revisions, and produces the same
result when retried. Resetting shell profiles restores only System default and
the default cwd policy; it does not terminate or recreate existing terminals.

## Security and failure behaviour

Creating or editing a profile is privileged server configuration with the same
write authorization as other server settings. Selecting a profile for one
terminal does not grant permission to create or edit profiles. Executable,
distribution, cwd, argument, and environment validation occurs on the server
machine.

Profiles do not contain vault values, secret interpolation, shell command
strings, startup scripts, or arbitrary pre-launch commands. Errors and audit
records may identify the profile and invalid field but never include environment
values, control tokens, or raw provider/process output.

An unavailable target, invalid cwd, unsupported startup mode, invalid WSL
distribution, or PTY spawn failure leaves no live session or durable terminal
panel. The client receives a bounded error code and actionable message. Profile
validation is advisory; launch always validates again to cover host changes and
races.

## Acceptance outcomes

- App startup, a new project, a new tab, a split, and a one-off profile launch
  use the same profile and cwd resolver on Desktop and browser clients.
- With default settings on macOS, a user whose account shell is zsh receives an
  interactive zsh in the project or inherited cwd for every creation route.
- A project opened at the user's home starts its first and subsequent terminals
  in that home directory; no implicit route starts at `/`.
- Linux, macOS, Windows native, Windows WSL, and remote-server discovery expose
  only profiles available on the machine that will run the PTY.
- Custom arguments preserve array boundaries, environment overlays cannot
  replace protected values, and no profile field is evaluated as a shell
  command.
- Server and project defaults, one-off selection, unavailable profiles,
  referenced deletion, reset, and legacy migration behave deterministically.
- Changing a profile or default never changes an existing session. Session
  metadata records what was resolved when that session was created.
- Missing project roots and invalid explicit directories fail visibly instead
  of falling back to home or the application process directory.
- Legacy root-like project values require explicit confirmation before launch,
  while a newly and explicitly selected root project remains supported.
- Cross-host and reconnect tests prove that a remote client cannot select a
  local-only profile or widen its server/project/session boundary.

## Non-goals

- Synchronizing profiles between different Terminay Servers.
- Importing shell profiles from another terminal application's private format.
- Persisting environment values in terminal or recording metadata.
- Running arbitrary pre-launch or post-launch hooks from a profile.
- Changing the shell or cwd of an already running terminal.
