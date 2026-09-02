## Context

See proposal.md. Two routes claimed the same name: an exact host rule for the
static manager image and a wildcard rule for the hosted signaling and session
application. The wildcard cannot simply be removed, because every session
subdomain depends on it and it owns PostgreSQL state.

## Goals / Non-Goals

Goals:
- One canonical manager origin, served by the static manager image.
- Hosted `*.terminay.com` signaling and session traffic continues uninterrupted.
- No user-visible data is lost by the cutover.

Non-Goals:
- Deleting the wildcard runtime or its database.
- Changing device authentication or credential storage at session origins.

## Decisions

- **The exact host rule must win over the wildcard rule.** Exact
  `app.terminay.com` routes to the static image, and that exact rule is removed
  from the hosted application so the two cannot both claim it. `*.terminay.com`
  stays on the hosted application.
- **The image itself also matches on exact Host.** Serving the manager document
  only for the canonical Host, with unknown Hosts failing closed, means a
  routing mistake produces a refusal rather than the manager appearing at an
  unintended name.
- **The cutover is same-origin for stored data.** Existing non-secret manager
  profiles at `app.terminay.com` remain readable because the origin does not
  change. Session-origin keys, reconnect grants, and server device state are
  untouched, since neither manager origin owns them.
- **`web.terminay.com` is retired to a bounded role only** — a redirect or the
  metadata migration — rather than being left as a second evolving manager.

## Risks / Trade-offs

- Removing the exact rule from the hosted application is the moment of cutover:
  if the static route is misconfigured, the canonical name serves nothing rather
  than serving the old application. Fail-closed behaviour is preferred here to a
  silent fallback onto the obsolete root.
