## ADDED Requirements

### Requirement: Add connection shows how to start a server

The Add connection surface SHALL show, beneath the pairing URL field, a section that tells a person who has no server how to start one. Without any interaction it SHALL show exactly two options — Docker, selected first, and a Linux host — and for the selected option one command that starts a Terminay server and one command that prints its pairing link. It SHALL say that the printed link is what goes in the pairing URL field. Each command SHALL be copyable with one action, and copying SHALL be confirmed visibly.

Further options SHALL sit behind a single disclosure that is collapsed by default: a Docker command for browsers and phones that sets the public host and publishes the signaling and UDP ports, a Docker command for a Linux host using host networking, and a link to the manual archive install. The section SHALL link to the installation guide on the Terminay website and SHALL NOT explain networking, exposure, or troubleshooting itself.

The section SHALL be shown wherever Add connection is offered, in Terminay Desktop and in the web manager, SHALL not obstruct or delay pairing with a URL the person already has, and SHALL be reachable and operable by keyboard with each command exposed to assistive technology as text.

#### Scenario: A person with no server

- **WHEN** a person opens Add connection
- **THEN** the pairing URL field is shown first
- **AND** beneath it a Docker command that starts a server and the command that prints its pairing link are visible without any interaction

#### Scenario: Choosing the Linux host option

- **WHEN** the person selects the Linux host option
- **THEN** the installer command and the command that prints the pairing link replace the Docker ones

#### Scenario: Copying a command

- **WHEN** the person activates the copy control on a command
- **THEN** exactly that command is placed on the clipboard and the control confirms it

#### Scenario: More options stay out of the way

- **WHEN** the section is first shown
- **THEN** the browser-and-phone command, the host-networking command, and the manual install link are not visible
- **AND** activating the disclosure shows them

#### Scenario: Pairing is unaffected

- **WHEN** the person pastes a pairing URL and continues without touching the section
- **THEN** pairing proceeds exactly as it does without the section

### Requirement: Install commands name the image that matches the client

The Docker commands shown by Add connection SHALL name the official image at the tag that matches the client showing them. Terminay Desktop built from a stable release SHALL name the image at that release's version. Terminay Desktop built as a beta SHALL name the image at that beta's version. A development build, and the web manager, SHALL name the image with no tag, which resolves to the newest stable release. The Linux host command SHALL install the stable release on a stable client and the rolling default-branch channel on a beta client. The version and channel SHALL come from the host that ships the client, never from a server or a pairing URL.

#### Scenario: Stable Desktop

- **WHEN** Add connection is shown by Desktop version `5.13.0`
- **THEN** the Docker command names `markwylde/terminay:5.13.0`

#### Scenario: Beta Desktop

- **WHEN** Add connection is shown by Desktop version `5.13.0-beta.214`
- **THEN** the Docker command names `markwylde/terminay:5.13.0-beta.214`
- **AND** the Linux host command installs the rolling default-branch channel

#### Scenario: Web manager and development builds

- **WHEN** Add connection is shown by the web manager or by a development build
- **THEN** the Docker command names `markwylde/terminay` with no tag

### Requirement: Remote Control lists the host's remembered servers

On Terminay Desktop the Remote Control saved-server list SHALL be the host's remembered connection profiles, the same set the connection menu offers to attach, and SHALL NOT include Local. The list SHALL reflect a server that was paired, renamed, or forgotten in any window without the Remote Control window being reopened. A row SHALL show a connection status only where its source can speak for the server; a remembered server that this window has not attached SHALL NOT be presented as offline.

#### Scenario: A server paired earlier is listed

- **WHEN** Desktop remembers a server and the person opens Remote Control
- **THEN** that server is in the saved-server list
- **AND** Local is not

#### Scenario: A server that the menu offers to attach is manageable

- **WHEN** the connection menu offers **Attach** for a remembered server
- **THEN** Remote Control lists that same server

#### Scenario: Pairing in another window

- **WHEN** a server is paired while Remote Control is open
- **THEN** it appears in the saved-server list without reopening the window

### Requirement: Renaming and forgetting a remembered server on Desktop

Remote Control on Desktop SHALL offer **Rename** and **Forget** for a remembered server through source-bound host actions that name the profile by id and carry no origin or credential. Rename SHALL accept a single-line label of at most 256 characters and change display metadata only. Forget SHALL require confirmation that says it does not revoke server access, SHALL close the profile's connection in every window, and SHALL remove this device's credential for that server before it removes the profile, so that a failure leaves the profile listed and no credential without one. Forget SHALL refuse Local and SHALL refuse a server that a window runs on as its primary connection. Actions that the host does not support for a server SHALL be absent rather than disabled.

#### Scenario: Renaming a server

- **WHEN** the person renames a remembered server
- **THEN** its new label is shown in Remote Control and in the connection menu
- **AND** nothing on the server changes

#### Scenario: Forgetting a server

- **WHEN** the person confirms Forget for a remembered server
- **THEN** the server leaves the saved-server list and the connection menu
- **AND** this device's credential for it is removed
- **AND** the device remains authorized on the server until it is revoked there

#### Scenario: Forget cannot remove the credential

- **WHEN** removing the credential fails
- **THEN** the server stays in the list and the failure is shown

#### Scenario: A server a window runs on

- **WHEN** the person tries to forget the server that is a window's primary connection
- **THEN** it is refused with a message to close that window first

### Requirement: Remote Control pane shows one subject

The Remote Control main pane SHALL show only the selected sidebar item: a server's name with the actions available for it, or Add connection. Rename and the forget confirmation SHALL appear in that pane in place of the actions. Outcome and error messages SHALL appear in one place above the pane. The window SHALL be legible in the light and the dark theme. At phone width the saved-server list and Exposure SHALL remain reachable above the pane, and no content SHALL require horizontal scrolling.

#### Scenario: Selecting a server

- **WHEN** the person selects a saved server
- **THEN** the pane shows that server's name and only the actions that can be performed on it

#### Scenario: Phone width

- **WHEN** Remote Control is shown at phone width
- **THEN** the saved servers and Add connection are reachable
- **AND** the page does not scroll horizontally
