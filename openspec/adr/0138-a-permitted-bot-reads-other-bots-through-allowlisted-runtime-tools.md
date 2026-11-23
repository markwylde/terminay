# ADR-0138: A permitted bot reads other bots through allowlisted runtime tools

Status: accepted, supersedes ADR-0100 in part and ADR-0093 in part
Date: 2026-11-23
Supersedes: ADR-0100 (decision 4, only so far as a permitted bot's own runtime tools can read another bot under this decision; no capability can create, change or prompt a bot, and Terminay MCP capabilities still cannot read one). ADR-0093 (the bot scoping of runtime tools, only for this read path; every other decision continues)

## Context

A bot's runtime tools are restricted to that bot, and ADR-0100 says no capability can read a bot. Users need a bot to look at another bot's failure or conversation without pasting it (issue #644). This opens a boundary between bots, and another bot's records hold material that must not cross it: sign-in, instructions, trigger commands, URLs, header references and links into projects and terminals.

## Decision

1. **Access is a per-bot profile setting, off by default.** Only an authenticated user's bot save can change it. No MCP tool, including a bot's own runtime or Terminay MCP tools, can change it.
2. **The setting is read from the current record on every call.** Without it, a tool returns `forbidden` before any target lookup. A change applies to running executions at once, in both directions.
3. **The path is strictly read-only.** It covers config, executions, ended runner output, messages and triggers. It never reaches files, memories, inboxes, events, shells or desktops, and it records nothing.
4. **Responses are field-by-field allowlists.** A stored record is never spread into a response, so a new field is withheld until someone deliberately adds it. Secret-bearing structured fields are never returned.
5. **Free text is content, redacted before any cut.** Message text, trigger prompts, reasons and output are returned with the source bot's known credentials redacted, before any excerpt or slice is taken. Redaction failure fails the call. Text a person or agent typed can still hold other sensitive values, which is why access is opt-in.
6. **Other bots' content is marked as untrusted data** in tool descriptions and in every result.
7. **The path stays on one server.** Unknown, deleted and mismatched targets return `not_found`.

## Rejected alternatives

- **Reuse the own-bot views.** They include trigger conditions, and profiles include instructions and sign-in.
- **A denylist of secret fields.** A new secret field would leak by default.
- **Snapshot the permission at execution start.** Revocation would wait for the execution to end.
- **Expose inspection through Terminay MCP.** Terminay MCP callers are refused for every bot operation, and that boundary stays.

## Consequences

- A permitted bot can diagnose other bots on its server without the user pasting content.
- Instructions and trigger commands stay unavailable to other bots, which limits some diagnosis.
- Each new field exposed to inspection needs an explicit allowlist entry and a secrecy review.
- Readers must treat results as data. The marker informs the model but cannot enforce this, so the tools themselves grant no way to act on another bot.
