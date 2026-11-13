## 1. Handler

- [x] 1.1 Add `src/components/terminalOsc52.ts`: parse OSC 52 data, write form only; ignore queries, empty, malformed, non-UTF-8, over-1 MiB and control-character payloads; always consume the sequence. Verified by `src/components/terminalOsc52.test.ts` (14 tests, in `npm run smoke`).
- [x] 1.2 Register the handler in `TerminalPanel.tsx` and mark only output streamed after the attach (`replay === false` and at or after the attach position) as live. Verified by the E2E reload scenario in 3.1.

## 2. Setting

- [x] 2.1 Add `programClipboardWrite` (default on) to `TerminalSettings`, its normaliser, the Selection & Mouse settings section, and classify it `connection-host`. Verified by the renderer typecheck, the server-core settings suite, and the E2E setting scenario in 3.1.

## 3. Verification

- [x] 3.1 Add `e2e/terminal-osc52-clipboard.spec.ts`: a live copy reaches the Electron clipboard; a reload does not copy again; a query, an empty request and escape-carrying text leave the clipboard alone; the setting turns copies off. Verified by `npm run test:e2e -- e2e/terminal-osc52-clipboard.spec.ts`.
- [x] 3.2 Run lint on the changed files and `openspec validate terminal-osc52-clipboard --strict`. Verified by clean runs.
- [x] 3.3 Pull-request CI on `origin` reports every status `success` or `skipped`. Verified by reading the head commit's statuses. Result: all 25 statuses on 6b931e1c were `success`.

## 4. Archive

- [x] 4.1 Archive the change after verification so its deltas fold into `terminal-workspace` and `settings-shortcuts-and-desktop-integration`. Verified by `openspec validate --all`.
