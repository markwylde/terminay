# Real MCP client compatibility in Docker

## Goal

Prove in CI that every supported agent CLI accepts the user-level Terminay MCP
registration without touching a developer's host configuration.

## Current gap

Focused adapter tests use temporary home directories and validate the provider
file formats directly, but do not install or invoke the real Claude Code,
Codex, Cursor CLI, Gemini CLI, and OpenCode binaries.

## Scope

- [x] Add a dedicated Docker image that installs the latest published releases
  of Claude Code, Codex, Gemini CLI, and OpenCode plus the current official
  Cursor CLI installer on every compatibility run.
- [x] Run the Terminay provider registry against a container-only home directory
  and a harmless local stdio command.
- [x] Invoke every real client without credentials and require its MCP
  management surface to recognize the `terminay` registration.
- [x] Add a local Docker runner that never mounts or forwards the host home,
  provider credentials, or provider configuration.
- [x] Add the compatibility test as a required CI job and contract-test that
  the isolation and workflow wiring remain present.

## Acceptance checks

- [x] All five binaries report their installed versions inside the container.
- [x] Terminay independently installs all five user-scope registrations in the
  container home.
- [x] `claude mcp list`, `codex mcp list`, `cursor-agent mcp list`, `gemini mcp
  list`, and `opencode mcp list` each report `terminay`.
- [x] No authentication, model request, or host provider state is required.
- [x] A real provider configuration contract change fails CI with the client
  name and bounded command output.

## Definition of done

The Docker compatibility test passes locally, is required by CI, its isolation
contract is covered, and this completed task is moved to `tasks_completed/`.
