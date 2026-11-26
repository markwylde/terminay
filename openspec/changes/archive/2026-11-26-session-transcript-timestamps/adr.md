# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-26
- Reviewer: Claude
- Change: session-transcript-timestamps

## In-Force ADR Context Reviewed

- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - supersedes ADR-0089's ACP client; Terminay's native drivers emit the normalized session updates the server stores.
- openspec/adr/0011-security-trust-boundary-model.md - the server is authoritative over data it records; agent-supplied values are untrusted.

## Repository-Level ADRs Created

- openspec/adr/0143-stored-bot-transcript-updates-carry-the-server-receive-time.md - the server stamps each stored transcript update with its own receive time in `receivedAt`, overwriting any agent value.

## Notes

ADR-0143 is new in this change and has not landed on main; it was revised before merge after proposal review.
