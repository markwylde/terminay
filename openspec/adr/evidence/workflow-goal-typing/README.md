# Workflow goal typing against Claude Code

Issue #595: a workflow's `/goal` launch text reached Claude Code as a paste, so
Claude Code put it in the prompt as a message and never ran `/goal`.

## Method

The first table came from an earlier, ad-hoc version of the probe; the
second from `probe.cjs` as committed.

The ad-hoc probe spawned Claude Code 2.1 (`claude --model claude-haiku-5-5`) over
node-pty 1.1, waited for its prompt, wrote a 1,262-character `/goal` text
with two paragraph breaks in chunks of `chunk` characters with `delay` ms
between them, waited 300 ms, wrote `\r` on its own, and reported whether Claude
Code showed a `[Pasted text]` placeholder and whether it answered `Goal set`.

## Chunk size and pause (2026-11-15)

| chunk | delay ms | typing ms | pasted placeholder | `/goal` ran |
| ----: | -------: | --------: | :----------------: | :---------: |
| whole |        0 |         1 | yes                | no          |
|  1000 |       10 |        21 | yes                | no          |
|   512 |        0 |         0 | yes                | no          |
|   256 |        2 |        10 | yes                | no          |
|   512 |       10 |        31 | no                 | yes         |
|   256 |        5 |        26 | no                 | yes         |
|   256 |       10 |        51 | no                 | yes         |
|   128 |        5 |        50 | no                 | yes         |
|    64 |        5 |       102 | no                 | yes         |

Also observed by hand through Terminay's `write_terminal`:

- A bracketed paste (the launch path before this change) is a paste: `/goal`
  does not run. This is the report in #595.
- A 119-byte `/goal` text written in one unbracketed write is typed: Claude Code
  answers `Goal set`, and line feeds become line breaks in the prompt.
- A 1,070-byte text in one unbracketed write becomes `[Pasted text #1 +4 lines]`
  and `/goal` does not run.

## Production typing (2026-11-15)

`probe.cjs` types the real `typedWorkflowGoal` launch or resume text, built
from `@terminay/protocol`, with a two-paragraph opening prompt holding
non-ASCII text and padded to a size, at 128 characters per chunk 10 ms apart
and Enter 50 ms after the last chunk, into Claude Code 2.1.325. It counts the
command as run when Claude Code sets the goal (or shows it active or
achieved), or refuses its length.

```
npx turbo run build --filter=@terminay/protocol
node openspec/adr/evidence/workflow-goal-typing/probe.cjs --cwd <trusted dir> \
  launch:1024 resume:1024 launch:3200 resume:3200 launch:8192 resume:8192 launch:1024:100000:0
```

| kind   | opening prompt bytes | text chars | chunk / delay | typing ms | pasted | `/goal` ran | result |
| ------ | -------------------: | ---------: | ------------- | --------: | :----: | :---------: | ------ |
| launch |                1,024 |      1,609 | 128 / 10      |       124 | no     | yes         | goal set |
| resume |                1,024 |      1,595 | 128 / 10      |       124 | no     | yes         | goal set |
| launch |                3,200 |      3,784 | 128 / 10      |       299 | no     | yes         | goal set |
| resume |                3,200 |      3,770 | 128 / 10      |       295 | no     | yes         | goal set |
| launch |                8,192 |      8,801 | 128 / 10      |       710 | no     | yes         | refused: over 4,000 characters |
| resume |                8,192 |      8,787 | 128 / 10      |       713 | no     | yes         | refused: over 4,000 characters |
| launch |                1,024 |      1,609 | one write     |         0 | yes    | no          | sent as a message |

Claude Code limits a goal condition to 4,000 characters ("Goal condition is
limited to 4000 characters (got 8795)"). That is Claude Code's own limit on
`/goal`, separate from paste detection: the command runs and refuses the
length. A workflow's opening prompt may be up to 8 KiB, so a long one cannot
become a Claude Code goal however it is written to the terminal.

## Reading

Claude Code decides paste versus typing from how much text arrives in one read
and how quickly reads follow each other, not only from bracketed-paste
markers. Dropping the markers is not enough for a launch text of realistic
length; the text has to arrive as many small reads. 128-character chunks with
a 10 ms pause sit well inside the passing region on both axes.
