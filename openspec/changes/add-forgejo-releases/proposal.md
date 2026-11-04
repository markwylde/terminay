## Why

Users need independently built macOS and Linux downloads on git.i.wylde.net so releases can continue without GitHub. GitHub remains a mirror with its existing releases, including Windows, and remains the application update source.

## What Changes

- Add a manually dispatched Trigger Release workflow on the canonical forge, deriving a stable version from Conventional Commits with the existing release helper and building the selected main commit independently.
- Build signed/notarized macOS arm64 DMG and ZIP assets and a Linux x64 AppImage using the existing packaging and verification steps.
- Stage a draft release, attach checksummed assets, and publish only after both platforms succeed and downloaded assets verify.
- Document runner labels, credentials, dispatch, retry, and the retained GitHub update source.

## Capabilities

### New Capabilities

- `forge-release-distribution`: Independent desktop release builds and publication on the canonical forge.

### Modified Capabilities

None.

## Impact

Adds .gitea/workflows/trigger-release.yml, forge release scripts/tests, and an operator runbook. Existing GitHub workflows, Windows builds, updater configuration, and standalone server release channels retain their contracts. Requires macos arm64 and ubuntu-latest x64 runners plus Apple signing credentials on the canonical forge.
