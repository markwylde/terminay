## Context

See proposal.md. The gap was one of evidence, not implementation: the registry
wrote the right files, but nothing checked that the five clients still read them
the way the adapters assumed.

## Goals / Non-Goals

Goals:
- Prove in CI that every supported agent CLI accepts the user-level Terminay MCP
  registration.
- Never touch a developer's host configuration or credentials while proving it.

Non-Goals:
- Authenticating to any provider, making a model request, or exercising tool
  calls through the real clients.

## Decisions

- **Install the latest published releases on every run.** Pinning versions would
  hide exactly the drift this test exists to catch, so the image installs the
  current releases each time.
- **The container home is the only home.** The runner never mounts or forwards
  the host home, provider credentials, or provider configuration, and a contract
  test asserts that isolation stays in place. Without that assertion the test
  could silently start passing because of a developer's own configuration.
- **Recognition is the assertion.** Each client's own MCP management surface
  must list the `terminay` registration; the test does not parse the client's
  configuration files itself, since doing so would re-test the adapter rather
  than the client.
- **No credentials, no model calls.** The clients are invoked only far enough to
  list their MCP registrations, keeping the job runnable in CI without secrets.
- **Failure names the client.** A real provider configuration contract change
  fails CI with the client name and bounded command output, so the drift is
  identifiable from the CI log alone.

## Risks / Trade-offs

- Installing the latest releases each run makes the job sensitive to upstream
  publication problems, and a provider outage can fail CI for reasons unrelated
  to the change under review. That is accepted as the cost of detecting real
  contract drift early.
