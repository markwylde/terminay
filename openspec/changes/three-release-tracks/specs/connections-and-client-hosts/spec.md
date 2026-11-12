## MODIFIED Requirements

### Requirement: Install commands name the image that matches the client

The Docker commands shown by Add connection SHALL name the official image at the tag that matches the client showing them. Terminay Desktop built from a stable release SHALL name the image at that release's version. Terminay Desktop built as a Nightly or a Canary SHALL name the image at that build's version. A development build, and the web manager, SHALL name the image with no tag, which resolves to the newest stable release. The Linux host command SHALL install the stable release on a stable client, the nightly channel (`main`) on a Nightly client, and the canary channel (`canary`) on a Canary client. The version and channel SHALL come from the host that ships the client, never from a server or a pairing URL.

#### Scenario: Stable Desktop

- **WHEN** Add connection is shown by Desktop version `5.13.0`
- **THEN** the Docker command names `markwylde/terminay:5.13.0`

#### Scenario: Nightly Desktop

- **WHEN** Add connection is shown by Desktop version `5.13.0-main.3312.nightly`
- **THEN** the Docker command names `markwylde/terminay:5.13.0-main.3312.nightly`
- **AND** the Linux host command is `daemon install main`

#### Scenario: Canary Desktop

- **WHEN** Add connection is shown by Desktop version `5.13.0-main.3320.canary`
- **THEN** the Docker command names `markwylde/terminay:5.13.0-main.3320.canary`
- **AND** the Linux host command is `daemon install canary`

#### Scenario: Web manager and development builds

- **WHEN** Add connection is shown by the web manager or by a development build
- **THEN** the Docker command names `markwylde/terminay` with no tag
