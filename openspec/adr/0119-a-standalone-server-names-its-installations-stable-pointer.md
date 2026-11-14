# ADR-0119: A standalone server names its installation's stable pointer, never a release directory, in anything that outlives it

Status: accepted
Date: 2026-11-14

## Context

ADR-0016 ships the standalone server as self-contained archives, and the
installer keeps each release in an immutable `versions/<release>` directory
behind a `current` link swapped by rename, keeping only the current and
previous release. The server derived the paths it registers with agent CLIs
from `process.execPath` and its own module URL, which resolve through the link
to the release directory. Every agent's Terminay MCP registration therefore
named one release, showed as changed after the next upgrade, and failed with
ENOENT once that release was pruned.

## Decision

1. When a standalone server writes a path into anything that outlives its own
   process — agent CLI configuration first among them — and it runs from
   `<prefix>/versions/<release>/` with `<prefix>/current` resolving to that
   release, it names the path through `<prefix>/current`.
2. The decision is made from the filesystem at startup, not from the install
   record, so system, user and container trees behave the same and a server
   outside an installation (Desktop, a development checkout) is unaffected.
3. Terminay never rewrites agent configuration on its own to repair an older
   entry. A changed entry is replaced only by an explicit user action.

## Consequences

- Registrations survive every upgrade, rollback and prune without user action.
- An agent that starts the MCP adapter during the moment between the link swap
  and the server restart talks to the old server with the new adapter; the
  versioned control protocol reports the mismatch and the next start works.
- Registrations written before this decision still name a release directory.
  Users repair each once with Replace.
