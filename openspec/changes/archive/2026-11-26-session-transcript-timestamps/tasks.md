## 1. Record receive times on the server

- [x] 1.1 In `BotSessionStore.append`, set top-level `receivedAt` from the store clock on every plain-object update (agent updates, `user`, `permission-request`, and the generated `truncated` marker), overwriting an existing value, before measuring bytes; leave non-object updates unchanged. Verified by new cases in `packages/server-core/test/bot-session-store.test.mjs`: stored updates and committed segment files carry the clock time; an agent-supplied `receivedAt` is overwritten; the truncation marker is stamped and the transcript stays within 8 MiB; reopening the store keeps the original times without restamping.
- [x] 1.2 Make `BotSessionStore.list` text search ignore only each update's top-level `receivedAt`. Verified by a test that a search for a string found only in a stamp matches no session, while transcript text and a nested `rawInput.receivedAt` value still match.

## 2. Fold entry times

- [x] 2.1 Add an exported `transcriptTime(value)` helper in `packages/protocol/src/botTranscript.ts` that returns a safe integer within the Date range, else undefined. Verified by tests for strings, null, NaN, Infinity, `1e20` and a valid time.
- [x] 2.2 Add optional `at?: number` to every `TranscriptItem` variant and set it in `foldTranscript` from the starting update's `receivedAt` (first agent or thought chunk, first tool update, first plan update, user, permission and truncation records). For `transcript-item` records, the enclosing `receivedAt` wins and `item.at` applies only without one. Verified by a new `packages/protocol/test/bot-transcript.test.mjs`: each entry kind, a streamed message keeping its first chunk's time, two messages and a thought in one turn keeping separate times, a tool and a replaced plan keeping their first update's time, the `transcript-item` precedence, and updates without `receivedAt` folding to no `at`.

## 3. Show times in the Sessions transcript

- [x] 3.1 Add an `EntryTime` element in `src/workspace/bots/BotTranscript.tsx` built on `messageTime()` and `transcriptTime()`, rendering `<time>` with ISO `dateTime` and a full date-and-time `title` with seconds, and nothing for an absent or invalid time; make `MessageHead` use it. Verified by `npx tsc --noEmit -p .` (or the repo typecheck script) and the e2e in 4.1.
- [x] 3.2 In the Sessions view (no `messageTimes`), pass the user prompt's `at` and the agent turn's first-part `at` to `MessageHead`; show `EntryTime` on each later agent message and each thought, at the end of each tool entry head, at the end of each tool group head (first tool's time), on the plan card label, and on the truncation notice. Chat rendering stays unchanged. Verified by the e2e in 4.1.
- [x] 3.3 Style the new times in `src/workspace/bots/botPanels.css` as small, faint, right-aligned text consistent with `bots-msg__time`. Verified by the screenshots in 4.2.

## 4. End-to-end coverage

- [x] 4.1 Extend `e2e/bots.spec.ts` so a real session's transcript (stored and folded by the server) shows a time with a full date-and-time `title` on the prompt, the reply, and tool entries, and extend the bots UI harness to cover a tool group, an expanded tool call, a plan, and an entry without a time. Assert Chat still shows its message-log times. Verified by `npm run test:e2e` passing for that spec.
- [x] 4.2 Capture screenshots of the Sessions transcript with times (collapsed group and expanded tool call) into the scratchpad `screenshots/` folder. Verified by the files existing and showing the times.

## 5. Checks

- [x] 5.1 Build with `npx turbo run build --filter=@terminay/server-core...`, run the protocol and server-core `npm test`, the repo typecheck, and `npm run lint`. Verified by all passing.
- [x] 5.2 Run `openspec validate --all`. Verified by no errors for this change.
