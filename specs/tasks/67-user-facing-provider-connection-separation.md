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

## Delivery checklist

### Discovery and contract

- [ ] Reproduce and document the current Puzed journey from the user-facing
  application, identifying where provider/profile/connection management and VM
  provisioning/selection are combined.
- [ ] Record the desired user-visible journeys and the boundary between provider
  identity/profile/connection management and Puzed VM provisioning/selection,
  without treating internal extension packages as user-facing delivery.
- [ ] Reconcile the resulting user contract with the governing feature
  specifications before implementation, including ownership, persistence,
  authorization, and recovery boundaries.

### Design and implementation

- [ ] Design the management and provisioning/selection entry points, transitions,
  labels, back/cancel behavior, and error states so the separation is clear to a
  user.
- [ ] Implement the approved user-facing separation without duplicating secrets,
  provider authority, or Puzed/SSH runtime responsibilities.
- [ ] Ensure the separated journeys retain server-owned validation, profile and
  environment revisioning, and a clear route back to the relevant management or
  VM action.

### Acceptance

- [ ] Manually verify that a user can manage the relevant provider/profile/
  connection details without being placed in the Puzed VM provisioning or
  selection journey.
- [ ] Manually verify that a user can provision or select a Puzed VM with the
  provider/profile/connection context clear and without the UI presenting the
  experience as one combined VM/connection flow.
- [ ] Record real-app acceptance evidence and any unresolved user-facing
  ambiguity before this task is moved to completed history.

## Definition of done

The real application visibly separates provider identity/profile/connection
management from Puzed VM provisioning and selection according to the agreed
user contract, with manual acceptance evidence. Internal extension packaging
alone is not evidence of completion.
