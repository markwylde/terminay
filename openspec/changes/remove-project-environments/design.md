## Context

A Terminay Server today executes a project in one of three places: on its own
host, on an SSH host, or on a Puzed VM reached through SSH. The place is an
immutable `projectEnvironmentId` plus `environmentRevision` on every project
and terminal session. An environment router sits at the operation dispatch
boundary and forwards `files.*`, `git.*`, terminal, shell-discovery, and
observation operations to a provider extension when the project is not bound
to `terminay:this-server`. Providers advertise a capability subset, and every
feature renders "limited" when a capability is absent. ADR-0009 made this the
design.

The same product already has a second, complete remote model: a client
connects to a Terminay Server anywhere. The two layers were kept orthogonal on
purpose so that clients hold no credentials. That reason still holds, and this
design keeps it, because the only remote left is a server connection, and
server credentials already live in the host and never in the workspace UI.

Stakeholders: the workspace UI, server-core, the extension API, the agent
extensions, packaging, and the specs listed in the proposal. There are no
users to migrate.

## Goals / Non-Goals

**Goals:**

- One execution model: a project executes on the server that owns it.
- Delete the environment layer and every branch that exists only because of
  it, rather than leaving a single-provider shell of it behind.
- Keep the agent extension contract and the extension host unchanged in shape.
- Keep the persisted state format simple: drop fields, bump the version.

**Non-Goals:**

- Connecting one window to several servers (phase 2).
- Installing a Terminay Server on a remote machine over SSH, a macOS
  standalone artifact, or a Puzed image that ships a server.
- Any change to pairing, transport, exposure, or hosted services.
- Backwards compatibility with persisted state that carries environment
  fields.

## Decisions

### A project has a root on its server, and nothing else

`Project` loses `projectEnvironmentId` and `environmentRevision`.
`TerminalSession` loses `projectEnvironmentId`. `validateWorkspace` drops the
environment-mismatch check. The root is a path on the server's filesystem,
resolved and contained by the existing canonical path resolver.

Alternative rejected: keep a single hardcoded environment id so that record
shapes do not change. That keeps every consumer's branch alive and keeps the
router at the dispatch boundary. The point of the change is to delete those.

Boundary: workspace state is server-owned; this narrows what the server
persists and validates, and removes the only client-visible field that named a
machine other than the server.

### The environment router leaves the dispatch boundary

`composition.ts` merges operation registries directly. `dispatcher.ts` loses
the two environment error classes. `launchResolver.ts` builds a native PTY
only. `fileService`, `gitService`, `shellProfiles`, and `activity` call their
local implementations without a routing hop. The fail-closed rule that an
unmapped `git.*` operation must not run on the wrong host disappears with the
possibility it guarded.

Boundary: this is the privileged operation-dispatch boundary. Removing the
router removes a class of bug (fall-through to the wrong machine) rather than
adding authority anywhere.

### Agent extensions keep their broker; every capability is present

The agent observation broker (`terminal.observation.*`) keeps its interface.
`extensionAgentObservationRouter.ts` collapses into `localAgentObservation.ts`.
The `environment-capability-missing` outcome, the `requiredEnvironmentCapabilities`
manifest field, and the `EnvironmentCapability` enum are removed from the
extension API; providers no longer subset by environment because there is only
the server host.

Alternative rejected: leave `EnvironmentCapability` as a stub for a future
remote model. Phase 4 will add a language-server contribution kind and does not
need it; a future SSH bootstrap would create server connections, not
environments.

Boundary: the extension API is a public package. Removing a contribution kind
and an enum is a breaking API change, accepted because no third-party
extension exists.

### The extension platform keeps its host, loses its provider kind

`ExtensionHost`, the child process model, the broker allowlist, crash
accounting, quarantine, catalogue, installer, built-in materialisation, and
Settings presentation stay. `contributes.projectEnvironments`,
`dependencyOperations`, `provider.call`, `profile.get`, the declarative
provider form and status card, and the `project-environments.*` protocol
operations go. The spec's purpose statement, bounded API scope, and host-owned
surfaces are restated for agent providers, so that phase 4 can add language
servers as a second kind on a clean base.

### Persisted state bumps its version and reads nothing older

The workspace repository's state version increments. A repository at the
previous version is treated as unreadable and preserved, per the existing
"corrupt state preservation" rule. There are no installed users to migrate, so
no migration code is written.

### Naming

"This server", "the project's environment", "environment-routed", and
"Local (this server)" become "the server" throughout the specs. The Desktop
connection named **Local** keeps its name because it names a connection, not
an environment.

## Risks / Trade-offs

- [Reaching a machine now requires a Terminay Server on it, and the standalone
  server is Linux plus systemd only] → accepted for this change; recorded as a
  follow-up in the proposal. A macOS artifact and an SSH bootstrap are the
  natural next pieces once phase 2 exists.
- [Deleting the router removes the only place that proved project-relative
  path containment for remote roots] → the canonical path resolver already
  proves it for the server host and is the only path left.
- [Fifty-three references to `this-server` and eight composition sites are easy
  to half-remove] → tasks include a repository-wide grep gate for
  `projectEnvironment`, `environmentRevision`, `this-server`, and
  `EnvironmentCapability` that must return nothing outside the archive.
- [Agent extension tests assume capability subsets] → tests that exercised
  `environment-capability-missing` are deleted; the conformance harness drops
  the capability fixture.

## Migration Plan

None. Delete, bump the state version, rebuild built-ins, run the suite.
Rollback is reverting the change.

## Open Questions

- ADR-0009 must be superseded; the adr step records the replacement.
- ADR-0011's trust-boundary table names project-environment rows. It is not
  edited; the superseding ADR states which rows no longer apply.
