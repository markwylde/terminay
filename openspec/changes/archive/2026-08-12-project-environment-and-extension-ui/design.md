## Context

See proposal.md. This was Phase 2 of the project-environment programme. It was
built first against the Phase 1 protocol fixtures from the environment domain and
extension manifest work, in parallel with the environment-routed project services,
extension installation and management, and the official Puzed extension
foundation, then integrated against those live services.

## Goals / Non-Goals

Goals: one generic UX that works against fixtures and production managers in both
client hosts, and a form renderer driven entirely by bounded server-supplied
schemas.

Non-Goals: provider-specific UI code, environment retargeting of an existing
project, and any feature logic inside the Electron or browser shells.

## Decisions

- Render every provider form from a bounded declarative schema rather than
  hand-writing a form per provider. A provider ships with an extension, so a
  per-provider form would put extension-supplied code or markup in the client.
- Extensions and environments are never rendered as extension-authored HTML or
  code. Contributions are declarative only, and secrets never appear in a form's
  rendered value.
- The project split button has a primary action and an arrow menu: the primary
  `+` creates a project on This server, and the arrow creates or selects an SSH or
  Puzed environment and reaches environment and extension management. Recent
  targets are grouped so the common case stays one click.
- Environment and root are validated together and atomically before the project
  commits, so a project is never created with a root its environment rejects.
- The environment shown on a tab and in the project editor is presentational and
  read-only; retargeting an existing project is out of contract.
- Desktop native auxiliary routes and browser in-page routes share the same
  semantic commands and the same server-owned state, so neither host holds its own
  copy of the management model.

## Risks / Trade-offs

A generic schema renderer is less expressive than bespoke forms, so a provider
with unusual needs must express them through the declared field, disclosure,
preset, and conditional vocabulary. That constraint is deliberate: it keeps
provider code off the client.

## Migration Plan

Built against Phase 1 fixtures first so that the UI and the live services could
land independently, then switched over to the live environment and extension
managers once those services existed.
