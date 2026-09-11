# ADR-0017: There is one kind of remote, a Terminay Server, and every project executes on the server that owns it

Status: accepted, supersedes ADR-0009
Date: 2026-09-09
Supersedes: ADR-0009

## Context

ADR-0009 gave Terminay two connection layers: a client connects to a Terminay
Server, and that server connects outward to a "project environment" on an SSH
host or a Puzed VM. Every feature learned to ask which layer it was in. Files,
Git, terminals, shell discovery, agent observation, macros, dictation, MCP,
diagnostics, and the sidebar each carried an environment id, an environment
revision, a capability subset, and a "limited on this environment" branch. A
router sat at the privileged dispatch boundary to forward operations to the
right machine and to fail closed when it could not.

The product already had a second, complete remote model that works from
Desktop and browser alike: connect to a Terminay Server anywhere. The two
models were kept apart so that clients would hold no credentials. That reason
survives without the second layer, because a server connection's credentials
already live in the host shell and never in the workspace UI.

Two things changed the balance. First, the product has no installed users, so
ADR-0009's strongest rejected alternative, "one Terminay Server per machine
requires installing Terminay on every target", is a deployment cost rather
than a migration. Second, language intelligence has to run where a project's
files, configuration, and dependencies live. A project environment is by
definition not where the Terminay Server runs, so an environment-backed
project could never get the same language features as a local one.

## Decision

1. **One kind of remote.** Reaching another machine means running a Terminay
   Server on it and connecting to it. There is no project environment, no
   environment registry, no environment provider extension, and no outbound
   connection from one server to another machine.
2. **A project has a root on its server, and that decides where it executes.**
   Projects and terminal sessions carry no environment identity or revision.
   Terminals, files, Git, shell discovery, observation, MCP, recordings, and
   agents execute against the server host through the canonical project
   resolver. Nothing at the dispatch boundary chooses a machine.
3. **The extension platform keeps its host and loses its provider kind.** The
   child-process host, broker, crash isolation, catalogue, installer, and
   built-in materialisation stay. Project-environment provider contributions,
   environment capabilities, dependency operations between providers, and the
   declarative provider forms and status cards are gone. Agent providers keep
   the observation broker, and every observation capability is always present.
4. **Panels move freely between projects of one server.** The only boundary a
   panel cannot cross is a server, and that boundary is a connection, not a
   project property.

```text
Desktop or browser
   |-- Local Terminay Server -------> its own projects
   |-- Terminay Server on VPS ------> its own projects
   `-- Terminay Server on build box -> its own projects
```

## Rejected alternatives

- **Keep a single hardcoded "this server" environment so record shapes do not
  change.** Keeps every consumer branch and the router alive for one value.
- **Keep SSH as a provider and drop Puzed.** Keeps the whole layer for one
  provider and still cannot host language servers next to the files.
- **Have a Terminay Server bootstrap another Terminay Server over SSH as an
  environment provider.** That is a server connection with extra steps; if it
  is ever wanted it is an installer, not a routing layer.

## Consequences

- Roughly ten thousand lines, three specs, and two built-in extensions are
  deleted, along with the class of bug where an unmapped operation falls
  through to the wrong machine.
- Reaching a machine now requires a Terminay Server on it. The standalone
  server is Linux plus systemd only at the time of this decision; a macOS
  artifact and an easier headless install become product work rather than
  operator detail.
- A future SSH bootstrap ("install a Terminay Server on this host and connect
  to it") and a Puzed image that ships a Terminay Server are natural
  follow-ups. Both produce server connections.
- ADR-0011's trust-boundary rows "project → environment adapter" and "Server →
  SSH/Puzed endpoints" no longer describe a boundary that exists, and the
  "extension/environment management" row applies to extension management
  only. ADR-0011 is not edited; this record states which rows are retired.
- Every remote is the same shape, which is what lets one window attach several
  servers and lets a language server run beside the files.
