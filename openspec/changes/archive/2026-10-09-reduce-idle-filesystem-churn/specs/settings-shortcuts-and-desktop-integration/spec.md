## ADDED Requirements

### Requirement: Change-driven desktop settings reads

Terminay Desktop SHALL serve its device-local settings from a cached parsed
value and SHALL refresh that value from change notification rather than by
re-reading the backing files on each access. A write issued by Desktop itself
SHALL invalidate the cache as part of that write, so a read taken immediately
afterwards observes the written value without waiting for a notification. When
no change notification is active for those files, Desktop SHALL read them on
every access rather than serve a value it cannot know to be current. A cached
value SHALL be indistinguishable from a fresh read: the same settings, the same
defaults when a file is absent or malformed.

#### Scenario: Repeated reads while nothing changes

- **WHEN** Desktop reads its device-local settings repeatedly and no settings
  file has changed
- **THEN** the settings are served from the cached value
- **AND** the backing files are not re-read for each access

#### Scenario: Settings file edited outside the app

- **WHEN** a device-local settings file is changed by something other than
  Desktop
- **THEN** the change notification invalidates the cache
- **AND** the next read observes the changed settings

#### Scenario: Desktop writes its own settings

- **WHEN** Desktop writes device-local settings
- **THEN** the cache is invalidated as part of that write
- **AND** a read taken immediately afterwards observes the written settings

#### Scenario: No change notification available

- **WHEN** change notification for the settings files cannot be established or
  has failed
- **THEN** Desktop reads the settings files on every access
- **AND** no cached value is served
