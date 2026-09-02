# ADR-0009: Make the selected Terminay Server the sole owner of project environment connections

Status: accepted
Date: 2026-08-12

## Context

A project's privileged work — terminals, files, Git, agents, MCP — may execute
on the server's own machine, on an ordinary SSH host, or on a VM provisioned by
an infrastructure provider. Something has to open those outward connections,
hold their credentials, and decide which machine a given operation runs on.

If clients open them, browser and Desktop parity breaks, credentials move into
untrusted presentation surfaces, and a remote Terminay Server can no longer own
a stable shared workspace. Clients also come and go; a machine binding must
outlive any particular window.

## Decision

Terminay distinguishes two independent connection layers:

1. A **Terminay Server connection** connects a Desktop or browser client to one
   selected Terminay Server.
2. A **project environment connection** is opened outward by that Terminay
   Server to the machine that executes one project's privileged work.

Desktop and browser clients are presentation and connection hosts only. They do
not open SSH connections, call infrastructure-provider APIs, install extensions,
resolve project secrets, or access project files directly. The embedded server
supervised by Desktop follows the same rule as a standalone server; its private
host bridge changes transport and native presentation, not application ownership.

The selected Terminay Server is the workspace, trust, persistence, extension, and
routing authority. It executes **This server** projects on its own machine,
connects outward for SSH projects, and lets infrastructure extensions provision
resources before handing workspace execution to another environment provider.
Puzed Platform is the first composed provider: it manages a VM through the Puzed
API, then delegates terminal and filesystem execution to the SSH extension.

```text
Desktop or browser
        |
        v
Selected Terminay Server
  |-- This server project ------> Terminay Server host
  |-- SSH project --------------> SSH host
  `-- Puzed project
       |-- management ----------> Puzed Platform API
       `-- workspace -----------> Puzed VM through SSH
```

### Authority model

Every project has one immutable opaque `projectEnvironmentId`. The environment
record lives in a separate server-owned registry; the workspace snapshot stores
only its stable reference and safe presentation and status metadata. Environment
profiles have their own revisions, provider ownership, secret references,
lifecycle, capabilities, and administration permissions.

Project-scoped commands name the canonical project and resource identities.
Terminay Server derives the environment from its workspace state and routes the
operation through the environment registry. A client-supplied environment id,
provider name, hostname, URL, IP address, path, tab label, or current focus is
never routing authority.

Terminal sessions retain their owning environment identity as canonical metadata
and the server checks that it matches their project. The familiar
`{serverId, projectId, sessionId}` command boundary remains sufficient for
clients because the environment is server-derived rather than attacker-chosen.

### Extension placement

Project-environment extensions are installed once on the selected Terminay Server
and run only there. The server-bundled UI renders fixed, bounded, declarative
extension contributions through the matching application protocol. No extension
JavaScript, React, HTML, CSS, Node API, npm process, SSH transport, or provider
credential enters Desktop or browser hosts.

Official SSH and Puzed packages use the same public extension API and runtime as
third-party packages. Terminay hardcodes their catalogue metadata and fetches
them from npmjs through the ordinary installer, but does not give their provider
implementations an internal Server Core backdoor.

## Rejected alternatives

- **Client-owned SSH/Puzed connections:** breaks browser/Desktop parity, moves
  credentials into clients, and makes a remote Terminay Server unable to own a
  stable shared workspace.
- **One Terminay Server per SSH/Puzed VM:** requires installing Terminay on every
  target and prevents simple connection to ordinary SSH hosts.
- **One machine authority per window:** prevents the requested mixed project tab
  model and duplicates workspace presentation.
- **Puzed-specific terminal/filesystem runtime:** duplicates SSH and embeds an
  infrastructure vendor in core project services.
- **Arbitrary renderer extensions:** breaks the verified server-bundle and
  protocol-blind host boundary established by
  [ADR-0008](./0008-server-bundled-clients-and-protocol-blind-hosts.md) and
  exposes clients to extension code.

## Consequences

- One workspace view may contain This server, SSH, and Puzed projects.
- **Local** means local to the selected Terminay Server, which may itself be
  remote from the client. User-facing environment selection calls it **This
  server** and names the selected server in supporting text.
- Moving a project between workspace views preserves its environment.
- A project cannot be retargeted by editing it. Changing machine authority is a
  future migration or import workflow that creates or validates a new project.
- A panel cannot move between unequal environment identities. Same-environment
  terminal movement is allowed only after terminal identity and every dependent
  service can be rebound atomically; until then it remains disabled.
- Missing extensions, stopped machines, revoked credentials, unreachable targets,
  and provider crashes leave projects represented as unavailable. They never fall
  back to This server or another profile.
- Terminal and filesystem are the minimum useful project-environment
  capabilities. Git, file observation, current-cwd and foreground-process
  observation, agent journals, remote MCP, and infrastructure lifecycle are
  independently advertised and may be unavailable.
- Puzed-specific concepts do not enter workspace, terminal, or filesystem core.
  Puzed produces and maintains a composed SSH-backed environment binding.

### Security statement

An arbitrary npm extension is trusted server-side code running with the effective
operating-system authority of Terminay Server. A dedicated child process provides
crash isolation, lifecycle control, bounded IPC, and secret compartmentalization
between well-behaved extensions; it is not a hostile-code sandbox. Permission
declarations govern broker access, consent, and audit but cannot prevent
arbitrary same-user Node code from reading accessible files or using the network.
Installation UI must state this plainly and identify the selected server before
confirmation.

## Open items

Proof gates for this decision:

- Desktop and browser clients connected to the same Terminay Server observe the
  same installed extensions, profiles, project environments, and status.
- One remote Terminay Server simultaneously runs a This server project and
  outbound SSH/Puzed projects without client involvement.
- Forged environment ids, identical path strings, labels, or focus cannot move an
  operation to another machine.
- Cross-environment panel movement fails atomically without changing the live
  session or either project.
- Missing or crashed extensions and unreachable targets preserve project state
  and never execute a local fallback.
- Only a Puzed VM's public SSH key enters the Puzed API; its private key remains
  in the Terminay Server vault (see
  [ADR-0003](./0003-vault-interface-and-key-protectors.md)) and is resolved only
  by the SSH provider.
