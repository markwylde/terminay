## ADDED Requirements

### Requirement: Three release tracks built from the default branch

Terminay SHALL publish three release tracks, each built from the default branch: **Stable**, **Nightly** and **Canary**. A Stable release SHALL be built only when a maintainer dispatches the release workflow. A Nightly build SHALL be started by a nightly schedule. A Canary build SHALL be started by a push to the default branch. No track SHALL be built from any other branch.

#### Scenario: Maintainer cuts a stable release

- **WHEN** a maintainer dispatches the release workflow
- **THEN** a Stable release is built from the default branch and published under a new `vX.Y.Z` tag

#### Scenario: Push to the default branch

- **WHEN** commits are pushed to the default branch
- **THEN** a Canary build of the pushed head starts
- **AND** no Stable release and no Nightly build starts because of that push

#### Scenario: Nightly schedule

- **WHEN** the nightly schedule fires and the default branch has changed since the last published Nightly
- **THEN** a Nightly build of the head of the default branch starts

### Requirement: One canary build per push

A push to the default branch SHALL produce at most one Canary build, of the head commit of that push, however many commits the push carries. Canary builds SHALL be published in push order and SHALL NOT interleave. Pushes that arrive while a Canary build is running MAY be served by one build of the newest pushed head.

#### Scenario: Several commits in one push

- **WHEN** one push adds five commits to the default branch
- **THEN** one Canary build is published, built from the fifth commit

#### Scenario: Pushes arrive during a build

- **WHEN** two pushes arrive while a Canary build is running
- **THEN** the running build is published before any later build
- **AND** the next published Canary is built from the newest pushed head

### Requirement: A nightly build is skipped when nothing changed

The Nightly schedule SHALL compare the head of the default branch with the commit the last published Nightly was built from. When they are the same commit, it SHALL build and publish nothing and SHALL report the run as skipped, not failed. A Nightly that failed before publication SHALL NOT count as published.

#### Scenario: No change since the last nightly

- **WHEN** the schedule fires and the head of the default branch is the commit the published Nightly was built from
- **THEN** nothing is built, nothing is submitted to Apple, and the published Nightly is unchanged

#### Scenario: Last night's build failed

- **WHEN** the previous Nightly failed before publication and the default branch has not moved since
- **THEN** tonight's schedule builds that commit

### Requirement: Prerelease versions order by commit across tracks

A Nightly or Canary build SHALL be versioned `<next>-main.<count>.<track>`, where `<next>` is the stable version the release workflow would cut from the built commit, `<count>` is the number of commits reachable from the built commit, and `<track>` is `nightly` or `canary`. Every artifact of one build SHALL report that one version. By semantic-version precedence, a build of a later commit SHALL sort above a build of an earlier commit on either track, a Nightly SHALL sort above the Canary of the same commit, and a Stable release SHALL sort above every Nightly and Canary that led to it.

#### Scenario: Later commit on the other track

- **WHEN** a Nightly is `6.3.0-main.3300.nightly` and a Canary is `6.3.0-main.3312.canary`
- **THEN** the Canary has the higher precedence

#### Scenario: Same commit on both tracks

- **WHEN** a Nightly and a Canary are built from the same commit
- **THEN** their versions differ only in the final component and the Nightly has the higher precedence

#### Scenario: Stable release after its prereleases

- **WHEN** stable `6.3.0` is released after `6.3.0-main.3312.canary`
- **THEN** `6.3.0` has the higher precedence
- **AND** the next Canary is versioned above `6.3.0`

### Requirement: macOS signing and notarization by track

Every macOS build on every track SHALL be signed with the project's Developer ID certificate under the hardened runtime, and publication SHALL fail when the signature is missing, invalid, or made by another team. Stable and Nightly macOS builds SHALL also be notarized by Apple and stapled, and publication SHALL fail when notarization is missing. A Canary macOS build SHALL NOT be submitted to Apple's notary service, and its job SHALL hold no notarization credential.

#### Scenario: Canary build

- **WHEN** a Canary macOS build is published
- **THEN** its application bundle carries a valid Developer ID signature from the project's team
- **AND** no notarization submission was made for it

#### Scenario: Nightly build

- **WHEN** a Nightly macOS build is published
- **THEN** its application bundle is signed, notarized and stapled, and passes Gatekeeper assessment

#### Scenario: Canary signing unavailable

- **WHEN** the signing certificate is unavailable to a Canary build
- **THEN** no macOS Canary is published and the previous Canary stays in place

### Requirement: Each prerelease track has one rolling release

Nightly builds SHALL be published to the rolling release tagged `main-latest`, and Canary builds to the rolling release tagged `canary-latest`. Each SHALL be a GitHub prerelease whose assets carry fixed names and are replaced by every build of its track. A build's assets SHALL be replaced as a set with its update metadata moved last, so a reader sees either the previous complete build or the new one. Nightly update metadata SHALL be named for the `nightly` channel and Canary update metadata for the `canary` channel, with the platform suffix electron-updater expects. A build of one track SHALL NOT change the other track's release.

#### Scenario: Canary publishes

- **WHEN** a Canary build is published
- **THEN** the assets of `canary-latest` are that build's
- **AND** `main-latest` is unchanged

#### Scenario: Reader during a swap

- **WHEN** a client reads a track's update metadata while its assets are being replaced
- **THEN** the metadata it reads names a payload whose digest it can verify, or the download fails its digest check and is retried at the next check

### Requirement: Canary desktop payloads are not offered for download

The project SHALL NOT link a Canary desktop payload as a download: not from release notes, the website, the README, or any installation document. A Canary build SHALL be reached only by selecting the Canary update channel in an installed Terminay Desktop.

#### Scenario: Installation documents

- **WHEN** a person reads the project's installation documents
- **THEN** they link no Canary desktop payload and describe Canary as a channel chosen inside the app
