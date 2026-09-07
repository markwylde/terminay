## Why

Terminay claims Cursor Agent support in the Agents sidebar and has never
verified it against the real CLI. It has no conformance descriptor, no matrix
row, and no end-to-end coverage; its only real-CLI test runs `cursor-agent
--print` and asserts stdout, never involving a PTY, the provider, or a single
lifecycle event.

Verifying it is not affordable. Cursor sells a monthly subscription with no
credit-based usage tier, so keeping this provider honest means paying a
recurring subscription solely to run tests. Every other provider in the matrix
authenticates with a metered API key.

Shipping a provider we cannot verify is worse than not shipping it: it puts a
row in front of users that no test defends, and it dilutes the guarantee the
other providers now carry.

## What Changes

- Remove the `terminay-agent-cursor` extension, its provider, its manifest
  contribution, its catalogue entry, and its built-in staging and packaging
  entries.
- Remove the Cursor requirements from the agent status capability and the
  Cursor entries from the built-in extensions capability.
- Users who ran the Cursor CLI keep working terminals; those terminals use the
  ordinary terminal-activity fallback rather than an agent row.

## Capabilities

### Modified Capabilities

- `agent-status-and-sidebar`: Cursor is no longer a bundled provider and its
  binding, mapping, and non-projection requirements are removed.
- `built-in-extensions`: Cursor is no longer one of the official packages.

## Impact

- `extensions/agent-cursor/`: deleted.
- `extensions/builtins.json`, `packages/server-core/src/extensions/catalog.ts`,
  `turbo.json`, `Dockerfile.e2e`, `package.json`: entries removed.
- `scripts/stage-built-in-extensions.mjs`,
  `scripts/verify-built-in-extension-artifacts.mjs` and the packaging contract
  tests: Cursor removed from the expected built-in set.
- No protocol or client change. A persisted Cursor provider id remains bounded
  metadata that loads no code, which the platform already requires.
