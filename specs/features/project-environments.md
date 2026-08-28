# Project environments

## Summary

A project environment identifies where one Terminay project executes terminals
and accesses files. Terminay Server owns environment profiles, bindings,
capability routing, status, credentials, and lifecycle. A workspace view may
contain projects using different environments while Desktop and browser clients
remain presentation-only.

All public project-environment operations and events use the protocol-valid
`project-environments.*` namespace with lowercase kebab-case suffixes. Fixed
names are checked against the protocol grammar before release so Desktop-local
shortcuts cannot hide a name that authenticated browser transports reject.

The built-in **This server** provider preserves current local behavior. The SSH
extension connects to existing machines, and infrastructure extensions such as
Puzed can provision or manage a machine before composing an SSH-backed project
environment.

See [server-owned project environments](../decisions/server-owned-project-environments.md)
for the governing topology.

## Terminology

- A **provider** is a built-in or installed server extension contribution that
  implements project-environment capabilities.
- An **environment profile** is reusable server-owned provider configuration,
  such as an SSH endpoint or Puzed Platform account. It contains only redacted
  metadata and vault references.
- A **project environment** is one stable runtime binding used by projects. It
  may reference one profile or compose several providers, such as a Puzed VM
  managed through the Puzed API and reached through SSH.
- An **environment revision** is an immutable configuration generation. Active
  projects remain pinned until an explicit validated update.
- A **This server environment** executes on the selected Terminay Server host.
  It is not necessarily local to the Desktop or browser device.

Terminay Server connections remain the separate client-to-server concept in
[connections and client hosts](./connections-and-client-hosts.md).

### User-facing provider and connection terms

The extension and server protocol retain **environment profile** as the stable
generic transport/persistence term. The management UI must not present every
profile as a project target, however:

- a saved Puzed Platform account is displayed as a **Puzed provider**; it is
  reusable management context, not a connection that can open a project; and
- a saved SSH target or Terminay-managed Puzed VM is displayed as a
  **connection**. It is the selectable execution target from which a project
  environment/project may be created.

This wording is presentation-only. Opaque profile, environment, provider and
revision identities remain server-owned, and no renderer migration or copied
credential is introduced by the labels.

## Canonical model and persistence

Terminay Server persists a revisioned environment registry containing:

- stable profile and environment ids, provider/extension ownership, name, safe
  endpoint summary, optional default root, and presentation metadata;
- immutable configuration revisions and the active/recommended revision;
- declared and currently available capabilities;
- lifecycle status, last successful check, bounded failure classification, and
  references to durable provider operations;
- namespaced vault references, never credential values;
- extension dependency and compatibility state; and
- reference counts needed to block unsafe removal.

Each workspace project stores one immutable `projectEnvironmentId`. Each
terminal session snapshots that identity and validation requires it to equal
the owning project's environment. Environment configuration and secret
references do not enter workspace snapshots.

The reserved This server environment is created by the server, cannot be
deleted, and is available without an npm extension. Existing projects migrate
idempotently to it without changing project, view, panel, terminal, layout, or
presentation identities. Existing project roots retain a
`legacy-unverified` origin until validated; new environment-default roots use
an explicit `environment-default` origin.

Deleting or uninstalling an environment/profile/provider is blocked while it
is referenced. Archiving or disabling it preserves references and makes
affected projects visibly unavailable. Reinstalling compatible provider code
can recover them.

## Environment capabilities

Every environment used for a full project provides:

- `terminal`: create and control a server-owned terminal session through the
  environment runtime; and
- `filesystem`: canonical project roots, bounded listing/read/write, and path
  validation inside the environment.

Providers advertise other capabilities independently:

- filesystem observation;
- Git command and worktree execution;
- current-directory and foreground-process observation;
- authoritative agent-journal observation;
- infrastructure inventory and lifecycle actions; and
- environment-specific shell discovery.

Persisted capability lists keep only current capabilities. Unknown tokens are
dropped when the registry is loaded so a retired capability cannot prevent
This server from starting. Routing uses the live provider contribution, so a
provider that later gains Git still serves Git on existing ready environments
instead of failing as `query failed` from a create-time snapshot.

