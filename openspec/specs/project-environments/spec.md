# project-environments Specification

## Purpose

A project environment identifies where one Terminay project executes terminals and accesses files. Terminay Server owns environment profiles, bindings, capability routing, status, credentials, and lifecycle, so a workspace view may contain projects using different environments while Desktop and browser clients remain presentation-only.

## Requirements

### Requirement: Server ownership of project environments

Terminay Server SHALL own environment profiles, bindings, capability routing, status, credentials, and lifecycle. Desktop and browser clients SHALL remain presentation-only and SHALL NOT hold environment credentials locally. A workspace view MAY contain projects using different environments.

#### Scenario: Mixed environments in one view

- **WHEN** a workspace view contains This server, SSH, and Puzed projects
- **THEN** all of them are present in that one view simultaneously

#### Scenario: Two clients on one server

- **WHEN** a Desktop client and a browser client are connected to one server
- **THEN** both see identical environment bindings and statuses
- **AND** neither holds environment credentials locally

#### Scenario: Remote server executing its own projects

- **WHEN** a project is opened on a remote Terminay Server using **This server**
- **THEN** the server executes it on its own host
- **AND** the same server can also connect outward to other environments

### Requirement: Protocol namespace for environment operations

All public project-environment operations and events SHALL use the protocol-valid `project-environments.*` namespace with lowercase kebab-case suffixes. Fixed names SHALL be checked against the protocol grammar before release so a Desktop-local shortcut cannot hide a name that authenticated browser transports reject.

#### Scenario: Name validated before release

- **WHEN** a public project-environment operation or event name is introduced
- **THEN** it uses the `project-environments.*` namespace with a lowercase kebab-case suffix
- **AND** it is checked against the protocol grammar before release

### Requirement: Provider, profile, environment, and revision model

A **provider** is a built-in or installed server extension contribution implementing project-environment capabilities. An **environment profile** is reusable server-owned provider configuration containing only redacted metadata and vault references. A **project environment** is one stable runtime binding used by projects, which MAY reference one profile or compose several providers. An **environment revision** is an immutable configuration generation; active projects SHALL remain pinned until an explicit validated update. A **This server environment** executes on the selected Terminay Server host and is not necessarily local to the Desktop or browser device.

#### Scenario: Composed environment

- **WHEN** a Puzed VM is managed through the Puzed API and reached through SSH
- **THEN** one project environment composes both providers as a single stable runtime binding

#### Scenario: Configuration edited

- **WHEN** an environment's configuration is edited
- **THEN** a new immutable revision is created
- **AND** active projects remain pinned to their existing revision until an explicit validated update

### Requirement: User-facing provider and connection terms

The extension and server protocol SHALL retain **environment profile** as the stable generic transport and persistence term. The management UI SHALL display a saved Puzed Platform account as a **Puzed provider** — reusable management context that cannot open a project — and SHALL display a saved SSH target or Terminay-managed Puzed VM as a **connection**, the selectable execution target from which a project environment or project may be created. This wording is presentation-only: opaque profile, environment, provider, and revision identities remain server-owned.

#### Scenario: Puzed account presented

- **WHEN** a saved Puzed Platform account is shown in the management UI
- **THEN** it is displayed as a **Puzed provider** and is not offered as a project target

#### Scenario: SSH target presented

- **WHEN** a saved SSH target or Terminay-managed Puzed VM is shown
- **THEN** it is displayed as a **connection** from which a project environment or project may be created
- **AND** no renderer migration or copied credential is introduced by the labels

### Requirement: Environment registry persistence

Terminay Server SHALL persist a revisioned environment registry containing stable profile and environment ids, provider/extension ownership, name, safe endpoint summary, optional default root, and presentation metadata; immutable configuration revisions and the active/recommended revision; declared and currently available capabilities; lifecycle status, last successful check, bounded failure classification, and references to durable provider operations; namespaced vault references and never credential values; extension dependency and compatibility state; and reference counts needed to block unsafe removal.

#### Scenario: Registry contents

