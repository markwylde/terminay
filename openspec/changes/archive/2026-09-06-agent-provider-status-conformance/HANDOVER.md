# Handover (third pass)

This supersedes the second handover. Nothing is committed. Every claim below
was produced by a run in this session, not remembered.

## The headline

**The original bug is fixed and proven in the real app.** A real `claude`
launched in a terminal of the built Electron app appears in the Agents pane and
shows amber while working, green when done, and red while a permission prompt is
outstanding. Proof: `e2e/real-claude-code-agent-runtime.spec.ts` passed
(`TERMINAY_REAL_CLAUDE_CODE_E2E=1 npx playwright test e2e/real-claude-code-agent-runtime.spec.ts`,
2.7 min), screenshots copied to
`docs/evidence/agent-provider-status-conformance/claude-code-{working,done,waiting}.png`.

**Conformance against real CLIs, this session:**

| provider | result | stops at |
|---|---|---|
| Grok | **full matrix green** (1 pass, 0 fail) | — |
| Claude Code | green through resume | `blocked` (fault gesture not producing a recorded API error) |
| OpenCode | green through resume | `blocked` (the second `/exit` before the fault does not close the TUI) |
| Codex | green through quit | `resume` (product gap, below) |

Unit suites all green: claude-code 52, codex 16, grok 28, opencode 24.
`npx biome lint .` clean (2 pre-existing warnings). `tsc --noEmit` clean.
`npm run build:app` succeeded (needed for the e2e).

## Fixes landed this session

- **Codex provider** (`extensions/agent-codex/src/provider.ts`): two unobserved
  abort rejections that crash the extension child in production — the losing
  `Promise.race` promises in the merged rollout/title stream, and `dispose()`
  after the terminal signal aborted. Both now caught.
- **Codex `waiting` corrected to N** in the descriptor, the delta spec and
  `docs/agent-provider-capabilities.md`. With `-a on-request -s read-only` and
  the touch approval prompt visibly open, the live rollout carried no
  `exec_approval_request` / `request_permissions` / `request_user_input`; no
  rollout on this machine has ever carried one. The mapping stays in place.
- **Descriptor gestures** (test-only, all commented in the files):
  Claude Code/Codex/OpenCode fault steps wait for the CLI to exit before typing
  the next command (otherwise the TUI reads both lines as one prompt);
  OpenCode bash permission rules are last-match-wins, so `*: ask` is listed
  before `sleep *: allow`; Grok gets an isolated `GROK_HOME` (config
  `permission_mode` overrides the CLI flag) and uses `rm` as its input request
  (writes inside the workspace are auto-allowed); OpenCode's fault uses
  `opencode run` (a bare argument is a directory).
- **Real-app Claude Code e2e** added (see headline). When run from inside a
  Claude Code session, `CLAUDE_CODE_CHILD_SESSION` leaks into the app and turns
  transcript saving off, so the spec unsets it first.

## What is NOT done

1. **Codex resume does not rebind.** After `codex resume --last` the harness
   observes `not-bound` continuously. The Codex binding rule needs an open
   writable rollout handle below the PTY tree, and a resumed Codex holds none
   between appends. The spec already says a provider without a persistent
   handle must not rely on that alone; Codex needs a cwd + start-time fallback
   like Claude Code's. This is a provider change with a unit test, then rerun
   `TERMINAY_CONFORMANCE_CODEX=1`.
2. **Claude Code `blocked`.** Neither `ANTHROPIC_API_KEY=invalid` (Claude asks
   whether to use the key before any journal exists) nor
   `--model not-a-real-model` (exits before recording) produced an
   `isApiErrorMessage` record. Find a gesture that does, or mark the cell as
   unproven in the matrix doc.
3. **OpenCode `blocked`.** The rerun got through resume again and then timed
   out on "the CLI to exit before the fault": the `/exit` sent after the
   resumed session's turn did not close OpenCode (the same `/exit` works in the
   quit step). Likely the slash-command popup swallowing the Enter; try
   `pty.write` with a pause before Enter, or Ctrl+C twice.
4. **5.2** SQLITE_BUSY retry — untouched. **2.5**, **3.4**, **4.3**, **7.6**
   notes stand as written in tasks.md.
5. **`npm run test:ci`** has not been run on this branch.

## How to run

```bash
TERMINAY_CONFORMANCE_{CLAUDE_CODE,CODEX,GROK,OPENCODE}=1 TERMINAY_CONFORMANCE_LOG=1 \
  node --test extensions/agent-<name>/test/conformance.test.mjs   # ~5 min, real tokens
npm run build:app && TERMINAY_REAL_CLAUDE_CODE_E2E=1 npx playwright test e2e/real-claude-code-agent-runtime.spec.ts
```
