## Context

Tokens live in the server vault per bot and variable. Device logins live only
in a bot's home volume, and ADR-0091 keeps them there.

## Goals / Non-Goals

**Goals:** offer only copies that can succeed, and explain a copy that cannot.

**Non-Goals:** copying or sharing a device login.

## Decisions

- **The server computes the sources.** `options` already reads vault metadata,
  so it returns `copySources` from entry IDs without resolving any secret. The
  alternative, one `options` query per other bot from the client, adds requests
  and spreads the rule into the renderer.
- **The copy command still checks the source.** The list can be stale, so the
  server refuses a missing source with a validation error.

## Risks / Trade-offs

- A change made from another client appears when the section next loads. A
  stale entry gets the clear refusal.
