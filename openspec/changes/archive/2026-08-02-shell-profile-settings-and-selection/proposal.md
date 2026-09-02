## Why

Settings exposed raw program and argument strings. They could not show
discovered shells, manage profiles, explain availability, select project
defaults, choose a working-directory policy, or launch a single terminal with a
different profile, and gave no indication that shell settings belong to the
connected server and execute programs there.

## What Changes

- Replace the raw shell launch fields with default-profile and **New terminals
  start in** controls plus a grouped profile catalogue (System default,
  discovered, custom).
- Add an accessible profile editor for name, structured target, startup mode,
  ordered arguments, environment overlay, icon, and colour, with advanced
  executable and environment controls separated and their server-side execution
  boundary described.
- Support create, copy-discovered, rename, reorder, validate, reference
  inspection, and unreferenced deletion with revision conflicts and inline
  field-level errors.
- Add project-default profile selection with **Use server default**, an
  unavailable state, and guarded deletion.
- Add **New Terminal with Profile…** to the Command Bar and the relevant tab and
  add menus as a one-time profile-id choice.
- **BREAKING** Remove the obsolete legacy shell fields from production
  configuration paths, retaining only a bounded migration reader for the
  supported migration window.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `shell-profiles-and-terminal-launch`: the profile management, default
  selection, working-directory policy, and one-off launch surfaces, plus legacy
  shell settings migration.

## Impact

The Shell settings page and profile editor in both native settings windows and
in-page browser settings, the project-editing experience, the Command Bar and
tab/add menus, the server-owned profile and default persistence, and the legacy
shell configuration reader.
