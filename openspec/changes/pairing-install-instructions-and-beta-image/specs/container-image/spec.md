## ADDED Requirements

### Requirement: An image for every published version

An image SHALL be published for every version the project publishes: each tagged release, and each beta build of the default branch. A beta image SHALL be tagged with exactly the beta version that build's desktop application and server archive report, of the form `<next stable version>-beta.<run>`, and the server in it SHALL report that version. A beta image SHALL be published only after that build's prerelease assets have been published, so a beta tag never names a build whose other artifacts failed.

#### Scenario: A push to the default branch

- **WHEN** the rolling prerelease for a default-branch commit publishes version `5.13.0-beta.214`
- **THEN** `markwylde/terminay:5.13.0-beta.214` and the same tag on GHCR resolve to one manifest digest
- **AND** the server in that image reports version `5.13.0-beta.214`

#### Scenario: A failed prerelease publishes no image

- **WHEN** the rolling prerelease fails before its assets are published
- **THEN** no image is published for that build

### Requirement: Image tag forms

Image tags SHALL carry no `v` prefix. A tagged release `vX.Y.Z` SHALL publish `X.Y.Z`, `X.Y`, and `latest`. A beta build SHALL publish its beta version and `beta`. `latest` SHALL only ever name a tagged release, and `beta` SHALL only ever name a beta build. No other moving tag SHALL be published.

#### Scenario: A release

- **WHEN** release `v5.13.0` is published
- **THEN** the tags `5.13.0`, `5.13`, and `latest` name its image
- **AND** `beta` does not move

#### Scenario: A beta

- **WHEN** beta `5.13.0-beta.214` is published
- **THEN** the tags `5.13.0-beta.214` and `beta` name its image
- **AND** `latest` does not move

### Requirement: Each architecture is built natively

The `amd64` and `arm64` images SHALL each be built on a runner of that architecture and joined into one multi-architecture manifest. Neither architecture SHALL be published unless both were built from the same commit.

#### Scenario: One manifest, two native builds

- **WHEN** an image is published
- **THEN** its manifest lists `linux/amd64` and `linux/arm64`, each built without emulation

#### Scenario: One architecture fails

- **WHEN** the build for one architecture fails
- **THEN** no tag is published or moved
