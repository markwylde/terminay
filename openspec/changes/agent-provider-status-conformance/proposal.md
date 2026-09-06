## Why

When Claude Code is actively working in a Terminay terminal, its tab shows no
indicator at all — not the amber "working" dot the spec requires, and not the
amber terminal-activity fallback either. Grok and Codex behave correctly in the
same situation, so the user's reasonable conclusion is that agent status is
unreliable rather than that one provider is broken.

Two independent defects produce that single symptom, and neither is visible to
the current test suite:

1. **Claude Code never binds.** `extensions/agent-claude-code/src/provider.ts`
   implements only the *fallback* discovery rule — a journal held open for
   writing by a process in the PTY tree. Claude Code appends to its JSONL and
   closes it, so it holds no such descriptor; verified on a live host, two
   running `claude` processes had 30 open files between them and zero under
   `~/.claude/projects`. The primary rule the spec already states — admit the
   one root journal created for the process's working directory *after* that
   process started — was never implemented. Without a binding there is no
   canonical agent entry, so no RAG glyph.
2. **The terminal-activity fallback is claimed but silent.** The legacy Claude
   Code interpreter profile claims the session, which by spec disables the
   raw-output timer. Claude Code emits no `OSC 9;4` progress, so the claimed
   interpreter has no signal to interpret and reports nothing. Both the
   authoritative path and the fallback path fail for the same terminal.

Underneath both sits the real problem: **no provider is verified against the
behaviour a real CLI actually exhibits.** Every Claude Code unit test
synthesises `openFiles` returning the journal — asserting precisely the one
thing real Claude Code never does — and the only real-CLI check runs
`claude --version`. There is no shared statement of what each provider must be
able to observe, and no cross-provider test regime that would have caught this.

## What Changes

- **Fix Claude Code binding.** Implement the specified primary rule: resolve the
  provider-encoded project directory from the exact descendant process CWD and
  observe it for root journals written after that process started, binding the
  one currently receiving appends — one `claude` process writes a new journal per
  conversation, so several candidates are normal rather than ambiguous. Keep the
  open-writable-handle path as the fallback the spec already designates it to be.
- **Fix the fallback interpreter claim.** An interpreter profile SHALL only
  claim a session — and so only suppress the raw-output timer — when it is
  actually receiving the signals it interprets. A profile that claims a session
  and then observes no signal of its kind SHALL release the claim so ordinary
  terminal activity resumes. This restores an amber fallback for any provider
  whose authoritative binding is unavailable, rather than leaving a dead tab.
- **Add an OpenCode provider** (`terminay-agent-opencode`) as a bundled,
  enabled-by-default agent extension. OpenCode is already installed on
  developer hosts and is one of the four providers the conformance matrix must
  cover.
- **Introduce a provider status conformance matrix** as a first-class,
  spec-level contract. Ten capabilities per provider — Detect, Title, the five
  canonical states Idle, Working, Waiting, Blocked and Done, subagent
  enumeration, subagent status, and Resume — each carrying a stated verdict:
  read from an explicit provider record, derived from that provider's journal by
  a named rule, or unsupported with a reason.
- **Add real-CLI conformance tests inside each extension.** Each provider's
  extension package gets an integration test that spawns a real shell in a real
  PTY, launches that provider's CLI as a user would, drives it through a
  multi-subagent prompt, an outstanding input request, a halting fault, and a
  quit-and-resume cycle, and asserts the canonical lifecycle events its own
  observation runtime emits. No Terminay server, workspace, or UI is involved.
  The mechanics live in one shared harness so every capability assertion is
  written once and runs for all four providers. Opt-in and credential-gated.
- **Derive what providers do not record.** Where a provider records no explicit
  fact — Claude Code writes nothing at all while a permission prompt is open —
  the state is derived from its own session journal under named, bounded
  inference rules, rather than the capability being declared unavailable. The
  matrix marks derived cells so an explicit fact stays distinguishable from an
  inferred one.

- **Cover quit and resume.** Quitting must make a root inactive rather than
  leaving it reporting `working` forever; resuming must rebind the same root
  without duplicating it or replaying old transitions. Resume becomes a matrix
  column exercised for every provider.

Non-goals, unchanged: Terminay does not modify, configure, wrap, or instrument
any provider CLI. Every capability in the matrix is met by observing files the
provider already writes, or it is declared unsupported.

## Capabilities

### New Capabilities

- `agent-provider-conformance`: The cross-provider capability matrix — the ten
  columns, what evidence each requires, the per-provider verdicts, the rules
  governing journal-derived inference, and the extension-hosted real-CLI
  verification regime that keeps the matrix truthful.

### Modified Capabilities

- `agent-status-and-sidebar`: Claude Code binding gains its specified primary
  rule, correct turn-header handling, subagent journal discovery, and its
  input-request and fault inference; Grok's subagent requirement is rewritten
  around the child sessions and per-child records its CLI now writes; OpenCode is
  added as a bundled provider with its session root, binding evidence, privacy
  boundary, and record mapping.
- `terminal-activity-signals`: An interpreter profile's claim over a session
  becomes conditional on that profile actually observing its own signal kind,
  and is released when it does not.

## Impact

- `extensions/agent-claude-code/` — provider discovery, mapping, tests, fixtures.
- `extensions/agent-grok/` — subagent discovery and per-child mapping.
- `extensions/agent-opencode/` — new extension package; `extensions/builtins.json`.
- `packages/extension-api/` — `AgentDiscoveredFile` needs a creation-time fact,
  or the post-process-start rule must be derived from directory-watch deltas.
- `packages/server-core/src/activity/` — interpreter claim lifecycle.
- `extensions/*/test/` — a conformance test per provider extension; the existing
  per-extension `real-cli-smoke.mjs` files and `e2e/real-codex-agent-runtime.spec.ts`
  are retired into them.
- A shared conformance harness built on `node-pty`, reusing the observation
  adapter logic in `packages/server-core/src/extensions/localAgentObservation.ts`.
- CI — the conformance suite is opt-in and credential-gated; it does not run on
  ordinary pull requests.
- The matrix covers Codex, Claude Code, Grok, and OpenCode. Cursor Agent and omp
  remain shipped providers but are out of scope for this change's matrix and
  test regime.
