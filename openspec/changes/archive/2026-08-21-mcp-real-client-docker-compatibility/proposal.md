## Why

Focused adapter tests used temporary home directories and validated the provider
file formats directly, but never installed or invoked the real Claude Code,
Codex, Cursor CLI, Gemini CLI, and OpenCode binaries. A provider changing its
configuration contract would therefore pass the repository's tests and fail for
users.

## What Changes

- A dedicated Docker image installs the latest published releases of Claude
  Code, Codex, Gemini CLI, and OpenCode, plus the current official Cursor CLI
  installer, on every compatibility run.
- The Terminay provider registry runs against a container-only home directory
  and a harmless local stdio command.
- Every real client is invoked without credentials, and its MCP management
  surface must recognise the `terminay` registration.
- A local Docker runner never mounts or forwards the host home, provider
  credentials, or provider configuration.
- The compatibility test becomes a required CI job, with a contract test that
  the isolation and workflow wiring remain present.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `mcp-server`: provider registration compatibility is proven against the real
  client binaries in an isolated container rather than against file formats
  alone.

## Impact

A new compatibility Docker image and its local runner, the CI workflow, and the
contract tests guarding isolation and workflow wiring. No product code path
changes; the registration behaviour under test is unchanged.
