## Context

See proposal.md. This change supplies the domain, storage, discovery, and protocol needed by a
later single canonical terminal launch boundary; it deliberately stops short of switching any
production PTY route.

## Goals / Non-Goals

Goals: a tested, revisioned, migratable server-owned shell-profile catalogue and project-default
reference model, with platform discovery kept separate from durable settings.

Non-Goals: replacing the existing terminal launch path. That is the following task's single
launch boundary.

## Decisions

- **Discovery is a server capability, not host code.** Each server discovers its own candidates,
  so two servers with different shells return independent catalogues and a client cannot persist
  a profile or project default outside its connected server. Discovered candidates stay separate
  from durable settings, and host paths are canonicalized and deduplicated.
- **Discovered profiles are not durable identities.** A discovered profile may be used for a
  one-off launch from the current catalogue, but a server or project default must reference
  System default or a durable custom profile. Copying discovery data creates the durable identity
  explicitly, so a change in availability cannot silently delete a custom profile or change a
  selected default.
- **Arguments are arrays, not a parsed string.** Validation preserves argument boundaries and
  rejects command strings. Environment overlays support explicit `null` removal, and protected
  environment names and secret-like fields are rejected.
- **Bounds are explicit.** 16 KiB per profile and 32 KiB aggregate encoded budgets, with
  over-limit collections rejected.
- **Environment values are never disclosed or logged.** Catalogue and settings summaries are
  environment-redacted; one bounded profile detail is exposed only to write-authorized clients;
  audit and diagnostic records for discovery, validation, migration, and mutation are
  metadata-only.
- **Referential integrity is enforced, not cascaded.** Deleting a referenced profile fails and
  reports every blocking server or project reference. After those are independently reassigned
  through their own revisioned authorities, deletion rechecks and succeeds with no dangling
  reference. Renaming or reordering preserves profile identity.
- **The profile subtree is reserved.** Generic settings mutation cannot write it, and generic
  workspace mutation cannot write profile-default project commands, so dedicated validation and
  referential checks cannot be bypassed.

## Risks / Trade-offs

Legacy values that cannot be migrated safely become an explicit unavailable state requiring
review rather than being dropped or guessed. Migration is idempotent with deterministic migrated
ids, safe one-time argument parsing, a repository backup, and retry behaviour after interruption.

## Migration Plan

Migrate `shell.program`, `shell.startupMode`, and `shell.extraArgs` once, deterministically.
Fixtures cover default legacy settings, explicit programs, System default plus legacy arguments,
quoted and escaped arguments, invalid legacy values, retry after interruption, and reset.
