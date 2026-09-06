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

## What Changes

- Derive the issued terminal context id from the full terminal identity — the
  server instance, project, and terminal session — as well as the incarnation,
  so two live terminals can never collide.
- Admit concurrent agent terminals for one provider, each with its own root,
  independent state, and independent retirement.
- Stop the unit tests hiding the production default: exercise the shipped
  context-id function directly, and admit two terminals in one host.
- Add a concurrent-terminal step to the shared conformance harness so it runs
  for every provider rather than being written per extension.
- Give every agent extension an Electron end-to-end spec that drives two
  terminals of that provider and asserts two rows in the Agents pane, using a
  stub CLI so it runs on every ordinary run rather than only when opted in.
- Cover Cursor and omp, which today have no conformance descriptor and no
  end-to-end coverage of any kind.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: terminal context identity must be unique per
  issued terminal session, and concurrent terminals of one provider must each
  hold an independent root.
- `agent-provider-conformance`: the real-CLI matrix and the shared harness must
  prove a second concurrent session, and every matrix provider must have
  running end-to-end proof that its rows reach the Agents pane.

## Impact

- `packages/server-core/src/activity/extensionAgentRuntime.ts`: default
  `makeContextId`.
- `packages/server-core/test/extension-agent-runtime.test.mjs`: two-terminal
  admission, and the shipped default asserted directly.
- `tests/agent-conformance/`: a concurrent-session step shared by all providers.
- `extensions/agent-*/test/conformance.test.mjs`: a second-session gesture per
  provider; new descriptors for Cursor and omp.
- `e2e/`: per-provider two-terminal sidebar specs and their stub CLIs.
- No protocol or client change. The context id is host-issued and opaque to
  extensions and to the renderer.
