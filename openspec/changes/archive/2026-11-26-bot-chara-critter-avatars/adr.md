# ADR Review — bot-chara-critter-avatars

- **Status**: ADR review completed for this change.
- **In-force ADR context reviewed**: ADR-0005 (sandboxed origin-bound client hosts), ADR-0047 (single host bundle per window), ADR-0088 (durable state files), ADR-0093 (server-owned bot runtime), ADR-0100 (bot notifications), ADR-0138 (bot inspection allowlist).
- **Decision**: No new durable architecture decision records were introduced. Adding `@markwylde/chara` / `@markwylde/chara-react` for deterministic client-side SVG bot avatars mirrors the existing `@markwylde/pet` dependency pattern, and extending `BotProfile` with an optional `avatarStyle` field with a default on load follows the established schema-evolution pattern of `investigateFailures`, `terminayMcpAccess`, and `inspectOtherBots`.
