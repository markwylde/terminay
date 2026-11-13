## Context

The server already reports each chat provider's availability, with a reason
of `not_installed`, `not_signed_in`, `unsupported_platform`, or `disabled`.
Pixel's client fetched that list only while its provider was unset, so once a
provider was chosen it had no way to know the agent was missing until a
message failed. The `@markwylde/pet` balloon renders plain text and supports
buttons on a message, which emit `chat:action`.

## Goals / Non-Goals

- Goal: a user whose chosen agent is missing sees why, and one click reaches
  the official install guide.
- Goal: installing the agent while Terminay runs is enough.
- Non-goal: installing an agent for the user, or links for other agents.

## Decisions

- **The client decides, from the provider list it already has.** Pixel asks
  for the providers whenever Pixel is on and each time the balloon opens, not
  only during onboarding. No new server operation or protocol field.
- **Install guides are a renderer map keyed by provider id.** Pixel already
  names Claude Code and Codex in its own copy, and only these two can be its
  provider. Adding a guide URL to the extension API would be a protocol change
  for two links.
- **The help is a local balloon message with buttons.** It is appended after
  the server's conversation, like the existing connection-problem line, so it
  is never stored on the server. A button opens the guide with
  `openExternalUrl`, which opens it in the system browser on Desktop and in a
  new tab elsewhere.
- **The locator forgets misses.** A miss is cheap to repeat: the login-shell
  PATH is still read once per activation, and the server caches availability
  for a short TTL, so the filesystem is checked at most that often.

## Risks / Trade-offs

- [Install guide URLs move] → They are in one map and in the extension's
  detail strings; a moved page still redirects in the meantime.

## Migration Plan

None.
