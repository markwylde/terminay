## Why

Launching or resuming a workflow from the Command Bar does not start the agent
on it. Claude Code shows the `/goal ...` text as a pasted message, sends it as
an ordinary prompt, and never sets a goal, so the user has to retype `/goal`
by hand (#595).

Terminay writes the launch and resume text as one bracketed paste. Claude Code
runs slash commands only when they are typed, and it treats any bracketed
paste as pasted. Dropping the markers is not enough: Claude Code also treats a
large block of text that arrives in one read as a paste. A 1 KB launch text
written in one write becomes `[Pasted text #1]` and `/goal` does not run
(`openspec/adr/evidence/workflow-goal-typing/`).

## What Changes

- Workflow launch and resume text is typed, not pasted: written without
  bracketed-paste markers, in chunks of at most 128 characters with a 10 ms
  pause between chunks, then Enter on its own after the existing 50 ms pause.
  This reuses the `write_terminal` write path (`writeSeparatedInput`), which
  gains an option to type its body in chunks.
- The typed text is one line. Line breaks and tabs in the composed text become
  single spaces, because a typed line feed submits a line in a shell, and
  typing never relies on bracketed paste to hold lines together.
- The workflow template editor's launch preview shows that same one-line text.
- The pending `agent-safe-terminal-submit` delta, which still says "one paste",
  is aligned so archiving it does not reintroduce paste.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: launch and resume text is typed in small chunks as one
  line, never pasted.

## Impact

- `packages/server-core/src/terminalService/commandSubmission.ts`: chunked
  typing option on `writeSeparatedInput`.
- `packages/server-core/src/composition.ts`: workflow `typeText` types instead
  of pasting.
- `packages/protocol/src/workflows.ts`: one-line typed goal shared by server
  and preview.
- `src/components/workflows/workflowLibraryModel.ts`: preview uses it.
- Unchanged: window messages, `write_terminal`, and `run_command` keep their
  current writes. Launching a 16 KiB launch text now takes about 1.3 s of
  typing instead of one write.