- **WHEN** the environment registry is persisted
- **THEN** it stores namespaced vault references rather than credential values
- **AND** it stores reference counts sufficient to block unsafe removal

### Requirement: Project and session environment binding

Each workspace project SHALL store one immutable `projectEnvironmentId`. Each terminal session SHALL snapshot that identity, and validation SHALL require it to equal the owning project's environment. Environment configuration and secret references SHALL NOT enter workspace snapshots.

#### Scenario: Session validated against its project

- **WHEN** a terminal session's stored environment identity differs from the owning project's environment
- **THEN** validation fails and the operation is rejected

#### Scenario: Workspace snapshot content

- **WHEN** a workspace snapshot is produced
- **THEN** it contains the project's environment identity
- **AND** it contains no environment configuration or secret reference

### Requirement: Reserved This server environment

The reserved This server environment SHALL be created by the server, SHALL NOT be deletable, and SHALL be available without an npm extension. Existing projects SHALL migrate idempotently to it without changing project, view, panel, terminal, layout, or presentation identities. Existing project roots SHALL retain a `legacy-unverified` origin until validated, and new environment-default roots SHALL use an explicit `environment-default` origin.

#### Scenario: Migration to This server

- **WHEN** existing projects are bound to the reserved This server environment
- **THEN** their project, view, panel, terminal, layout, and presentation identities are unchanged
- **AND** repeating the operation produces the same result

#### Scenario: Root origin

- **WHEN** a project root is recorded
- **THEN** an existing unvalidated root carries the `legacy-unverified` origin
- **AND** a new root taken from the environment default carries the `environment-default` origin

### Requirement: Removal blocked while referenced

Deleting or uninstalling an environment, profile, or provider SHALL be blocked while it is referenced. Archiving or disabling it SHALL preserve references and make affected projects visibly unavailable. Reinstalling compatible provider code SHALL recover them.

#### Scenario: Referenced environment deletion attempt

- **WHEN** deletion or uninstallation is attempted for a referenced environment, profile, or provider
- **THEN** the action is blocked

#### Scenario: Provider archived then reinstalled

- **WHEN** a referenced provider is archived or disabled
- **THEN** references are preserved and affected projects become visibly unavailable
- **AND** reinstalling compatible provider code recovers them

### Requirement: Required and optional environment capabilities

Every environment used for a full project SHALL provide `terminal` — create and control a server-owned terminal session through the environment runtime — and `filesystem` — canonical project roots, bounded listing, read, write, and path validation inside the environment. Providers SHALL advertise other capabilities independently: filesystem observation; Git command and worktree execution; current-directory and foreground-process observation; authoritative agent-journal observation; infrastructure inventory and lifecycle actions; and environment-specific shell discovery.

#### Scenario: Full project environment

- **WHEN** an environment is used for a full project
- **THEN** it provides `terminal` and `filesystem` capabilities

#### Scenario: Protocol name routing

- **WHEN** a watch or folder-size operation is requested
- **THEN** it routes as `filesystem-observation`
- **AND** listing, read, and write route on `filesystem`

### Requirement: Live capability routing

Persisted capability lists SHALL keep only current capabilities, and unknown tokens SHALL be dropped when the registry is loaded so a retired capability cannot prevent This server from starting. Routing SHALL use the live provider contribution rather than a create-time snapshot.

#### Scenario: Provider gains a capability

- **WHEN** a provider later gains Git support
- **THEN** it serves Git on existing ready environments
- **AND** the request does not fail as `query failed` from a create-time snapshot

#### Scenario: Retired capability token persisted

- **WHEN** the registry is loaded and contains an unknown capability token
- **THEN** the token is dropped and This server still starts

### Requirement: Unavailable capabilities never fall back to the server host

Unavailable optional capabilities SHALL render a clear limited or unavailable state. They SHALL NOT run against the Terminay Server host merely because the same path or binary exists there.

#### Scenario: Missing optional capability

- **WHEN** a project's environment does not provide an optional capability
- **THEN** the UI shows a clear limited or unavailable state
- **AND** the operation is not executed on the Terminay Server host

