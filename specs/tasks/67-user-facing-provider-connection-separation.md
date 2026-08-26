# User-facing provider and connection separation

## Goal

Deliver the missing user-visible separation between provider identity/profile/
connection management and Puzed VM provisioning or selection.

## Why this is an active task

The user reported that “the UI still presents Puzed as one combined
VM/connection flow” and that the expected “user-facing provider/connection
separation has not been delivered.” Internal extension packaging or relocation
does not satisfy this task.

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Puzed project environments](../features/puzed-project-environments.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Scope

Define and deliver the intended user-facing distinction between:

- provider identity, profile, and connection management; and
- Puzed VM provisioning, browsing, and selection.

The task must preserve the current server-owned environment and Puzed/SSH
security boundaries. It does not assert a particular screen, navigation model,
or terminology before the discovery and design work below is complete.

## Discovery record (2026-08-26)

The released application does not make these lifecycles visible as separate
things:

- The Project Environments window appends saved provider profiles to the same
  unsectioned list as project environments. A Puzed Platform profile is thus
  displayed as though it were itself an environment/connection.
- Its only sidebar action is **Add connection**. For Puzed that action saves
  the Platform URL and API key, but the completion message says “Connection
  saved”; selecting that row then exposes **New Puzed project**, which opens
  VM provisioning. This is the reported combined VM/connection journey.
- The project chooser likewise derives Puzed VM creation from a provider plus
  saved profile while listing environments as project targets. It cannot show
  that a Platform account is management context and that a particular VM is
  the target later used for a project.

The governing feature specifications already require a Puzed Platform profile
to save without creating a project and require project creation to be atomic
only after the target/root validate. The uncommitted
`specs/provider-connection-separation` worktree contains a compatible
provider-type → provider → connection → project-environment design, including
separate Project Environments navigation and route intents. It is design
evidence only: its unchecked-in code and task checkboxes are not delivery
evidence.

## Proposed user contract

This proposal uses the distinction expressed by that worktree and reconciles
it with the existing Puzed and SSH feature contracts:

- A **provider type** is an installed contribution such as SSH or Puzed. It is
  not a project target.
- A **provider** is a reusable server-owned account/service configuration. A
  Puzed provider holds one Platform account's display name, base URL, redacted
  organization/capability metadata, and API-key vault reference. SSH has one
  reserved provider and needs no account setup.
- A **connection** is an individually selectable execution target owned by one
  provider: a saved SSH host or one tagged Puzed VM. It is the only item the
  project chooser can open into a project.
- A **project environment** is the revisioned binding created for a project
  from a connection. It remains an implementation/authority identity rather
  than a competing management item.

The server is authoritative for every provider, connection, revision, vault
reference, inventory result, and project binding. A renderer may select an
opaque id only as an expected-value check; it cannot turn a provider, label,
host, URL, or VM id into authority. Saving a provider never creates a VM,
connection, or project. Creating/selecting a connection never edits/replaces
its provider or a sibling connection, and project creation never changes the
connection.

### Entry points and journeys

**Manage providers and connections**

1. **File → Project Environments…**, the Command Bar, and the chooser's
   **Project Environments…** action open/focus the same existing management
   window or browser route for the selected Terminay Server.
2. Its standard sidebar has visibly separate **Providers** and **Connections**
   sections, each with its own count, searchable entries, selection, and
   empty/error state. Provider details show safe service/account facts and the
   number of child connections; connection details show their owning provider,
   safe endpoint/VM state, default root, and project references.
3. **Add provider** offers **New Puzed provider…**. The form keeps the
   management navigation and server authority visible. Test/Save validates the
   Puzed account and returns to the saved provider detail. It neither enters a
   VM form nor presents the provider as a project target.
4. A Puzed provider detail offers provider-scoped **Create VM…** and **Browse
   Terminay VMs…**. Both are connection actions: the former opens the
   profile-scoped Puzed progressive VM form; the latter lists only tagged VMs
   for that provider. Saving/provisioning preserves the provider selection and
   adds/updates the VM under **Connections**. SSH's reserved provider instead
   offers **Add SSH connection…**.
5. Cancel from a provider form returns to the previously selected management
   item. Cancel from VM/SSH connection creation returns to its owning provider
   detail. Successful ordinary edit/save returns to the edited item; it must
   not silently redirect to another provider, connection, or project.

**Choose or create a project target**

1. The project-bar arrow remains **Choose project environment**, but its
   selectable list contains ready/recoverable **connections**, grouped by their
   owning provider. It never lists a Puzed provider as an openable target.
2. Its creation actions are intentionally separate: **New Puzed provider…**
   opens provider management, and **Create VM in <provider>…** opens only that
   provider's VM provisioning form. SSH uses **Add SSH connection…**.
3. Selecting a connection performs canonical connection/root validation then
   creates the project environment/project atomically. It does not reopen the
   provider form or provision a VM. Repeated project creation from the same
   connection is allowed and preserves project/root/session isolation.

### Failure and recovery

- Provider validation/test errors retain safe entered values, focus the error
  summary/field, identify the selected Terminay Server, and never echo a key,
  provider response, or raw transport error.
- A provider outage keeps existing Puzed VM connections and SSH projects
  represented. A VM/SSH connection failure has its own safe status and retry/
  lifecycle actions; it never falls back to This server or another connection.
- VM provisioning retains its server-side operation and idempotency state. A
  background or recovered operation remains attached to the same provider and
  VM connection. The Task 48 worker/bridge correction and its recoverable
  `bridge_worker_mismatch` behaviour apply inside this form.
- Removal is explicit and server-validated: a provider with child connections
  is blocked; a referenced connection is blocked; no blocked action changes UI
  selection or authority. Deleting one VM connection cannot delete or replace
  the Puzed provider or sibling connections.

### Persistence, privacy, and audit

Provider/connection/environment ids and their revisions are server-owned.
Provider records contain only safe metadata plus provider-scoped vault
references; connections retain only their safe endpoint/VM identity and their
own provider reference; project environments pin the exact connection/provider
revisions used for routing. Renderer state, URLs, local client persistence,
events, diagnostics, and audit records contain no credential, API key, private
SSH key, raw provider error, or arbitrary target authority. Every management,
provisioning, lifecycle, and project-create operation remains transport-
authorized and audited with the relevant opaque ids.

## Decision requiring user approval

The above proposal changes the user-facing noun for a configured Puzed Platform
account from the current **Puzed Platform profile** to **Puzed provider** and
reserves **connection** for a VM/SSH target. The stale worktree consistently
uses that model, but it is uncommitted and the current canonical features still
use “profile”. Approval is required before implementation should make this
terminology and associated persisted provider/connection migration canonical.

## Delivery checklist

### Discovery and contract

- [x] Reproduce and document the current Puzed journey from the user-facing
  application, identifying where provider/profile/connection management and VM
  provisioning/selection are combined.
- [x] Record the desired user-visible journeys and the boundary between provider
  identity/profile/connection management and Puzed VM provisioning/selection,
  without treating internal extension packages as user-facing delivery.
- [x] Reconcile the resulting user contract with the governing feature
  specifications before implementation, including ownership, persistence,
  authorization, and recovery boundaries.

### Design and implementation

- [x] Design the management and provisioning/selection entry points, transitions,
  labels, back/cancel behavior, and error states so the separation is clear to a
  user.
- [ ] Implement the approved user-facing separation without duplicating secrets,
  provider authority, or Puzed/SSH runtime responsibilities.
- [ ] Ensure the separated journeys retain server-owned validation, profile and
  environment revisioning, and a clear route back to the relevant management or
  VM action.

### Acceptance

- [ ] With two Puzed providers, manually verify that each is listed once under
  **Providers**, exposes only its own safe account facts and child count, and
  can be tested/edited without entering VM provisioning or selection.
- [ ] From one Puzed provider, manually verify that **Create VM…** and **Browse
  Terminay VMs…** keep that provider context visible; cancel returns to that
  provider; and provisioning/selecting `Machine 2` leaves that provider and
  `Machine 1` unchanged while adding/updating only `Machine 2` under
  **Connections**.
- [ ] With saved SSH and Puzed connections, manually verify that the project
  chooser lists connections grouped by owner, never exposes a provider as a
  project target, and can create two isolated projects from the same ready
  connection without changing its provider/connection record.
- [ ] Manually verify provider validation, VM provisioning, connection test,
  removal-blocked, provider outage, and `bridge_worker_mismatch` recovery:
  each retains the right provider/connection context and safe entered state,
  exposes a bounded actionable error, and neither duplicates infrastructure nor
  falls back to another target.
- [ ] Desktop and browser exercise the same routes, focus/reuse behaviour,
  keyboard navigation, narrow layout, and last-good inventory during a
  transient connection recovery.
- [ ] Record real-app acceptance evidence and any unresolved user-facing
  ambiguity before this task is moved to completed history.

## Definition of done

The real application visibly separates provider identity/profile/connection
management from Puzed VM provisioning and selection according to the agreed
user contract, with manual acceptance evidence. Internal extension packaging
alone is not evidence of completion.
