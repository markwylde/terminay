## 1. Input queue

- [x] 1.1 Add tests to `scripts/terminal-panel-input-queue.test.mjs` for a handoff with writes the test settles: queued and newly typed input reaches the replacement once and in order; a refused in-flight write is resent once; an unknown-outcome one is not; a read-only replacement discards and refuses; a paste resumes from its first unsent chunk. Verified by them failing before the change.
- [x] 1.2 Give `ServerTerminalInputQueue` `handoff()`, `setPresentationRole()`, and the settle rules for a write in flight on a replaced attachment. Verified by 1.1 and the existing cases passing under `npm run test:terminal-panel-context`.

## 2. Terminal panel

- [x] 2.1 Keep one queue per mounted panel in `src/components/TerminalPanel.tsx`; hand it off on re-attach, recovery, and rebind; apply each presentation to it; stop gating input on the renderer's controller flag. Verified by `npx tsc -p tsconfig.json --noEmit` and `npm run lint` exiting zero.

## 3. End to end

- [x] 3.1 Add the `TERMINAY_TEST`-only seam `electron/testTerminalHandoff.ts` and `e2e/terminal-input-handoff.spec.ts`, which holds the first key's write, ends the stream as congested, and types through the recovery. Verified by the spec failing before 2.1 (the PTY receives `e-ok`) and passing after it under `npm run test:e2e -- e2e/terminal-input-handoff.spec.ts`.
- [x] 3.2 Remove `runShellCommand`'s retype loop from `e2e/support/terminal-input.ts`. Verified by `e2e/terminal.spec.ts`, `e2e/project-tabs.spec.ts`, `e2e/terminal-signals.spec.ts`, `e2e/program-set-tab-titles.spec.ts`, and `e2e/linked-folders.spec.ts` passing under `npm run test:e2e`.

## 4. Specs

- [x] 4.1 Run `openspec validate terminal-input-survives-attachment-handoff --strict`. Verified by it exiting zero.
