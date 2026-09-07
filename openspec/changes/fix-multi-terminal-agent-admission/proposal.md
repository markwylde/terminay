## Why

Open two terminals and run an agent CLI in each. The first appears in the
Agents pane. Every one after it is missing, and stays missing for as long as
the first is alive. The pane reports "No agents in this project" while the
CLIs are plainly running. This is not provider-specific: it was reproduced on
this host for Claude Code and for Grok within twenty minutes of each other.

The privileged host issues a terminal context id from a registry nonce and the
terminal's own incarnation counter, discarding the terminal identity it was
given:

```
`extension-agent:${authorityNonce}:${incarnation}`
```

Every terminal's first agent CLI is therefore incarnation `1`, so every
terminal computes the same context id. The host admits the first and refuses
the rest, because a context of that id is already admitted. The refusal is
recorded and the terminal falls back to plain terminal activity, which is why
the failure is silent at the surface:

```
{"kind":"agent-admission-failed",
 "providerId":"com.terminay.agent.claude-code/cli",
 "failureClass":"failed",
 "reason":"agent terminal context is already admitted"}
```

Nothing caught it. Every conformance test, every real-CLI test, and every
Electron end-to-end spec drives exactly one terminal, so a second admission has
never been attempted. Every `extension-agent-runtime` unit test injects its own
`contextId` function, so the production default has never executed under test
at all — and the injected doubles carry the same collision, unnoticed because
no test admits two terminals against one host.

### The second defect, behind the first

Once admission was fixed a second defect became reachable. Two terminals
running `claude` in one repository share one provider-encoded project
directory, and each lists the other's journal beside its own. The Claude Code
provider chose among those journals by file time — first by newest append,
then by post-process-start creation with a newest-append fallback. File times
cannot say which process wrote a file. On this branch, a brand-new empty
terminal displayed another terminal's session, because `claude --resume`
appends to a journal older than the process and the creation rule falls
through to "whichever journal was appended last".

The CLI already records the answer. Every interactive `claude` process writes
`~/.claude/sessions/<pid>.json` naming its own pid, its current `sessionId`,
its `cwd`, and its start time, rewrites it whenever the session changes, and
removes it on exit. That file maps the observed process to its journal with no
inference at all. The provider never read it.

## What Changes

- Derive the issued terminal context id from the full terminal identity — the
  server instance, project, and terminal session — as well as the incarnation,
  so two live terminals can never collide.
- Admit concurrent agent terminals for one provider, each with its own root,
  independent state, and independent retirement.
- Bind Claude Code through its pid-keyed session file and nothing else: find
  the exact `claude` descendant of the PTY, read
  `~/.claude/sessions/<pid>.json`, check it against the observed process, and
  follow the journal it names. Delete every rule that selects among journals
  by creation time, modification time, or append order, and the open-handle
  fallback beneath them.
- Stop the unit tests hiding the production default: exercise the shipped
  context-id function directly, and admit two terminals in one host.
- Stop the provider fixtures hiding the binding defect: every Claude Code
  fixture must model a project directory that already holds journals older
  than the process under test, including the `--resume` case, and must supply
  the process pid and session file the way production does.
- Add a concurrent-terminal step to the shared conformance harness so it runs
  for every provider rather than being written per extension, and run it in a
  directory that already holds earlier sessions.
- Give every agent extension an Electron end-to-end spec that drives two
  terminals of that provider and asserts two rows in the Agents pane, using a
  stub CLI so it runs on every ordinary run rather than only when opted in.
  The Claude Code stub writes the session file and the journal exactly as the
  CLI does.
- Cover omp, which today has no conformance descriptor and no end-to-end
  coverage of any kind. Cursor is removed under its own change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: terminal context identity must be unique per
  issued terminal session; concurrent terminals of one provider must each hold
  an independent root; Claude Code must bind through its pid-keyed session
  file, and file times must never select a Claude Code journal.
- `agent-provider-conformance`: the real-CLI matrix and the shared harness must
  prove a second concurrent session in a directory that already holds earlier
  sessions, must prove resume binds the resumed session while another runs,
  and every matrix provider must have running end-to-end proof that its rows
  reach the Agents pane.

## Impact

- `packages/server-core/src/activity/extensionAgentRuntime.ts`: default
  `makeContextId`.
- `packages/server-core/test/extension-agent-runtime.test.mjs`: two-terminal
  admission, and the shipped default asserted directly.
- `extensions/agent-claude-code/src/provider.ts`: `projectJournalCandidate`,
  `ownJournal`, `writableJournalCandidate`, `rootJournalCandidate` and
  `resumedJournalCandidate` are deleted and replaced by one session-file rule.
- `extensions/agent-claude-code/test/`: fixtures that model journals older
  than the process, a session file per process, and every failure of the
  session-file check.
- `packages/extension-api/src/testing.ts`: only if `fixtureTerminal` cannot
  already express a pid-keyed file per descendant process.
- `tests/agent-conformance/`: a concurrent-session step shared by all
  providers, seeded prior sessions, and a resume-while-another-runs step.
- `extensions/agent-*/test/conformance.test.mjs`: a second-session gesture per
  provider; a new descriptor for omp.
- `e2e/`: per-provider two-terminal sidebar specs and their stub CLIs; the
  Claude Code stub writes `sessions/<pid>.json`.
- No protocol or client change. The context id is host-issued and opaque to
  extensions and to the renderer.
