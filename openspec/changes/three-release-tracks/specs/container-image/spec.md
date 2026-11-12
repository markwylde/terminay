## MODIFIED Requirements

### Requirement: An image for every published version

An image SHALL be published for every version the project publishes: each tagged release, each Nightly build, and each Canary build. A Nightly or Canary image SHALL be tagged with exactly the version that build's desktop application and server archive report, of the form `<next stable version>-main.<count>.<track>`, and the server in it SHALL report that version. A Nightly or Canary image SHALL be published only after that build's prerelease assets have been published, so its tag never names a build whose other artifacts failed.

#### Scenario: A push to the default branch

- **WHEN** the canary prerelease for a default-branch push publishes version `5.13.0-main.3312.canary`
- **THEN** `markwylde/terminay:5.13.0-main.3312.canary` and the same tag on GHCR resolve to one manifest digest
- **AND** the server in that image reports version `5.13.0-main.3312.canary`

#### Scenario: A nightly build

- **WHEN** the nightly prerelease publishes version `5.13.0-main.3312.nightly`
- **THEN** `markwylde/terminay:5.13.0-main.3312.nightly` and the same tag on GHCR resolve to one manifest digest

#### Scenario: A failed prerelease publishes no image

- **WHEN** a Nightly or Canary build fails before its assets are published
- **THEN** no image is published for that build

### Requirement: Image tag forms

Image tags SHALL carry no `v` prefix. A tagged release `vX.Y.Z` SHALL publish `X.Y.Z`, `X.Y`, and `latest`. A Nightly build SHALL publish its version and `nightly`. A Canary build SHALL publish its version and `canary`. `latest` SHALL only ever name a tagged release, `nightly` SHALL only ever name a Nightly build, and `canary` SHALL only ever name a Canary build. No other moving tag SHALL be published.

#### Scenario: A release

- **WHEN** release `v5.13.0` is published
- **THEN** the tags `5.13.0`, `5.13`, and `latest` name its image
- **AND** `nightly` and `canary` do not move

#### Scenario: A nightly

- **WHEN** nightly `5.13.0-main.3312.nightly` is published
- **THEN** the tags `5.13.0-main.3312.nightly` and `nightly` name its image
- **AND** `latest` and `canary` do not move

#### Scenario: A canary

- **WHEN** canary `5.13.0-main.3320.canary` is published
- **THEN** the tags `5.13.0-main.3320.canary` and `canary` name its image
- **AND** `latest` and `nightly` do not move
