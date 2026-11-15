## 1. Typed input

- [x] 1.1 Add `typeChunkChars` and `typeDelayMs` to `writeSeparatedInput` in
      `packages/server-core/src/terminalService/commandSubmission.ts`: split
      the body by code point into chunks of at most `typeChunkChars`, pause
      `typeDelayMs` between chunks and `delayMs` before each key, inside the
      same per-terminal queue and abort checks. Export
      `TYPE_CHUNK_CHARS` (128) and `TYPE_DELAY_MS` (10).
      Verified by `terminal-command-submission.test.mjs`: chunk sizes and
      order; no split surrogate pair; recorded pauses (10 ms between chunks,
      50 ms before Enter); abort while queued and mid-body writes nothing more
      and releases the queue; a failed chunk stops the rest and the Enter and
      releases the queue; byte count; without `typeChunkChars` the writes and
      pauses are unchanged.
- [x] 1.2 Add `typedWorkflowGoal(openingPrompt, instruction)` to
      `packages/protocol/src/workflows.ts`: `composeWorkflowGoal`, then each
      run of whitespace containing a line break (LF, CRLF, CR) or tab becomes
      one space, trimmed; no Unicode normalisation. Verified by a protocol
      unit test covering LF, CRLF, CR-only, tabs, surrounding spaces, empty
      opening prompt, and non-ASCII text kept byte-for-byte.

## 2. Workflow launch and resume

- [x] 2.1 `workflowLaunchText` and `workflowResumeText` check the 16 KiB bound
      on the composed text before flattening, then return the typed one-line
      text. Verified by `workflow-service.test.mjs`: an opening prompt whose
      composed text exceeds 16 KiB only through line breaks and spaces is
      still refused.
- [x] 2.2 Workflow `typeText` in `packages/server-core/src/composition.ts`
      types the text through `writeSeparatedInput` with the chunk options,
      the request's `context.signal`, and no bracketed-paste markers whatever
      the terminal's mode, then `SUBMIT_INPUT` on its own. Verified by
      `workflow-composition.test.mjs`: launch and resume with bracketed paste
      on and off write no `ESC[200~`, every chunk ≤128 characters with no
      line break, more than one chunk for a long text, joined chunks equal
      `typedWorkflowGoal`, final write `\r`, all writes sourced `workflow`.
- [x] 2.3 Template editor launch preview uses `typedWorkflowGoal`. Verified by
      `workflow-service.test.mjs` (the server's `workflowLaunchText` equals
      `typedWorkflowGoal`), `scripts/workflow-ui.test.mjs` (the preview is
      that one line), and the e2e preview assertion.
- [x] 2.4 Rewrite the pending `agent-safe-terminal-submit` delta's
      `terminal-workflows` wording from "one paste" to typed text. Verified by
      `openspec validate --all` and by reading both deltas side by side.

## 3. End to end

- [x] 3.1 Extend the launch in `e2e/workflows.spec.ts`: run a small raw-mode
      reader in the terminal that enables bracketed paste (so the old code
      would paste) and appends every byte it reads to a file, exiting on
      `\r`; assert the file is exactly the one-line launch text followed by
      `\r`, with no paste marker. Read boundaries are not asserted. Verified
      by `npm run test:e2e` (Docker) on that spec.
- [x] 3.2 Make the evidence probe reproducible: cwd from an argument or the
      current directory, text from `typedWorkflowGoal` with the real launch
      and resume instructions at a given opening-prompt size (up to 8 KiB,
      with non-ASCII), production timing (128/10, 50 ms before Enter).
      Verified by `commandRan: true` for launch and resume at 1 KiB, 3.2 KiB
      and 8 KiB (goal set below Claude Code's 4,000-character goal limit,
      refused for length above it), recorded in the evidence README.

## 4. Checks

- [x] 4.1 `openspec validate --all`, `npm run lint`,
      `npx tsc --noEmit -p tsconfig.json`, `npm run typecheck:workspaces`,
      and the protocol and server-core suites with
      `node --test --test-force-exit --test-timeout=120000`, all exit zero.