### Requirement: SSH provider Git behaviour

The SSH provider SHALL supply Git queries through the selected remote connection. For a remote root that is not a repository, Git discovery and the worktree listing SHALL return the normal empty or not-repository result and SHALL NOT fall back to the Terminay Server's Git process or surface a transport failure in the project UI.

#### Scenario: Remote root is not a repository

- **WHEN** Git discovery or worktree listing runs on an SSH remote root that is not a repository
- **THEN** the normal empty or not-repository result is returned
- **AND** no Terminay Server Git process is used and no transport failure appears in the project UI

### Requirement: Runtime routing pipeline

For every project-scoped terminal, filesystem, file, folder, Git, macro, recording, agent, activity, MCP, shell, and environment action, the server SHALL authenticate the client from its transport-bound principal; resolve all addressed project and resource identities from canonical state; derive the exact project environment and pinned revision; verify the requested capability and current provider lifecycle; invoke the environment runtime with a bounded server-issued context, deadline, cancellation, and only the secret references it is permitted to resolve; and publish a bounded typed outcome without raw provider errors or secrets.

#### Scenario: Project-scoped action

- **WHEN** a client issues a project-scoped terminal, filesystem, Git, macro, recording, agent, activity, MCP, shell, or environment action
- **THEN** the server authenticates the principal, resolves identities from canonical state, derives the environment and pinned revision, and verifies capability and provider lifecycle before invoking the runtime
- **AND** the published outcome is a bounded typed result containing no raw provider error or secret

### Requirement: Clients carry no routing authority

Clients SHALL NOT choose providers or adapters. A supplied environment id MAY be used only as an expected-value consistency check. Labels, hostnames, IPs, URLs, roots, and current focus SHALL carry no authority.

#### Scenario: Copied identifiers supplied by a client

- **WHEN** a client supplies a copied environment id, label, path, or hostname
- **THEN** the operation is not redirected
- **AND** a supplied environment id is used only as an expected-value consistency check

#### Scenario: Identical paths in different environments

- **WHEN** identical path text exists in two different environments
- **THEN** the two remain fully isolated

### Requirement: Transport pooling and revision updates

Runtimes MAY pool one transport for the exact profile and environment revision, but channels, roots, projects, terminal sessions, drafts, and authorization SHALL remain independently scoped. Editing shared profile configuration SHALL create a new revision. Referencing projects SHALL show **Update connection available** and SHALL switch only after explicit validation; live projects SHALL NOT change machine authority under mounted panels.

#### Scenario: Shared profile edited

- **WHEN** shared profile configuration is edited
- **THEN** a new revision is created and referencing projects show **Update connection available**
- **AND** a project switches only after explicit validation, never under its mounted panels

### Requirement: Root resolution for new projects

Each environment SHALL be able to report an account home and an optional profile default root. New projects SHALL use the profile default when configured, otherwise the verified environment home. New This server projects SHALL use the Terminay Server account home. New projects SHALL NOT copy the active project's root.

#### Scenario: Creating a project

- **WHEN** a new project is created on a selected environment
- **THEN** it begins at the environment's configured default root, or its verified home when no default is configured
- **AND** it does not copy the currently active project's root

### Requirement: Provider-owned root validation

Providers SHALL validate and canonicalize a proposed root before the project commit. The pre-project root browser SHALL be a bounded provider capability because ordinary project filesystem authority does not exist until creation. `~` expansion SHALL be provider-owned, and persisted roots SHALL be canonical absolute target paths.

#### Scenario: Browsing before a project exists

- **WHEN** a user browses for a root before the project is created
- **THEN** the listing is served by a bounded provider capability
- **AND** `~` is expanded by the provider and the persisted root is a canonical absolute target path

### Requirement: Revisioned root updates

Changing a project root SHALL use the named revisioned root-update command. The server SHALL prepare the new environment filesystem and Git contexts and commit them only if workspace mutation succeeds. Generic project presentation updates SHALL NOT replace a root. A profile's changed default SHALL affect future projects only, and **Use environment default** SHALL be an explicit per-project action.

