## Context

`BotSessionStore.append` (`packages/server-core/src/botService/sessions.ts`)
stores each update exactly as given: the normalized session updates that
Terminay's own native CLI drivers emit through `BotNativeClient` (ADR-0096;
text is buffered through redaction before it is emitted), and the server's own `{ kind: 'user' }`,
`{ kind: 'permission-request' }` and `{ kind: 'truncated' }` records. Updates are
buffered, then written as `segment-N.json` files. `foldTranscript`
(`packages/protocol/src/botTranscript.ts`) folds them into `TranscriptItem`s;
`BotSessionsPanel` renders them with `BotTranscript`. Nothing in the stored
updates says when they arrived, so the view has no time to show.

Chat already shows message times through `MessageHead` and `messageTime()` in
`BotTranscript.tsx`, fed by a `messageTimes` map from the message log. The
Sessions view does not pass that map.

## Goals / Non-Goals

**Goals:**

- Record a server-clock receive time with every stored transcript update.
- Show a small time, styled like chat message times, on each displayed
  Sessions transcript entry (prompt, messages, thoughts, tool calls and groups,
  plan, truncation notice), with the full date and time on hover. Permission
  records get a time but are not displayed as entries.
- Render sessions stored without times exactly as today, minus the times.

**Non-Goals:**

- Times in runner output. It is a capped text tail with no entry structure;
  adding per-chunk times would change its stored shape and its byte cap.
- Durations or end times per entry. Only the start time is shown.
- Changing Chat, whose times come from the message log.
- Backfilling times into existing sessions.

## Decisions

### Stamp a `receivedAt` field onto each stored object update

`append` sets `receivedAt: this.now()` (epoch milliseconds) on every update that
is a plain JSON object, including the truncation marker it generates itself, after cloning it and before measuring its bytes. A
non-object update is stored unchanged. The server's value always wins over a
`receivedAt` the agent sent.

Alternatives considered:

- *Wrap each update* (`{ at, update }`): cleaner separation, but every stored
  transcript becomes two shapes that `foldTranscript`, transcript search and
  message import must tell apart. Rejected for its blast radius.
- *Stamp in `BotNativeClient` when the event is parsed*: closer to production
  time, but misses the server's own records and every future producer.
  Rejected; one choke point in `append` covers all of them.
- *A parallel array of times*: survives no reordering or truncation without a
  second file format. Rejected.

`receivedAt` is the time the update was admitted to transcript storage, not
the moment the CLI produced it: redaction buffering can delay a text chunk
briefly, which is immaterial at minute resolution. `receivedAt` is an unambiguous name that no driver defines on session
updates. Bytes are measured after stamping, so the 8 MiB cap stays exact.

Boundary: the agent runs in the bot container and is untrusted. Overwriting its
field keeps the recorded time server-authoritative (spec scenario "The agent
cannot set an entry's time").

### Fold the start time into each `TranscriptItem`

Every `TranscriptItem` variant gains an optional `at?: number`.
`foldTranscript` sets it from the `receivedAt` of the update that creates the
entry: the first chunk of an agent or thought run, the first update of a tool
call, the first plan update, and the user, permission and truncation records.
Later chunks and updates leave it alone.

A time is valid only when it is an integer number of milliseconds that
`new Date()` can represent (`Number.isSafeInteger(t) && Math.abs(t) <= 8.64e15`);
anything else (strings, null, NaN, Infinity, `1e20`) is treated as absent, so
rendering never calls `toISOString()` on an invalid date. One exported helper,
`transcriptTime(value)`, applies this rule in folding and rendering.

A `transcript-item` record (used by the UI harness) takes the enclosing
update's `receivedAt` when it has a valid one; only when it has none does the
inner `item.at` apply. Server metadata therefore always wins.

### Render times only in the Sessions view

`BotTranscript` already separates Chat (`messageTimes` given) from the Sessions
view. In the Sessions view:

- the user prompt's `MessageHead` takes `item.at`;
- the agent turn's `MessageHead` takes the time of its first part;
- each later agent message and each thought shows its own time;
- each tool entry and each tool group head shows its time at the end of the
  head row, right-aligned and faint;
- the plan card shows its time after "Plan · n of m", and the truncation
  notice shows its time after its text.

All of them use one `EntryTime` element built from the existing
`messageTime()` and the existing `bots-msg__time` styling: a `<time>` with
`dateTime` set to the ISO string and a `title` with the full date and time
(`dateStyle: 'full', timeStyle: 'medium'`). Chat keeps its current behaviour.

## Risks / Trade-offs

- [About 25 extra bytes per update reach the 8 MiB cap slightly sooner] →
  Negligible against typical update sizes; the cap and truncation marker
  already handle the limit.
- [Transcript text search runs over stored JSON, so a short numeric search
  would match nearly every stamped session through its 13-digit `receivedAt`
  values] → `BotSessionStore.list` serialises updates for search with the
  top-level `receivedAt` removed from each update only. A nested field of the
  same name inside a tool's input or output stays searchable.
- [Times reflect when the server received an update, not when the agent
  produced it] → That is the only trustworthy clock; container and server clocks
  are the same host in practice.

## Migration Plan

No migration. Sessions stored before the change fold with `at` undefined and
show no times. Rolling back leaves `receivedAt` in stored JSON, which older
folding ignores.

## Open Questions

None.
