## ADDED Requirements

### Requirement: Add connection shows how to start a server

The Add connection surface SHALL show, beneath the pairing URL field, a section that tells a person who has no server how to start one. Without any interaction it SHALL show exactly two options — Docker, selected first, and a Linux host — and for the selected option one command that starts a Terminay server and one command that prints its pairing link. It SHALL say that the printed link is what goes in the pairing URL field. Each command SHALL be copyable with one action, and copying SHALL be confirmed visibly.

Further options SHALL sit behind a single disclosure that is collapsed by default: a Docker command for browsers and phones that sets the public host and publishes the signaling and UDP ports, a Docker command for a Linux host using host networking, and a link to the manual archive install. The section SHALL link to the installation guide on the Terminay website and SHALL NOT explain networking, exposure, or troubleshooting itself.

The section SHALL be shown in Terminay Desktop and in the web manager, SHALL not obstruct or delay pairing with a URL the person already has, and SHALL be reachable and operable by keyboard with each command exposed to assistive technology as text.

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