#### Scenario: Root update fails mid-way

- **WHEN** a root update's workspace mutation fails
- **THEN** the prepared filesystem and Git contexts are not committed

#### Scenario: Presentation update attempts a root change

- **WHEN** a generic project presentation update carries a different root
- **THEN** the root is not replaced

#### Scenario: Profile default changed

- **WHEN** a profile's default root is changed
- **THEN** only future projects are affected
- **AND** an existing project adopts it only through the explicit **Use environment default** action

### Requirement: Project and panel movement across environments

Workspace views MAY contain mixed environments. Moving a complete project to another view SHALL preserve its environment, panels, sessions, streams, and service identities. A panel move between unequal environment ids SHALL be rejected before mutation. A terminal SHALL NOT be killed and recreated on another machine to simulate a move. Cross-project terminal movement SHALL remain unavailable until exact same-environment terminal rebinding updates workspace state, TerminalService identity, presentation leases, activity, agents, MCP, and recording atomically. File and folder movement SHALL additionally require canonical target-root validation.

#### Scenario: Cross-environment panel move

- **WHEN** a panel move is attempted between two unequal environment ids
- **THEN** it fails atomically before any mutation
- **AND** no terminal is killed and recreated on another machine

#### Scenario: Whole project moved between views

- **WHEN** a complete project is moved to another workspace view
- **THEN** the move succeeds and preserves its environment, panels, sessions, streams, and service identities

### Requirement: Project retargeting is out of contract

Retargeting an existing project to a different environment SHALL NOT be offered. Users SHALL create a new project on the desired environment.

#### Scenario: User wants a different environment

- **WHEN** a user wants an existing project to run on a different environment
- **THEN** no retargeting action is offered and the user creates a new project on that environment

### Requirement: Public environment statuses

Safe public statuses SHALL include `ready`, `connecting`, `reconnecting`, `provisioning`, `starting`, `stopping`, `offline`, `authentication-required`, `host-key-changed`, `permission-denied`, `extension-missing`, `extension-disabled`, `extension-incompatible`, `unreachable`, and `failed`.

#### Scenario: Status published

- **WHEN** an environment's lifecycle state is published to clients
- **THEN** it is one of the safe public status values

### Requirement: Failure preserves the project

A disconnected or unavailable existing project SHALL remain in its view with its panels and root metadata and SHALL offer retry and environment details. A client disconnect or reload SHALL NOT change environment or terminal lifetime. Provider failure SHALL be scoped and SHALL NOT stop This server or another extension.

#### Scenario: Environment becomes unreachable

- **WHEN** a project's environment becomes disconnected or unavailable
- **THEN** the project remains in its view with its panels and root metadata
- **AND** retry and environment details are offered

#### Scenario: One provider crashes

- **WHEN** one provider fails or crashes
- **THEN** This server and other extensions continue running

### Requirement: Transport loss and ambiguous writes

Provider transport loss SHALL interrupt affected terminal sessions exactly once when survival cannot be proven, and SHALL NOT silently create a new remote shell under an existing session id. File drafts SHALL remain server-owned across transport loss. Ambiguous remote writes SHALL report outcome unknown or conflict and SHALL NOT be blindly retried.

#### Scenario: Provider transport lost

- **WHEN** a provider transport is lost and session survival cannot be proven
- **THEN** affected terminal sessions are interrupted exactly once
- **AND** no new remote shell is created under an existing session id

#### Scenario: Write outcome unknown

- **WHEN** a remote write's outcome cannot be determined
- **THEN** it is reported as unknown or conflicting
- **AND** it is not blindly retried

### Requirement: Server shutdown does not mutate infrastructure

Server shutdown SHALL stop admissions, cancel bounded provider operations, and ask each runtime to deactivate. It SHALL NOT stop or delete infrastructure unless the user separately requested that lifecycle action.

#### Scenario: Server shuts down

