## Context

Proposal.md records the reported gap. The discovery pass on 2026-08-26 confirmed
it in the released application:

- The Project Environments window appends saved provider profiles to the same
  unsectioned list as project environments, so a Puzed Platform profile is
  displayed as though it were itself an environment or connection.
- Its only sidebar action is **Add connection**. For Puzed that action saves the
  Platform URL and API key but reports "Connection saved"; selecting that row
  then exposes **New Puzed project**, which opens VM provisioning. That is the
  reported combined journey.
- The project chooser derives Puzed VM creation from a provider plus saved
  profile while listing environments as project targets, so it cannot express
  that a Platform account is management context and a particular VM is the
  target.

The governing contracts already require a Puzed Platform profile to save without
creating a project, and require project creation to be atomic only after the
target and root validate. An uncommitted worktree contained a compatible
provider-type, provider, connection, project-environment design including
separate management navigation and route intents; it is design evidence only —
its unchecked-in code and task checkboxes are not delivery evidence.

## Goals / Non-Goals

Goals:

- Make provider identity and connection management visibly distinct from VM
  provisioning and selection in the real application.
- Keep every server-owned validation, revisioning, authorization, and audit rule
  exactly as specified.

Non-Goals:

- Changing persisted identifiers, the transport term **profile**, vault layout,
  or any authority boundary.
- Internal extension packaging or relocation, which does not satisfy this work.
- Reproducing the Puzed Platform administration UI.

## Decisions

1. **Four named layers.** A **provider type** is an installed contribution such
   as SSH or Puzed and is not a project target. A **provider** is a reusable
   server-owned account or service configuration — for Puzed, one Platform
   account's display name, base URL, redacted organization and capability
   metadata, and API-key vault reference; SSH has one reserved provider and needs
   no account setup. A **connection** is an individually selectable execution
   target owned by one provider — a saved SSH host or one tagged Puzed VM — and
   is the only item the chooser can open into a project. A **project
   environment** remains the revisioned binding created from a connection, an
   implementation and authority identity rather than a competing management item.
2. **Terminology is presentation-only.** The user approved **Puzed provider** and
   **connection** as the user-facing terms on 2026-08-26; the stable extension and
   server transport term remains **profile**.
3. **The server stays authoritative.** Every provider, connection, revision,
   vault reference, inventory result, and project binding is server-owned. A
   renderer may select an opaque id only as an expected-value check; it cannot
   turn a provider, label, host, URL, or VM id into authority.
4. **Actions do exactly one thing.** Saving a provider never creates a VM,
   connection, or project. Creating or selecting a connection never edits or
   replaces its provider or a sibling connection. Project creation never changes
   the connection.
5. **Browsing is a provider-scoped connection action.** **Browse Terminay VMs…**
   lists only that provider's tagged VMs and adds or updates only the selected VM
   under **Connections**, leaving the provider and sibling connections unchanged.
6. **Navigation returns where the user came from.** Cancel from a provider form
   returns to the previously selected management item; cancel from VM or SSH
   connection creation returns to its owning provider detail; a successful
   ordinary edit returns to the edited item and never silently redirects to
   another provider, connection, or project.

## Risks / Trade-offs

- Splitting one list into Providers and Connections changes a surface users may
  already navigate by habit. The compensation is that a provider is no longer
  presented as an openable project target, which was the actual defect.
- Provider-scoped browsing adds an inventory call per provider rather than one
  global listing. It is bounded and searchable, and scoping it is what makes the
  ownership relationship visible.
- A provider outage must not erase existing connections. Existing Puzed VM
  connections and SSH projects stay represented with their own safe status and
  retry actions, and never fall back to **This server** or another connection.
- Manual acceptance is the completion evidence here, because the defect is a
  user-visible journey. Internal extension packaging alone is explicitly not
  evidence.

## Open Questions

- Whether any residual user-facing ambiguity remains after acceptance is recorded
  as part of the acceptance evidence rather than resolved in advance.
