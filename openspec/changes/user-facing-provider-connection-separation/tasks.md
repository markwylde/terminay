## 1. Discovery and contract

- [x] 1.1 Reproduce and document the current Puzed journey from the user-facing application, identifying where provider, profile, and connection management is combined with VM provisioning and selection
- [x] 1.2 Record the desired user-visible journeys and the boundary between provider identity and connection management and Puzed VM provisioning and selection, without treating internal extension packages as user-facing delivery
- [x] 1.3 Reconcile the resulting user contract with the governing specifications, including ownership, persistence, authorization, and recovery boundaries

## 2. Design and implementation

- [x] 2.1 Design the management and provisioning and selection entry points, transitions, labels, back and cancel behaviour, and error states so the separation is clear to a user
- [ ] 2.2 Complete the approved user-facing separation without duplicating secrets, provider authority, or Puzed and SSH runtime responsibilities, verified by the absence of any combined provider-and-VM journey; the present Puzed extension exposes provider save and VM creation but no provider-scoped **Browse Terminay VMs…** inventory and selection path, so this delivery is not complete
- [ ] 2.3 Ensure the separated journeys retain server-owned validation, profile and environment revisioning, and a clear route back to the relevant management or VM action, verified by navigation and revisioning tests

## 3. Acceptance

- [ ] 3.1 With two Puzed providers, manually verify each is listed once under **Providers**, exposes only its own safe account facts and child count, and can be tested and edited without entering VM provisioning or selection
- [ ] 3.2 From one Puzed provider, manually verify **Create VM…** and **Browse Terminay VMs…** keep that provider context visible, cancel returns to that provider, and provisioning or selecting a second machine leaves the provider and the first machine unchanged while adding or updating only the second under **Connections**
- [ ] 3.3 With saved SSH and Puzed connections, manually verify the project chooser lists connections grouped by owner, never exposes a provider as a project target, and can create two isolated projects from the same ready connection without changing its provider or connection record
- [ ] 3.4 Manually verify provider validation, VM provisioning, connection test, removal-blocked, provider outage, and bridge and worker mismatch recovery each retain the right provider and connection context and safe entered state, expose a bounded actionable error, and neither duplicate infrastructure nor fall back to another target
- [ ] 3.5 Verify Desktop and browser exercise the same routes, focus and reuse behaviour, keyboard navigation, narrow layout, and last-good inventory during a transient connection recovery
- [ ] 3.6 Record real-app acceptance evidence and any unresolved user-facing ambiguity before this change is archived