- **WHEN** Terminay Server shuts down
- **THEN** admissions stop, bounded provider operations are cancelled, and each runtime is asked to deactivate
- **AND** provider infrastructure is not stopped or deleted

### Requirement: No fallback routing

Missing providers, missing capabilities, missing credentials, and every connection failure SHALL fail explicitly. No route SHALL fall back to This server or another profile.

#### Scenario: Missing or crashed extension

- **WHEN** an extension is missing or has crashed, or a target is unreachable
- **THEN** the project is preserved and the operation fails explicitly
- **AND** no local terminal, filesystem, Git, agent, or MCP fallback is invoked

### Requirement: Project-bar split button

The project bar SHALL use an accessible split button whose `+` and arrow are separate icon buttons with the same even pacing as the panel-strip add controls, not a joined chip. The primary `+` SHALL immediately create a new This server project. Every equivalent native-menu, keyboard-shortcut, and command-palette action SHALL invoke that same server-owned This server operation and SHALL acknowledge completion only after the operation has settled. The arrow SHALL open **Choose project environment**.

#### Scenario: Creating from any entry point

- **WHEN** the user activates the project-bar `+`, its native-menu item, its keyboard shortcut, or its command-palette action
- **THEN** the same server-owned This server create operation runs
- **AND** completion is acknowledged only after the operation has settled

#### Scenario: Opening the chooser

- **WHEN** the user activates the split button's arrow
- **THEN** **Choose project environment** opens

### Requirement: Chooser inventory is server-owned

Opening the chooser SHALL refresh its inventory from the currently authenticated Terminay Server. A query attempted while the shared client is still connecting SHALL NOT permanently cache an empty inventory: the chooser SHALL retry on open and SHALL continue to show the last successfully authenticated snapshot during transient transport recovery. No renderer-owned copy SHALL be kept as authority.

#### Scenario: Chooser opened while connecting

- **WHEN** the chooser inventory query is attempted while the shared client is still connecting
- **THEN** an empty inventory is not permanently cached
- **AND** the chooser retries on open and shows the last successfully authenticated snapshot during transient recovery

### Requirement: Chooser grouping and actions

The chooser menu SHALL group selectable connections by their owning provider. The **This Terminay Server** group SHALL have no section heading and **This server** SHALL be the first chooser row. SSH connections SHALL sit under the SSH provider and Puzed VMs under each saved Puzed provider. A Puzed provider SHALL never be an openable menu item, and **New Puzed provider…** SHALL NOT be a chooser action. Each provider group that can create a connection SHALL have a compact **+** in its header: **Create VM in <provider>** for a Puzed provider and **Add SSH connection** for SSH. The footer SHALL offer **Project Environments…** and SHALL NOT duplicate **Extensions…**. Large inventories SHALL use a compact search field instead of an unbounded menu, and the chooser SHALL use the same compact header-menu treatment as the connection and project switcher menus.

#### Scenario: Provider groups rendered

- **WHEN** the chooser is opened with SSH connections and Puzed VMs available
- **THEN** **This server** is the first row under an unheaded group, SSH connections sit under the SSH provider, and Puzed VMs sit under each saved Puzed provider
- **AND** no Puzed provider row is itself openable

#### Scenario: Creating from a group header

- **WHEN** the user activates a provider group's compact **+**
- **THEN** the Project Environments window opens with its sidebar and authority context preserved and the requested connection or VM form already selected

#### Scenario: Large inventory

- **WHEN** the inventory is large
- **THEN** a compact search field is presented instead of an unbounded menu

### Requirement: Chooser presentation

When the chooser is open, the project-bar split SHALL look **active** and SHALL share a surface with the menu so the `+` trigger and menu read as one connected control with no disconnected gap. Each connection SHALL show a green, amber, or red status dot to the left of its title instead of a Ready or status word. **This server** SHALL keep secondary text such as `Local to Production Terminay`. Puzed VM rows SHALL use **Online**, **Offline**, or **Access** as secondary text rather than the provider type.

#### Scenario: Chooser open

