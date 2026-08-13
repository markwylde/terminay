# Shell profile settings and selection

## Goal

Deliver the complete profile-management, default-selection, cwd-policy, and
one-off terminal-launch experience on Desktop and browser clients.

Governing features:

- [Shell profiles and terminal launch](../features/shell-profiles-and-terminal-launch.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)

Depends on [Task 24](./24-shell-profile-domain-and-discovery.md) and
[Task 25](./25-canonical-terminal-launch-resolution.md).

## Current gap

Settings expose raw program and argument strings but cannot show discovered
shells, manage profiles, explain availability, select project defaults, choose
a cwd policy, or launch one terminal with a different profile. The current form
also gives no clear indication that shell settings belong to the connected
server and can execute programs there.

## Implementation slices

- [x] Replace the raw shell launch fields with default-profile and **New
  terminals start in** controls plus a profile catalogue grouped into System
  default, discovered, and custom entries.
- [x] Build an accessible profile editor for name, structured target, startup
  mode, ordered arguments, environment overlay, icon, and colour. Keep advanced
  executable/environment controls separated and describe their server-side
  execution boundary.
- [x] Support create, copy discovered profile, rename, reorder, validate,
  reference inspection, and unreferenced deletion with revision conflicts and
  inline field-level errors. Referenced profiles direct the user to each
  server/project default that must be reassigned first. Preserve unavailable
  custom profiles for repair.
- [x] Keep runtime-only discovered entries out of durable default selectors;
  expose **Use once** and **Copy to custom profile** instead.
- [x] Show the connected server identity, profile source, availability, server
  default, and project-use references without leaking environment values.
- [x] Add project-default profile selection to the project-editing experience,
  including **Use server default**, unavailable state, and guarded deletion
  that identifies references which must first be reassigned.
- [x] Add **New Terminal with Profile…** to the Command Bar and relevant tab/add
  menus. It makes a one-time profile-id choice; ordinary new/split actions use
  canonical defaults and all actions display bounded launch errors inline.
- [x] Ensure settings changes affect only future terminals. Existing tabs retain
  their resolved session metadata and do not repaint as another profile when a
  profile is renamed, edited, or made default.
- [x] Add searchable labels, keyboard operation, focus management, validation
  announcements, narrow-layout behaviour, and feature parity for native
  settings windows and in-page browser settings.
- [x] Remove obsolete legacy shell fields from production configuration paths,
  retain their bounded reader only for the supported migration window, and
  update user-facing help/release notes. Retire the migration reader in a later
  schema cleanup after that window has passed.

## Acceptance checks

- A new user can leave **System default** selected and consistently create the
  account shell without opening the advanced editor.
- A user can copy a discovered shell, edit argument rows and environment rows
  without quoting or JSON, make it the server or project default, and launch it
  once without changing a default.
- Desktop and browser clients connected to the same server observe one
  revisioned profile/default change; clients connected to different servers do
  not show or select each other's paths.
- Unavailable, invalid, stale-revision, duplicate-name, protected-environment,
  and referenced-delete states are actionable and preserve user input safely.
- Changing or deleting a profile does not alter an existing terminal's label,
  process, cwd, recording metadata, or session identity.
- Keyboard-only and screen-reader tests cover catalogue navigation, editing,
  reordering, validation, default reassignment, guarded deletion, and the
  one-off chooser at wide and narrow widths.
- End-to-end tests cover macOS/Linux system defaults, Windows native and WSL
  fixtures, remote-server scoping, project overrides, cwd policies, reset, and
  migrated legacy settings.

## Definition of done

Desktop and browser users can safely manage full server-owned shell profiles,
choose server/project/one-off defaults and cwd policy, and understand failures;
accessibility and cross-host E2E checks pass; and the raw legacy shell form is
no longer a production configuration path.
