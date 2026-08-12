# Project environment and extension UI

## Goal

Deliver the responsive management routes, accessible project split button, and
generic declarative provider forms consistently in Desktop and web clients.

## Delivery phase

Phase 2. Build first against Phase 1 protocol fixtures in parallel with
[Tasks 43](../tasks_completed/43-environment-routed-project-services.md),
[44](../tasks_completed/44-extension-installation-and-management.md), and
[47](../tasks_completed/47-official-puzed-extension-foundation.md), then integrate their live
services.

## Dependencies

- Protocol/schema fixtures from [Task 41](../tasks_completed/41-project-environment-domain-and-local-provider.md)
  and [Task 42](../tasks_completed/42-extension-api-manifest-and-host.md); final integration with
  [Task 43](../tasks_completed/43-environment-routed-project-services.md) and
  [Task 44](../tasks_completed/44-extension-installation-and-management.md).

## Governing specifications

- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Project environments](../features/project-environments.md)
- [Server extension platform](../features/extension-platform.md)

## Parallel work streams

### Navigation and project creation

- [ ] Implement split primary-plus/arrow semantics, grouped recent targets,
  searchable browse routes, This server naming, immediate Local shortcut, and
  atomic environment/root validation before project commit.
- [ ] Add semantic File/Command Bar routes and server-name scope disclosure.
- [ ] Show subtle provider/status on tabs/project editor without making
  environment retargeting editable.

### Management and schema renderer

- [ ] Build Project Environments and Extensions wide/narrow routes with
  search/list/detail, references, Test/Edit/Remove and lifecycle actions.
- [ ] Render fields, sections/disclosures, async selects, preset cards,
  conditionals, validation/error summaries, progress, and confirmations from
  bounded schemas.
- [ ] Implement official/custom catalogue previews, permissions/provenance/
  audit facts, selected-server trusted-code warning, and blocked dependants.

### Accessibility and acceptance

- [ ] Correct project `tablist`/`tab`, split-button/menu/typeahead/focus, mobile
  sheet, radio cards, live regions, alerts, 44px targets, forced colour, and
  reduced motion.
- [ ] Prove Desktop native auxiliary and browser in-page routes share semantic
  commands and server-owned state.

## Acceptance checks

- Primary `+` creates This server; arrow creates/selects SSH/Puzed and manages
  environments/extensions without confusing the server selector.
- Keyboard, screen-reader, narrow/touch, errors, and progress meet the feature
  contract and never expose secrets or extension HTML/code.

## Definition of done

The complete generic UX works against fixtures and production managers in both
client hosts without adding feature logic to Electron/browser shells.