- **WHEN** the chooser is open
- **THEN** the split control appears active and shares one surface with the menu with no disconnected gap
- **AND** each connection shows a green, amber, or red status dot to the left of its title

#### Scenario: Puzed VM row

- **WHEN** a Puzed VM row is rendered
- **THEN** its secondary text is **Online**, **Offline**, or **Access**

### Requirement: Provider actions derive from the server snapshot

Provider actions SHALL be derived from the currently authenticated server snapshot, not hardcoded client knowledge.

#### Scenario: New provider installed

- **WHEN** a provider is installed or enabled on the server
- **THEN** its actions become available from the authenticated server snapshot without hardcoded client knowledge

### Requirement: Profile save does not implicitly create an environment

Saving a connection profile SHALL NOT implicitly create a project environment unless its currently activated public provider contribution explicitly declares `profileSave: { createEnvironment: true }`.

#### Scenario: Direct connection saved

- **WHEN** a provider declares `profileSave: { createEnvironment: true }` and its profile is saved
- **THEN** a project environment is created as part of that one-step journey

#### Scenario: Puzed profile saved

- **WHEN** a Puzed profile is saved without that declaration
- **THEN** it remains a profile until the user supplies the VM create-form values

### Requirement: Atomic project creation and editing

Project creation SHALL be atomic from the user's perspective: the target and initial root SHALL validate before a normal project tab is committed. Provider glyph and status MAY appear subtly on the tab and environment chip with complete accessible text. Project editing SHALL show immutable environment identity and status, root, **Use environment default**, appearance, and environment-valid shell choices.

#### Scenario: Invalid target or root

- **WHEN** the selected target or initial root fails validation
- **THEN** no project tab is committed

#### Scenario: Editing a project

- **WHEN** a project is edited
- **THEN** its immutable environment identity and status, root, **Use environment default**, appearance, and environment-valid shell choices are shown

### Requirement: Project Environments management surface

**File → Project Environments…** SHALL open or focus a first-class management surface named **Project Environments** whose standard Settings sidebar has separate **Providers** and **Connections** sections. A Puzed provider SHALL show safe service and account facts and its child connection count; a connection SHALL show its owner, safe endpoint, default root, and status metadata, project references, and connection lifecycle actions. Provider Test, Edit, and Remove SHALL NOT be shown as connection management for a Puzed VM. On Desktop it SHALL be a dedicated native auxiliary window with the same window chrome, content frame, responsive layout conventions, and focus and reuse behaviour as Settings, Macros, and Recordings, and SHALL NOT use the project-editor sheet's oversized centered-dialog presentation or an independent dashboard-style list/detail frame. In a browser the same shared route SHALL be presented in-page with equivalent management semantics. Repeated invocation SHALL focus the existing presentation instead of opening duplicates.

#### Scenario: Opening from any entry point

- **WHEN** the user activates **File → Project Environments…**, the Command Bar action, or the project-chooser footer action
- **THEN** the same Project Environments presentation opens or is focused
- **AND** a browser client renders the same shared route in-page

#### Scenario: Desktop presentation

- **WHEN** Project Environments is opened on Desktop
- **THEN** it is a dedicated reusable native auxiliary window visually consistent with Settings, Macros, and Recordings
- **AND** it never renders in project or tab editor modal chrome

#### Scenario: Puzed VM detail

- **WHEN** a Puzed VM connection detail is shown
- **THEN** provider Test, Edit, and Remove are not presented as its connection management

### Requirement: In-flow failure presentation

Server-operation failures SHALL appear in a dedicated in-flow content panel above the current provider, connection, or declarative form. The panel MAY offer Retry and SHALL NOT be a fixed or floating overlay; the selected detail and its recovery controls SHALL remain visible and usable.

#### Scenario: Server operation fails

- **WHEN** a server operation fails in the Project Environments surface
- **THEN** the failure appears in an in-flow content panel above the current detail or form
- **AND** the selected detail and its recovery controls remain visible and usable

### Requirement: Removing connections and providers

