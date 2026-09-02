## Why

Pull-request CI had accumulated into a broad matrix that mixed merge-confidence checks with
release, image, and native-architecture evidence, making every pull request slow without making
a merge safer.

## What Changes

- Scope pull-request CI to one merge-confidence gate: a single build, lint, and fast-test job
  plus five independent Docker E2E shards.
- Remove release, image, and native architecture evidence from pull-request CI; keep native
  arm64 work in the manual release path.
- Remove pull-request and ordinary-main triggers from image workflows.
- Specify stale-run cancellation and runner-capacity boundaries.
- Update the workflow contract tests to match.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

_None._

## Impact

CI workflow definitions and their contract tests only. No product behaviour changes, so this
change carries no spec deltas.
