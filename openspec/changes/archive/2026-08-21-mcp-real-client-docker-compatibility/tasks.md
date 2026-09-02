## 1. Isolated compatibility harness

- [x] 1.1 Add a dedicated Docker image that installs the latest published
  releases of Claude Code, Codex, Gemini CLI, and OpenCode plus the current
  official Cursor CLI installer on every compatibility run, and verify all five
  binaries report their installed versions inside the container
- [x] 1.2 Run the Terminay provider registry against a container-only home
  directory and a harmless local stdio command, verifying all five user-scope
  registrations are installed in the container home
- [x] 1.3 Invoke every real client without credentials and verify
  `claude mcp list`, `codex mcp list`, `cursor-agent mcp list`,
  `gemini mcp list`, and `opencode mcp list` each report `terminay`
- [x] 1.4 Add a local Docker runner that never mounts or forwards the host home,
  provider credentials, or provider configuration, and verify no authentication,
  model request, or host provider state is required

## 2. CI wiring

- [x] 2.1 Add the compatibility test as a required CI job
- [x] 2.2 Contract-test that the isolation and workflow wiring remain present
- [x] 2.3 Verify a real provider configuration contract change fails CI with the
  client name and bounded command output