An unreferenced connection SHALL offer **Remove connection**, which forgets only Terminay's local project-environment record and never deletes, powers off, or otherwise mutates provider infrastructure. The action SHALL be blocked while a project references the connection. A Puzed provider with no referenced projects SHALL be removable directly, atomically forgetting its unreferenced child connection records and the provider's local credential and profile record without mutating the Puzed VMs. A provider used by any project SHALL remain blocked with an explicit reference explanation.

#### Scenario: Removing an unreferenced connection

- **WHEN** the user removes an unreferenced connection
- **THEN** only Terminay's local project-environment record is forgotten
- **AND** provider infrastructure is not deleted, powered off, or otherwise mutated

#### Scenario: Referenced connection or provider

- **WHEN** removal is attempted while a project references the connection or provider
- **THEN** the action is blocked with an explicit reference explanation

#### Scenario: Removing an unreferenced Puzed provider

- **WHEN** a Puzed provider with no referenced projects is removed
- **THEN** its unreferenced child connection records and its local credential and profile record are forgotten atomically
- **AND** its Puzed VMs are not deleted or powered off

### Requirement: Secret handling in provider forms

Editing a provider SHALL hydrate its previously saved non-secret form values. Secret fields SHALL never be returned to a client: they SHALL be shown empty with explicit "leave blank to keep the existing value" guidance, and an empty submitted secret SHALL preserve the existing vault value.

#### Scenario: Editing a provider with a saved secret

- **WHEN** a provider with a stored secret is edited
- **THEN** non-secret values are hydrated and the secret field is empty with "leave blank to keep the existing value" guidance
- **AND** submitting it empty preserves the existing vault value

### Requirement: Provider creation actions

Every running provider with a profile form SHALL contribute a clear creation action. For Puzed this SHALL be **New Puzed provider…**; saving it SHALL store its URL and API-key secret and return to that provider detail without creating a VM or project, and that detail SHALL expose **Create VM…** and its provider-scoped connection list. Saving SSH SHALL create a saved SSH connection. Installing or enabling a provider SHALL make these actions available without restarting the app, and focusing the window SHALL refresh provider inventory. Extension installation and updates SHALL NOT be duplicated in this window; links that require an environment provider SHALL open Settings at its **Extensions** section.

#### Scenario: Saving a new Puzed provider

- **WHEN** **New Puzed provider…** is saved
- **THEN** its URL and API-key secret are stored and the view returns to that provider detail
- **AND** no VM or project is created, and **Create VM…** and the provider-scoped connection list are exposed

#### Scenario: Provider newly installed

- **WHEN** a provider is installed or enabled
- **THEN** its creation actions become available without restarting the app
- **AND** focusing the window refreshes provider inventory

#### Scenario: Extension link

- **WHEN** a link requires an environment provider that is not installed
- **THEN** Settings opens at its **Extensions** section rather than duplicating installation in this window

### Requirement: Embedded Desktop vault readiness

The embedded Desktop vault SHALL be unlocked only after Electron reports the app as ready and before the Local server is reported ready or any project window is created. A transient pre-ready `safeStorage` unavailable result SHALL NOT become a durable unavailable vault state.

#### Scenario: First secret-backed save after launch

- **WHEN** the first secret-backed SSH or Puzed profile save occurs after launch on a supported OS-backed storage backend
- **THEN** it succeeds without requiring a restart or a separate vault action

### Requirement: Creation and editing as modes of the management surface

Creation and editing SHALL be modes of the Project Environments management surface: the standard environment sidebar, search, server authority, and footer SHALL remain visible while the right-hand pane shows the form. Cancel and successful Save SHALL return to the selected environment. Provider creation SHALL be offered as one compact sidebar action or menu, not as a row of floating buttons in the detail header.

#### Scenario: Editing a connection

- **WHEN** a connection form is opened
- **THEN** the sidebar, search, server authority, and footer remain visible while the form occupies the right-hand pane
- **AND** Cancel or a successful Save returns to the selected environment

### Requirement: Provider form visual language

