## Why

The released application still presents Puzed as one combined VM and connection
flow. The Project Environments window appends saved provider profiles to the same
unsectioned list as project environments, its only sidebar action is **Add
connection**, and selecting a saved Puzed row exposes **New Puzed project**,
which opens VM provisioning. A user cannot see that a Platform account is
management context while a particular VM is the target a project later uses.

## What Changes

- Present a saved Puzed Platform account as a **Puzed provider** — reusable
  management context that cannot open a project — and a saved SSH target or
  Terminay-managed Puzed VM as a **connection**, the only item the project
  chooser can open into a project.
- Give the Project Environments surface visibly separate **Providers** and
  **Connections** sections with their own counts, search, selection, and empty
  and error states.
- Add provider-scoped **Create VM…** and **Browse Terminay VMs…** actions to a
  Puzed provider detail, and **Add SSH connection…** to the reserved SSH
  provider. Browsing lists only that provider's tagged VMs and adds or updates
  only the selected VM under **Connections**.
- Make navigation predictable: cancelling a connection form returns to its owning
  provider detail, cancelling a provider form returns to the previously selected
  item, and a successful edit returns to the edited item without silently
  redirecting elsewhere.
- Keep the chooser listing ready and recoverable connections grouped by owning
  provider, never a provider as an openable target.
- Change no persisted identifier or authority boundary: **environment profile**
  remains the stable transport and persistence term, and provider, connection,
  environment, and revision identities stay server-owned and opaque.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-environments`: provider creation actions gain provider-scoped VM
  browsing, and creation and editing modes gain explicit owner-scoped return
  behaviour.
- `puzed-project-environments`: tagged VM inventory gains a provider-scoped
  browsing and selection path whose result changes only the selected VM.

## Impact

- The Project Environments management surface: sidebar sections, provider and
  connection details, creation actions, and navigation and cancel routing.
- The project chooser's grouping, creation actions, and connection selection
  path.
- The Puzed provider's inventory projection, scoped to one provider.
- No change to persisted identifiers, vault references, revisioning, transport
  authorization, or the Puzed and SSH runtime responsibilities.
