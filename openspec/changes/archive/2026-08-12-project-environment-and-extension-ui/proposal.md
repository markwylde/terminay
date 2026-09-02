## Why

The server owns project environments and extensions, but there was no client
surface for them. Users needed responsive management routes, an accessible project
split button, and provider forms rendered from server-supplied schemas, delivered
identically in the Desktop and web hosts.

## What Changes

- Add split primary-plus/arrow project creation semantics with grouped recent
  targets, searchable browse routes, This server naming, an immediate Local
  shortcut, and atomic environment/root validation before a project commits.
- Add semantic File and Command Bar routes and server-name scope disclosure, plus
  subtle provider and status presentation on tabs and in the project editor
  without making environment retargeting editable.
- Add Project Environments and Extensions routes in wide and narrow layouts with
  search, list, detail, references, and Test/Edit/Remove and lifecycle actions.
- Add a generic declarative schema renderer for fields, sections and disclosures,
  async selects, preset cards, conditionals, validation and error summaries,
  progress, and confirmations.
- Add official and custom catalogue previews, permission, provenance, and audit
  facts, the selected-server trusted-code warning, and blocked dependants.
- Meet the accessibility contract for the project `tablist`, split button and
  menu, mobile sheet, radio cards, live regions, alerts, 44-pixel targets, forced
  colour, and reduced motion.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `project-environments`: adds the client management surface, split-button
  chooser, and declarative provider forms.
- `extension-platform`: adds the Extensions management surface, catalogue
  previews, and provenance and permission disclosure.
- `workspace-and-project-tabs`: adds split-button project creation semantics and
  environment presentation on tabs.

## Impact

Shared responsive routes consumed by both client hosts, the schema form renderer,
and the project bar. No feature logic is added to the Electron or browser shells.