Provider-contributed forms SHALL NOT introduce a second visual language. The generic renderer SHALL use the same category header, uppercase section labels, bordered Settings groups, single setting rows, field descriptions, controls, buttons, validation banners, and action spacing as the existing Settings, Macros, and Recordings surfaces. Each ordinary field SHALL be one responsive row with its label and help text on the left and its control on the right. Related fields SHALL NOT be arranged as an arbitrary dashboard grid. Forms SHALL end with the standard secondary **Cancel** and primary save or create actions. These rules apply equally to official SSH and Puzed forms and to third-party providers.

#### Scenario: Any provider form rendered

- **WHEN** an official or third-party provider profile or create form is rendered
- **THEN** it uses the established Settings row and group primitives with one responsive row per ordinary field
- **AND** no two-column dashboard-style field grid is produced

### Requirement: Provider disclosures and preset choices

Provider sections marked as disclosures SHALL render as compact Settings rows with a chevron and optional summary. A collapsed disclosure SHALL occupy one normal row and SHALL NOT appear as a large empty card. Expanding it SHALL reveal ordinary setting rows within the same group. Preset choices MAY use compact selectable cards only where comparison is materially useful, and SHALL remain contained within one stacked setting row.

#### Scenario: Collapsed disclosure

- **WHEN** a provider section marked as a disclosure is collapsed
- **THEN** it occupies one compact Settings row with a chevron and optional summary
- **AND** it does not render as a large empty card

#### Scenario: Disclosure expanded

- **WHEN** the disclosure is expanded
- **THEN** ordinary setting rows appear within the same group

### Requirement: Server-resolved dynamic form options

Every field with `optionSource` SHALL be resolved through the fixed `project-environments.resolve-options` server operation using the exact provider, selected profile, current form values, query, deadline, and cancellation signal. The form SHALL load initial options when it opens and SHALL reload dependent choices when their inputs change. It SHALL present loading, empty, and bounded provider-error states instead of an inert empty select. No renderer SHALL substitute static Puzed images, sizes, workers, bridges, or profiles.

#### Scenario: Dependent field changes

- **WHEN** a field that another field's options depend on changes
- **THEN** the dependent options reload through `project-environments.resolve-options`
- **AND** loading, empty, or bounded provider-error state is presented rather than an inert empty select

#### Scenario: Renderer lacks options

- **WHEN** option resolution has not returned
- **THEN** the renderer does not substitute static Puzed images, sizes, workers, bridges, or profiles

### Requirement: Environment management authorization

Environment and profile management, secret replacement, host-trust changes, provider lifecycle, and infrastructure mutations SHALL require explicit transport-bound permissions. Project-scoped principals MAY use their exact project environment but SHALL NOT enumerate or manage unrelated profiles. The embedded Desktop renderer SHALL also be a transport-bound principal whose private MessagePort receives the same explicit environment and extension permissions as an authenticated administrative browser, and SHALL NOT rely on its `admin` scope label as implicit authority.

#### Scenario: Project-scoped principal

- **WHEN** a project-scoped principal attempts to enumerate or manage unrelated profiles
- **THEN** the request is refused
- **AND** it may still use its exact project environment

#### Scenario: Embedded Desktop renderer

- **WHEN** the embedded Desktop renderer issues an environment-management command over its private MessagePort
- **THEN** it is authorized by the same explicit environment and extension permissions as an authenticated administrative browser
- **AND** its `admin` scope label alone does not grant authority

### Requirement: Environment audit records

Audit records SHALL include the authenticated principal and device, opaque extension, profile, environment, and project ids, the safe action, result, revision, and timestamp. They SHALL exclude credentials, authorization headers, key material, terminal bytes, complete provider responses, and root paths.

#### Scenario: Management action audited

- **WHEN** an environment management or infrastructure action is performed
- **THEN** the audit record contains the principal, device, opaque ids, safe action, result, revision, and timestamp
- **AND** it excludes credentials, authorization headers, key material, terminal bytes, complete provider responses, and root paths
