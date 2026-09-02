## 1. Navigation and project creation

- [x] 1.1 Implement split primary-plus/arrow semantics, grouped recent targets,
  searchable browse routes, This server naming, immediate Local shortcut, and
  atomic environment/root validation before project commit, verified by the
  chooser and creation route tests
- [x] 1.2 Add semantic File and Command Bar routes and server-name scope
  disclosure, verified by the shared route registry coverage
- [x] 1.3 Show subtle provider and status on tabs and in the project editor
  without making environment retargeting editable, verified by the project editor
  showing the environment as read-only

## 2. Management and schema renderer

- [x] 2.1 Build Project Environments and Extensions wide and narrow routes with
  search, list, detail, references, and Test/Edit/Remove and lifecycle actions,
  verified by the management route tests in both layouts
- [x] 2.2 Render fields, sections and disclosures, async selects, preset cards,
  conditionals, validation and error summaries, progress, and confirmations from
  bounded schemas, verified by the schema renderer tests
- [x] 2.3 Implement official and custom catalogue previews, permission,
  provenance, and audit facts, the selected-server trusted-code warning, and
  blocked dependants, verified by the catalogue and review surfaces

## 3. Accessibility and acceptance

- [x] 3.1 Correct project `tablist`/`tab`, split-button menu, typeahead and focus,
  mobile sheet, radio cards, live regions, alerts, 44-pixel targets, forced
  colour, and reduced motion, verified by the accessibility assertions
- [x] 3.2 Prove Desktop native auxiliary and browser in-page routes share semantic
  commands and server-owned state, verified by both hosts driving the same routes
- [x] 3.3 Confirm primary `+` creates This server while the arrow creates or
  selects SSH/Puzed and manages environments and extensions without confusing the
  server selector
- [x] 3.4 Confirm keyboard, screen-reader, narrow and touch, error, and progress
  behaviour meets the feature contract and never exposes secrets or
  extension-supplied HTML or code