Unavailable optional capabilities render a clear limited/unavailable state.
They never run against the Terminay Server host merely because the same path or
binary exists there. Watch and folder-size protocol names route as
`filesystem-observation`; listing, read, and write stay on `filesystem`.

The SSH provider supplies Git queries through the selected remote connection.
For a remote root that is not a repository, Git discovery and the worktree
listing return the normal empty/not-repository result; they must not fall back
to the Terminay Server's Git process or surface a transport failure in the
project UI.

## Runtime routing

For every project-scoped terminal, filesystem, file, folder, Git, macro,
recording, agent, activity, MCP, shell, and environment action, the server:

1. authenticates the client from its transport-bound principal;
2. resolves all addressed project/resource identities from canonical state;
3. derives the exact project environment and pinned revision;
4. verifies the requested capability and current provider lifecycle;
5. invokes the environment runtime with a bounded server-issued context,
   deadline, cancellation, and only the secret references it is permitted to
   resolve; and
6. publishes a bounded typed outcome without raw provider errors or secrets.

Clients do not choose providers or adapters. A supplied environment id may be
used only as an expected-value consistency check. Labels, hostnames, IPs, URLs,
roots, and current focus carry no authority.

Runtimes may pool one transport for the exact profile/environment revision, but
channels, roots, projects, terminal sessions, drafts, and authorization remain
independently scoped. Editing shared profile configuration creates a new
revision. Referencing projects show **Update connection available** and switch
only after explicit validation; live projects never change machine authority
under mounted panels.

## Roots and project creation

Each environment can report an account home and optional profile default root.
New projects use the profile default when configured, otherwise the verified
environment home. New This server projects use the Terminay Server account
home. They do not copy the active project's root.

Providers validate and canonicalize a proposed root before the project commit.
The pre-project root browser is a bounded provider capability because ordinary
project filesystem authority does not exist until creation. `~` expansion is
provider-owned and persisted roots are canonical absolute target paths.

Changing a project root uses the named revisioned root-update command. The
server prepares the new environment filesystem/Git contexts and commits them
only if workspace mutation succeeds. Generic project presentation updates
cannot replace a root. A profile's changed default affects future projects only;
**Use environment default** is an explicit per-project action.

## Project and panel movement

Workspace views may contain mixed environments. Moving a complete project to
another view preserves its environment, panels, sessions, streams, and service
identities.

A panel move between unequal environment ids is rejected before mutation. A
terminal is never killed and recreated on another machine to simulate a move.
Until exact same-environment terminal rebinding updates workspace state,
TerminalService identity, presentation leases, activity, agents, MCP, and
recording atomically, cross-project terminal movement remains unavailable.
File/folder movement additionally requires canonical target-root validation.

Retargeting an existing project is outside the initial contract. Users create a
new project on the desired environment; future migration must explicitly
handle live sessions, dirty drafts, paths, and external resources.

## Status, failure, and recovery

Safe public statuses include `ready`, `connecting`, `reconnecting`,
`provisioning`, `starting`, `stopping`, `offline`,
`authentication-required`, `host-key-changed`, `permission-denied`,
`extension-missing`, `extension-disabled`, `extension-incompatible`,
`unreachable`, and `failed`.

- A disconnected or unavailable existing project remains in its view with its
  panels and root metadata. It offers retry and environment details.
- A client disconnect/reload does not change environment or terminal lifetime.
- Provider transport loss interrupts affected terminal sessions exactly once
  when survival cannot be proven. It never silently creates a new remote shell
  under an existing session id.
- File drafts remain server-owned across transport loss. Ambiguous remote writes
  report outcome unknown/conflict and are not blindly retried.
- Provider failure is scoped. It cannot stop Local or another extension.
- Server shutdown stops admissions, cancels bounded provider operations, asks
  each runtime to deactivate, and does not stop or delete infrastructure unless
  the user separately requested that lifecycle action.
- Missing provider/capability/credential and every connection failure fail
  explicitly. No route falls back to This server or another profile.

## Project-bar and management experience

The project bar uses an accessible split button. Its `+` and arrow are
separate icon buttons with the same even pacing as the panel-strip add
controls, not a joined chip:

- the primary `+` immediately creates a new This server project;
- every equivalent native-menu, keyboard-shortcut, and command-palette action
  invokes that same server-owned This server operation and acknowledges
  completion only after the operation has settled; and
- the arrow opens **Choose project environment**.

Opening the chooser refreshes its inventory from the currently authenticated
Terminay Server. A query attempted while the shared client is still connecting
must not permanently cache an empty inventory: the chooser retries on open and
continues to show the last successfully authenticated snapshot during transient
transport recovery. Desktop and browser therefore converge on the same
server-owned inventory without keeping a renderer-owned copy as authority.

The menu groups selectable connections by their owning provider: **This
Terminay Server**, recent/favourite SSH connections, and recent Puzed VMs by
Puzed provider. A Puzed provider itself is never an openable menu item. Direct
actions distinguish **New Puzed provider…** from **Create VM in
<provider>…**, followed by **Project
Environments…**, and **Extensions…**. Large inventories use searchable pickers
instead of unbounded menus. **This server** includes secondary text such as
`Local to Production Terminay`.

Provider actions are derived from the currently authenticated server snapshot,
not hardcoded client knowledge. Each saved profile whose provider contributes a
create form appears as a direct creation action, including **Create new
Puzed VM…**. Adding new connections is a Project Environments management
action, not a project-chooser action. Choosing a direct creation action opens
the same Project Environments window with its sidebar and authority context
preserved and the requested form already selected.

Saving a connection profile does not implicitly create a project environment
unless its currently activated public provider contribution explicitly declares
`profileSave: { createEnvironment: true }`. This lets direct connections expose
their intentional one-step journey while Puzed profile saves remain profiles
until the user supplies the VM create-form values.

Project creation is atomic from the user's perspective: the target and initial
root validate before a normal project tab is committed. Provider glyph/status
may appear subtly on the tab and environment chip, with complete accessible
text. Project editing shows immutable environment identity/status, root,
**Use environment default**, appearance, and environment-valid shell choices.

**File → Project Environments…** opens or focuses a first-class management
surface named **Project Environments**. Its standard Settings sidebar has
separate **Providers** and **Connections** sections. A Puzed provider shows
safe service/account facts and its child connection count; a connection shows
its owner, safe endpoint/default-root/status metadata, project references, and
connection lifecycle actions. Provider Test/Edit/Remove is never shown as
connection management for a Puzed VM. On Desktop it is a dedicated native
auxiliary window with the same
window chrome, content frame, responsive layout conventions, and focus/reuse
behaviour as Settings, Macros, and Recordings. It is not a project-editor sheet
and must not use that sheet's oversized centered-dialog presentation or an
independent dashboard-style list/detail frame. The environment list is the
standard Settings/Macros sidebar; environment facts and actions use ordinary
Settings headers, groups, and rows. In a
browser, the same shared route is presented in-page with equivalent management
semantics. Repeated invocation focuses the existing presentation instead of
opening duplicates.

Server-operation failures appear in a dedicated, in-flow content panel above
the current provider, connection, or declarative form. The panel may offer
Retry, but is never a fixed or floating overlay: the selected detail and its
recovery controls must remain visible and usable.

An unreferenced connection offers **Remove connection**. This forgets only
Terminay's local project-environment record; it never deletes, powers off, or
otherwise mutates provider infrastructure.
The action is blocked while a project references the connection. A Puzed
provider with no referenced projects can also be removed directly. This
atomically forgets its unreferenced child connection records and the provider's
local credential/profile record; it never deletes, powers off, or otherwise
mutates the Puzed VMs. A provider used by any project remains blocked with an
explicit reference explanation.

Editing a provider hydrates its previously saved non-secret form values. Secret
fields are never returned to a client: they are shown empty with explicit
“leave blank to keep the existing value” guidance, and an empty submitted
secret preserves the existing vault value.

The project-bar chooser's **Project Environments…** action and the matching
Command Bar action invoke that same semantic route. Extension installation and
updates are not duplicated in this window: links that require an environment
provider open Settings at its **Extensions** section.

