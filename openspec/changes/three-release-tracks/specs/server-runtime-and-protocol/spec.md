## MODIFIED Requirements

### Requirement: Release packaging validation

Release packaging SHALL publish, for every tagged release, one self-contained server archive per supported Linux architecture, named `terminay-server-<version>-linux-<arch>.tar.gz`, together with a SHA-256 sidecar and an Ed25519 signature over the archive bytes made with the release signing key. Release packaging SHALL validate the standalone distribution manifest, pinned Node engine, required CLI entrypoints, payload hashes, native architecture of the bundled Node and `node-pty`, and absence of Electron imports before publication. Native OS, architecture, and ABI probes SHALL remain release evidence. Native standalone release jobs SHALL establish a version-controlled checkout before building or probing the archive, and runner evidence SHALL be valid only when it binds the probed bytes to the checked-out commit and proves that worktree clean. Each rolling prerelease SHALL be rebuilt with the same archives, sidecars, and signatures by every build of its track: the nightly prerelease by every Nightly build, with archives named `terminay-server-main-linux-<arch>.tar.gz`, and the canary prerelease by every Canary build, with archives named `terminay-server-canary-linux-<arch>.tar.gz`. A rolling prerelease's assets SHALL be replaced so a reader sees either the previous complete set or the new complete set.

#### Scenario: Tagged release assets

- **WHEN** a release tag is published
- **THEN** the release carries a linux-x64 and a linux-arm64 server archive, each with a matching SHA-256 sidecar and Ed25519 signature

#### Scenario: Electron import in a server payload

- **WHEN** packaging detects an Electron import in the standalone payload
- **THEN** publication fails

#### Scenario: Architecture mismatch

- **WHEN** the bundled Node binary or `node-pty` addon does not match the archive's declared architecture
- **THEN** publication fails

#### Scenario: Rolling canary prerelease

- **WHEN** commits are pushed to `main`
- **THEN** the canary prerelease is rebuilt with archives whose manifests record the pushed head
- **AND** the nightly prerelease's archives are unchanged

#### Scenario: Rolling main prerelease

- **WHEN** a Nightly build is published
- **THEN** the `main` prerelease is rebuilt with archives whose manifests record the commit that Nightly was built from

#### Scenario: Release evidence

- **WHEN** a native release job records probe evidence
- **THEN** the evidence binds the probed bytes to the checked-out commit and proves the worktree clean

### Requirement: Deterministic artifact manifest verification

Standalone packaging SHALL emit a deterministic `artifact-manifest.json` containing the package version, release channel (`tag`, `main`, or `canary`), built commit, target architecture, pinned Node engine, the exact `terminay-server` and `terminay-mcp` entrypoint paths, SHA-256 payload hashes, and provenance pointers. A Nightly archive SHALL record the channel `main` and a Canary archive the channel `canary`. The verification script SHALL re-hash a candidate payload and fail on missing files, changed or additional executable bins, tampering, unsafe manifest paths, or Electron imports. This SHALL be a pre-release integrity check; signatures, notarization, and native release certification remain separate gates.

#### Scenario: Tampered payload

- **WHEN** a candidate payload's re-hashed contents do not match the manifest
- **THEN** verification fails

#### Scenario: Unexpected executable bin

- **WHEN** a candidate payload adds or changes an executable bin relative to the manifest
- **THEN** verification fails

#### Scenario: Channel and revision recorded

- **WHEN** an archive is built for a tag, for a Nightly, or for a Canary
- **THEN** its manifest records the channel, the version, the commit, and the architecture

### Requirement: Windows Desktop starts terminals on Windows before publication

The Stable release, the Nightly build, and the Canary build SHALL each build the Windows installer on a Windows x64 runner. Before the installer or its update payload is checksummed, attached, or named in update metadata, release packaging SHALL install that exact installer silently for the current user. It SHALL start the installed application with an isolated data directory and wait until the embedded server and its session holder report ready. It SHALL then run Windows PowerShell and Command Prompt in PTYs through the packaged `node-pty`, write input to each, resize each, observe output, and observe a clean exit. It SHALL also restart the server and observe that a held terminal is still running. Publication SHALL fail if any step does not succeed, and the probe SHALL record the installer's SHA-256 with its result.

#### Scenario: Probe passes

- **WHEN** a candidate installer passes every probe step
- **THEN** it and its update metadata are published, and the probe record names the installer's SHA-256

#### Scenario: Holder never becomes ready

- **WHEN** the installed application's session holder exits before it reports ready
- **THEN** the probe fails with the holder's reported reason and nothing for Windows is published for that run

#### Scenario: A shell cannot start

- **WHEN** PowerShell or Command Prompt does not start or does not echo input in the packaged PTY
- **THEN** publication fails and names the shell
