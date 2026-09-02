## Context

See proposal.md. This change is the user-facing completion of the shell profile
domain and discovery work and the canonical terminal launch resolution work; it
adds no new launch semantics of its own beyond the one-off profile choice.

## Goals / Non-Goals

Goals:
- A default-first experience: a new user leaves **System default** selected and
  reliably gets the account shell without opening the advanced editor.
- Make server ownership of profiles legible, including that a profile executes
  a program on the connected server.
- Keep every failure state actionable and non-destructive to user input.

Non-Goals:
- Changing terminal launch resolution itself.
- Retiring the legacy migration reader within this change; that is deferred to
  a later schema cleanup after the supported migration window has passed.

## Decisions

- **Discovered entries are runtime-only.** Discovered shells never enter durable
  default selectors. The catalogue offers **Use once** and **Copy to custom
  profile** instead, so a durable default always references a durable profile.
- **Deletion is reference-guarded.** A referenced profile cannot be deleted; the
  user is directed to each server or project default that must be reassigned
  first. Unavailable custom profiles are preserved for repair rather than
  removed.
- **Redaction in the catalogue.** The surface shows connected server identity,
  profile source, availability, server default, and project-use references
  without exposing environment values.
- **Settings affect only future terminals.** Existing tabs retain their resolved
  session metadata, so renaming, editing, or re-defaulting a profile does not
  repaint an existing terminal as another profile or change its label, process,
  working directory, recording metadata, or session identity.
- **One-time choice is explicit.** **New Terminal with Profile…** makes a
  one-time profile-id choice; ordinary new and split actions continue to use
  canonical defaults, and all actions display bounded launch errors inline.
- **Parity across hosts.** Native settings windows and in-page browser settings
  implement the same catalogue, editor, validation, and keyboard behaviour.

## Risks / Trade-offs

- Removing the raw fields breaks any workflow that edited them directly; the
  bounded migration reader covers the supported window and user-facing help and
  release notes were updated.
- The catalogue adds surface area to Settings; the mitigation is grouping,
  searchable labels, and keeping advanced executable and environment controls
  in a separate area.

## Migration Plan

Legacy shell fields are removed from production configuration paths. A bounded
reader continues to migrate previously stored legacy settings for the supported
migration window only, and is retired in a later schema cleanup.
