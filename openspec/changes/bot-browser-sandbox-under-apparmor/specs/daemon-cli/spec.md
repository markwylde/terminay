## ADDED Requirements

### Requirement: Bot AppArmor profile

For a system-scope install on a host whose kernel has AppArmor enabled and which has `apparmor_parser`, `daemon install` and `daemon upgrade` run as root SHALL write the `terminay-bot` AppArmor profile to `/etc/apparmor.d/terminay-bot`, owned by root with mode 0644, and SHALL then load it. `daemon upgrade` SHALL do so whether or not a newer release is available, and, after switching to a new release and before starting it, SHALL run the new release's host setup so that the release being installed applies its own profile. The profile SHALL contain every rule of Docker's default container profile and add only permission to create user namespaces. Failing to write or load it SHALL be reported as a warning and SHALL NOT fail the command; a failed write SHALL NOT be followed by a load. On a host without AppArmor, or for a user-scope install, the CLI SHALL NOT write it. `daemon uninstall` SHALL remove the file and SHALL NOT unload the loaded profile.

#### Scenario: Install on an AppArmor host

- **WHEN** a system-scope `daemon install` completes on a host with AppArmor and `apparmor_parser`
- **THEN** `/etc/apparmor.d/terminay-bot` exists, is owned by root with mode 0644, and the profile is loaded

#### Scenario: Upgrade to a release with the profile

- **WHEN** a system-scope install is upgraded as root to a release that carries the profile
- **THEN** that release's host setup writes and loads the profile before the upgraded server starts

#### Scenario: Upgrade with nothing to do

- **WHEN** `sudo terminay daemon upgrade` runs on a system-scope install that is already current
- **THEN** the profile is written and loaded

#### Scenario: Load fails

- **WHEN** `apparmor_parser` fails to load the profile
- **THEN** the command prints a warning naming the profile and completes

#### Scenario: Host without AppArmor

- **WHEN** a system-scope install runs on a host without AppArmor
- **THEN** no profile is written and the install completes

#### Scenario: Uninstall

- **WHEN** a system-scope `daemon uninstall` runs
- **THEN** `/etc/apparmor.d/terminay-bot` is removed, the loaded profile stays loaded until the host reboots, and running bot containers stay confined
