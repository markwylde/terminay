## ADDED Requirements

### Requirement: Server-managed shell integration at launch

The launch resolver SHALL add shell-integration arguments and environment only when shell integration applies to the resolved program and profile arguments, and SHALL add them after profile resolution, as server-managed values. Integration arguments SHALL NOT be stored as, shown as, or editable as profile arguments. Integration environment variables SHALL use the `TERMINAY_` namespace, except a shell's own startup-location variable such as zsh's `ZDOTDIR`, whose user value SHALL be carried in the `TERMINAY_` namespace and restored inside the shell. A profile SHALL NOT be able to remove or replace integration values. The canonical launch resolution snapshot SHALL record whether integration was applied.

#### Scenario: Integration does not appear in the profile

- **WHEN** a zsh terminal starts with integration and the user opens its profile in the editor
- **THEN** the profile's arguments and environment are unchanged and show nothing added by integration

#### Scenario: Profile overlay sets ZDOTDIR

- **WHEN** a zsh profile's environment overlay sets `ZDOTDIR` to `/home/u/.config/zsh`
- **THEN** the shell loads the user's startup files from `/home/u/.config/zsh` and `ZDOTDIR` equals that value once startup finishes

#### Scenario: Launch snapshot

- **WHEN** a terminal starts
- **THEN** its canonical launch resolution snapshot states whether shell integration was applied, without recording environment values
