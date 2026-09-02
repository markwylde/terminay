## Context

See proposal.md. Each additional client has a different user-level configuration
shape: Cursor CLI reuses the `mcpServers` map in a JSON file, Gemini CLI keeps
`mcpServers` inside a larger settings document with its own trust and allow/exclude
policy, and OpenCode uses an `mcp` map of local servers with a command array and
may store its user configuration under more than one supported filename.

## Goals / Non-Goals

Goals: register Terminay in each client's supported user-wide scope, leave every
unrelated setting untouched, and keep each provider's status and actions
independent of the others.

Non-Goals: project-scoped registration, editing a client's trust or permission
policy, or normalising the five clients onto one configuration format.

## Decisions

- One versioned adapter per provider rather than shared parsing. The clients'
  formats move independently, so a shared parser would couple their breakages.
- Never set Gemini's `trust`, and never alter its allow or exclude policy.
  Registration adds a server; it does not grant it authority.
- Never write an OpenCode permission override, and express the server as a single
  command array.
- Where OpenCode presents more than one supported `.json`/`.jsonc` candidate with
  no unambiguous precedence, report the registration unavailable for review rather
  than picking one or creating a competing file. The same applies to a dialect that
  cannot be round-tripped safely.
- Install and uninstall are idempotent and refuse to overwrite or delete a
  `terminay` entry that differs from the one Terminay wrote. A changed entry is a
  user decision, and silently reclaiming it would be a data loss.
- All writes are atomic so an interrupted registration cannot truncate a user's
  agent configuration.

## Risks / Trade-offs

Reporting ambiguity as unavailable is more conservative than guessing, and leaves
some users with a manual step. That is preferred to rewriting a configuration file
Terminay does not fully understand.
