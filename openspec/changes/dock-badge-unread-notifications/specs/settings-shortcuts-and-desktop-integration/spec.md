## ADDED Requirements

### Requirement: Application icon notification badge

Terminay Desktop SHALL show the Notifications count on its application icon: on the macOS Dock tile, and on Linux through the launcher count that the desktop's launcher or taskbar reads for the application's desktop entry. The badge SHALL equal the sum, over every open native workspace window, of the number that window's header Notifications control shows, and SHALL follow that number whenever it changes. At zero the icon SHALL carry no badge. A window that closes or reloads SHALL stop contributing until it reports again. Quitting Terminay SHALL leave no badge behind.

Each native window SHALL report only a count for itself, through the closed Desktop host action bound to that window. The host SHALL accept only a non-negative integer within its documented bound and SHALL reject anything else without changing the badge. The report SHALL carry no terminal, project, or server detail.

On a Linux desktop that offers no launcher count, and on any platform without an application icon badge, the icon SHALL remain unbadged and nothing else SHALL change. Browser and installed web clients SHALL NOT report a count.

#### Scenario: Notifications arrive while Terminay is in the background
- **WHEN** three terminals need attention or have finished unviewed and Terminay is not the frontmost application
- **THEN** the application icon shows 3

#### Scenario: A notification is dismissed
- **WHEN** the icon shows 3 and one notification is dismissed or its terminal is viewed
- **THEN** the icon shows 2, matching the header

#### Scenario: The last notification clears
- **WHEN** the header Notifications count reaches zero in every window
- **THEN** the application icon carries no badge

#### Scenario: Notifications in two windows
- **WHEN** one native window's header shows 2 and another's shows 1
- **THEN** the application icon shows 3

#### Scenario: A window with notifications closes
- **WHEN** a native window whose header shows 2 is closed while another window's header shows 1
- **THEN** the application icon shows 1

#### Scenario: Invalid count
- **WHEN** a window reports a count that is negative, fractional, non-numeric, or above the bound
- **THEN** the report is rejected and the badge is unchanged

#### Scenario: Linux desktop without a launcher count
- **WHEN** Terminay runs on a Linux desktop whose launcher does not implement a launcher count
- **THEN** the icon is unbadged and Terminay otherwise behaves the same

#### Scenario: Terminay quits with notifications outstanding
- **WHEN** Terminay quits while the icon shows a count
- **THEN** the icon carries no badge afterwards
