# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: `bot-device-login-gone-signs-out`

## In-Force ADR Context Reviewed

- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - Device sign-in keeps the login only in the bot's home, and Terminay never reads it. This change keeps that: the agent's own CLI answers whether a login is present, and only its exit status leaves the container.
- openspec/adr/0011-security-trust-boundary-model.md - The check runs in the bot's container through the server's engine driver. No client input reaches it.

## Repository-Level ADRs Created

- openspec/adr/0107-a-device-sign-in-is-checked-before-each-session.md - An agent's device sign-in may declare an offline status command. A non-zero exit before a session sets the bot to Not signed in.
