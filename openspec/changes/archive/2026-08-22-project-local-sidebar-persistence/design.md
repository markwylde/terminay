## Context

See proposal.md. Sidebar presentation had previously been treated as renderer
state seeded from Settings, which is why it neither survived a reload nor stayed
project-local.

## Goals / Non-Goals

Goals:
- A project's sidebar returns exactly as it was after a restart or reconnect.
- Changing one project's sidebar leaves every other project untouched.
- Legacy snapshots gain valid sidebar state without losing anything else.

Non-Goals:
- Changing sidebar geometry, resize behaviour, or accessibility.
- Changing what the Settings sidebar page offers, beyond redefining its values
  as defaults for new projects.

## Decisions

- **Sidebar state belongs to the canonical project record.** It is added to the
  workspace project schema as a bounded, validated model, so it participates in
  the existing snapshot, revision, delta, and convergence machinery rather than
  needing a parallel store. Every authorized client therefore converges on the
  same sidebar without extra plumbing.
- **One authenticated project-scoped patch command.** Sidebar changes go through
  a workspace command scoped to a project, which publishes the normal workspace
  change event. This keeps the project/window and terminal-session security
  boundaries: a client cannot patch a project it is not authorized for, and a
  cross-project command is rejected.
- **Invalid patches do not advance the revision.** Validation happens before
  commit, so a rejected sidebar patch leaves the workspace revision unchanged and
  cannot be used to force convergence churn on other clients.
- **Settings values become new-project defaults only.** Reading Settings to seed
  a new project keeps the settings page meaningful without making it a shared
  mutable store that any project interaction would rewrite.
- **The migration is a one-time v4 workspace migration, durably committed on the
  first renderer reload.** The packaged-app smoke contract had to keep passing
  across that commit, so the migration was written to be idempotent and to leave
  project identity, environment binding, panels, and layout untouched.

## Risks / Trade-offs

- Persisting presentation state in canonical workspace state increases snapshot
  size and adds another migration step. Accepted: the alternative — device-local
  storage — cannot give a second client or a reconnect the same sidebar.
- Committing a migration during a renderer reload is a sensitive moment for the
  packaged application; it was covered explicitly by the packaged macOS smoke.

## Migration Plan

Existing workspace snapshots are migrated to project-local sidebar defaults by a
one-time v4 migration that is durably committed on the first renderer reload.
Project identity, environment binding, panels, and layout are unchanged.