Every running provider with a profile form contributes a clear creation action.
For Puzed this is **New Puzed provider…**; saving it stores its URL and API-key
secret and returns to that provider detail without creating a VM or project.
That detail exposes **Create VM…** and its provider-scoped connection list.
Saving SSH creates a saved SSH connection. Installing or enabling a provider
makes these actions available without
restarting the app, and focusing the window refreshes provider inventory.
The embedded Desktop vault is unlocked only after Electron reports the app as
ready and before the Local server is reported ready or any project window is
created. A transient pre-ready `safeStorage` unavailable result must not become
a durable unavailable vault state. On a supported OS-backed storage backend,
the first secret-backed SSH or Puzed profile save after launch succeeds without
requiring a restart or a separate vault action.
Creation and editing are modes of this same management surface: the standard
environment sidebar, search, server authority, and footer remain visible while
the right-hand pane shows the form. Cancel and successful Save return to the
selected environment. Provider creation is offered as one compact sidebar
action/menu, not as a row of floating buttons in the detail header.

Provider-contributed forms do not introduce a second visual language. The
generic renderer uses the same category header, uppercase section labels,
bordered Settings groups, single setting rows, field descriptions, controls,
buttons, validation banners, and action spacing as the existing Settings,
Macros, and Recordings surfaces. Each ordinary field is one responsive row
with its label and help text on the left and its control on the right. Related
fields are never arranged as an arbitrary dashboard grid.

Provider sections marked as disclosures render as compact Settings rows with a
chevron and optional summary. A collapsed disclosure occupies one normal row;
it must not appear as a large empty card. Expanding it reveals ordinary setting
rows within the same group. Preset choices may use compact selectable cards
only where comparison is materially useful, and remain contained within one
stacked setting row. Forms end with the standard secondary **Cancel** and
primary save/create actions. These rules apply equally to official SSH and
Puzed forms and to third-party providers.

Every field with `optionSource` is resolved through the fixed
`project-environments.resolve-options` server operation using the exact
provider, selected profile, current form values, query, deadline, and
cancellation signal. The form loads initial options when it opens and reloads
dependent choices when their inputs change; it presents loading, empty, and
bounded provider-error states instead of an inert empty select. No renderer
substitutes static Puzed images, sizes, workers, bridges, or profiles.

## Authorization and audit

Environment/profile management, secret replacement, host-trust changes,
provider lifecycle, and infrastructure mutations require explicit
transport-bound permissions. Project-scoped principals may use their exact
project environment but cannot enumerate or manage unrelated profiles.
The embedded Desktop renderer is also a transport-bound principal; its private
MessagePort receives the same explicit environment and extension permissions
as an authenticated administrative browser and never relies on its `admin`
scope label as implicit authority.

Audit records include the authenticated principal/device, opaque
extension/profile/environment/project ids, safe action, result, revision, and
timestamp. They exclude credentials, authorization headers, key material,
terminal bytes, complete provider responses, and root paths.

## Acceptance outcomes

- Desktop Project Environments management uses a dedicated, reusable native
  management window visually consistent with Settings, Macros, and Recordings;
  it never renders in project/tab editor modal chrome.
- File, Command Bar, and project-chooser entry points all open or focus the
  same Project Environments presentation, while browsers render its shared
  route in-page.
- One view contains This server, SSH, and Puzed projects simultaneously.
- Desktop and browser clients connected to one server see identical environment
  bindings and statuses and hold no environment credentials locally.
- Every provider profile/create form uses the established Settings row/group
  primitives; collapsed sections are compact rows and no provider can create
  oversized empty cards or a two-column dashboard-style field grid.
- A remote Terminay Server can execute its own This server project and connect
  outward to other environments.
- Existing projects migrate to This server without identity/layout changes.
- Copied environment ids, labels, paths, or hostnames cannot redirect an
  operation.
- Identical path text in different environments remains fully isolated.
- Cross-environment panel movement fails atomically; moving the whole project
  between views succeeds.
- Missing/crashed extensions and unreachable targets preserve the project and
  never invoke local terminal, filesystem, Git, agent, or MCP fallbacks.
- New projects begin at the selected environment's configured default or home.
