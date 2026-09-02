## 1. Settings surface

- [x] 1.1 Replace the raw shell launch fields with default-profile and **New terminals start in** controls plus a profile catalogue grouped into System default, discovered, and custom entries, verified by the Shell settings tests
- [x] 1.2 Build an accessible profile editor for name, structured target, startup mode, ordered arguments, environment overlay, icon, and colour, keeping advanced executable and environment controls separated and describing their server-side execution boundary
- [x] 1.3 Support create, copy discovered profile, rename, reorder, validate, reference inspection, and unreferenced deletion with revision conflicts and inline field-level errors, directing the user to each server/project default that must be reassigned first and preserving unavailable custom profiles for repair
- [x] 1.4 Keep runtime-only discovered entries out of durable default selectors and expose **Use once** and **Copy to custom profile** instead
- [x] 1.5 Show connected server identity, profile source, availability, server default, and project-use references without leaking environment values

## 2. Project and launch selection

- [x] 2.1 Add project-default profile selection to the project-editing experience, including **Use server default**, unavailable state, and guarded deletion that identifies references to reassign
- [x] 2.2 Add **New Terminal with Profile…** to the Command Bar and the relevant tab and add menus as a one-time profile-id choice, keeping ordinary new/split actions on canonical defaults and displaying bounded launch errors inline
- [x] 2.3 Ensure settings changes affect only future terminals, verified by an existing tab retaining its resolved session metadata across profile rename, edit, and default change

## 3. Accessibility and parity

- [x] 3.1 Add searchable labels, keyboard operation, focus management, validation announcements, and narrow-layout behaviour with parity between native settings windows and in-page browser settings, verified by keyboard-only and screen-reader tests over catalogue navigation, editing, reordering, validation, default reassignment, guarded deletion, and the one-off chooser at wide and narrow widths

## 4. Legacy cleanup

- [x] 4.1 Remove obsolete legacy shell fields from production configuration paths, retain their bounded reader only for the supported migration window, and update user-facing help and release notes; retiring the reader is deferred to a later schema cleanup

## 5. Acceptance checks

- [x] 5.1 Verify a new user can leave **System default** selected and consistently create the account shell without opening the advanced editor
- [x] 5.2 Verify a user can copy a discovered shell, edit argument and environment rows without quoting or JSON, make it the server or project default, and launch it once without changing a default
- [x] 5.3 Verify Desktop and browser clients on the same server observe one revisioned profile/default change, and clients on different servers neither show nor select each other's paths
- [x] 5.4 Verify unavailable, invalid, stale-revision, duplicate-name, protected-environment, and referenced-delete states are actionable and preserve user input
- [x] 5.5 Verify changing or deleting a profile does not alter an existing terminal's label, process, working directory, recording metadata, or session identity
- [x] 5.6 Run end-to-end tests covering macOS/Linux system defaults, Windows native and WSL fixtures, remote-server scoping, project overrides, working-directory policies, reset, and migrated legacy settings
