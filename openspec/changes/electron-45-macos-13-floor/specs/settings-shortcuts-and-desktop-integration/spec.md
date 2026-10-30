## ADDED Requirements

### Requirement: Updates declare the oldest system they run on

Every macOS update metadata file Terminay publishes, on every channel, SHALL declare the oldest macOS the update runs on, as the Darwin kernel version electron-updater compares with the running system. Publication SHALL fail when that declaration is missing or differs from the supported matrix's macOS floor. A Desktop running on a system below an update's declared floor SHALL keep its installed version, SHALL NOT download or install that update, and SHALL NOT show an update action for it.

#### Scenario: Mac below the floor

- **WHEN** a Desktop on a Mac older than the update's declared floor checks for updates
- **THEN** it does not download or install that update and keeps running its installed version

#### Scenario: Mac at or above the floor

- **WHEN** a Desktop on a supported macOS checks for an update that declares the floor
- **THEN** it updates as it would for any other update

#### Scenario: Metadata without the floor

- **WHEN** a release or beta job produces macOS update metadata without the floor, or with a different floor
- **THEN** publication fails before the metadata becomes visible to installed clients
