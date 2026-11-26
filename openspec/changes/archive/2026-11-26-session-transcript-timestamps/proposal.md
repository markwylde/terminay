## Why

A bot session's transcript in the Sessions tab (Bots > bot > Configure >
Sessions) shows the user's prompt, the bot's messages, thinking, and tool calls,
but never when any of them happened. When a user investigates a slow or stuck
session they cannot tell where the time went, which tool ran for minutes, or
how long the bot paused between steps (issue #668).

Technically, the server stores each agent update exactly as the agent sent it,
so the stored transcript carries no per-entry time to show.

## What Changes

- The server stamps every update it stores in a session transcript with the
  time it received it, including its own records (the user prompt, permission
  requests and the truncation marker).
- Folding a transcript gives each entry the time it started: a user prompt and
  a permission request at their record, an agent message or a thought at its
  first chunk, a tool call at its first update, the plan at its first update,
  and the truncation marker at its record.
- The Sessions transcript shows a small, unobtrusive time on each entry: the
  user prompt, each bot message, each thought, each tool call, each run of
  tool calls ("Used N tools"), the plan, and the truncation notice. Permission
  requests are recorded with a time but are not shown as entries. It uses the same format the chat already uses
  for message times (clock time today, then day or date), and shows the full
  date and time, with seconds, on hover.
- Entries from sessions recorded before this change have no stored time and
  show none; the rest of the transcript renders as before.
- Runner output is a single capped text tail, not a list of entries, so it
  gets no per-entry times.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: the Sessions requirement records when each transcript
  update arrived and shows a time on each transcript entry.

## Impact

- `packages/server-core/src/botService/sessions.ts`: stamp stored updates.
- `packages/protocol/src/botTranscript.ts`: `TranscriptItem` gains an optional
  start time; `foldTranscript` fills it.
- `src/workspace/bots/BotTranscript.tsx` and `botPanels.css`: render entry
  times in the session view.
- Transcript text search ignores the stamp.
- Transcript storage grows by about 25 bytes per update, counted against the
  existing 8 MiB cap. The stored time is the server's admission time; times
  inside update content are never trusted.
- No protocol method, permission, or client authority changes.
