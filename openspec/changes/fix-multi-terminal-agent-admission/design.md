## Context

The privileged host owns terminal-session identity. It issues an observation
context to an extension child for one exact terminal at one exact incarnation,
and refuses a second admission of the same context. That refusal is the
mechanism enforcing "one context per terminal incarnation".

The identifier carrying that identity is built in
`packages/server-core/src/activity/extensionAgentRuntime.ts`:

```ts
this.makeContextId =
  options.contextId ??
  ((_identity, incarnation) => `extension-agent:${authorityNonce}:${incarnation}`);
```

`identity` is discarded. `incarnation` is per-terminal and starts at `1`
(`register()`: `(current?.incarnation ?? 0) + 1`). So the identifier means
"the Nth incarnation of some terminal", not "this terminal". Two terminals at
incarnation 1 are indistinguishable, and the host's own uniqueness check turns
into a global lock: the first agent terminal wins and every later one is
refused.

## Goals / Non-Goals

**Goals**

- Two or more terminals of one provider each observed, each with its own root.
- The failure impossible to reintroduce silently: a test must fail if the
  identifier stops depending on terminal session.
- Coverage that would have caught this, at all three levels — host unit,
  real-CLI conformance, and the running application.

**Non-Goals**

- Changing the provider journal-selection rules. The Claude Code
  most-recently-appended rule is separately wrong for two sessions in one
  directory and is tracked on its own; it is downstream of this and unreachable
  until admission succeeds.
- Changing the protocol or anything the renderer sees. The context id is
  host-internal and opaque.

## Decisions

### The identifier is derived from the whole issued identity

The default becomes a function of `serverId`, `projectId`, `sessionId` and
`incarnation`. The registry nonce stays, so identifiers remain unguessable
across server instances and cannot be forged by a child.

**Boundary crossed:** terminal-session identity is a security boundary for
agent status. The identifier must therefore not be a bare concatenation that
another identity could collide with by construction — segment separators must
not be forgeable from the segment values themselves. The identity components
are server-issued opaque ids, and the nonce prefix keeps the value unguessable;
the identifier stays opaque to the child and to clients, which continue to
address terminals by their own identity rather than by this value.

Alternative considered: keep the counter but make it global to the registry
rather than per terminal. Rejected — it removes today's collision by accident
rather than by construction, and a global counter still says nothing about
which terminal a context belongs to, so the next reuse bug would be just as
silent.

### The unit tests must exercise the shipped function

Every existing `extension-agent-runtime` test injects
`contextId: (_identity, incarnation) => \`context-${incarnation}\``. The
production default has never run under test, and the injected double carries
the identical collision — invisible only because no test admits two terminals
against one host.

The seam stays, because tests want readable identifiers. But the shipped
default is asserted directly for uniqueness across identities, and the
two-terminal admission test runs against the real default rather than a double.

**Boundary crossed:** none. This is test construction.

### Concurrency is asserted once, in the shared harness

The conformance harness gains the ability to hold a second PTY and context, and
the concurrent-session assertions live in `runConformance` alongside the other
capabilities. Providers supply only a second-launch gesture. A capability
asserted per extension is a capability that will be skipped for some extension.

### The application surface needs stub CLIs

Real authenticated CLIs cannot run on every end-to-end run: they need
credentials, cost money, and are non-deterministic. Grok already has a compiled
stub that writes its real journal format, which is why Grok is the only
provider whose Agents-pane spec runs at all today. Each remaining provider gets
the same treatment, and the real-CLI Electron specs stay as the opt-in
credential-gated layer above them.

**Boundary crossed:** none — the stubs are test fixtures outside the shipped
application, and they write the provider's real on-disk journal format so the
production observation path is what is exercised.

## Risks / Trade-offs

- **A stub can drift from its real CLI.** Mitigated by the real-CLI conformance
  layer above it, which uses no stubs, and by fixture-parity requirements
  already in the conformance spec.
- **Longer end-to-end runs.** Two terminals per provider spec, six providers.
  Accepted: this is the class of defect that has cost the most time.
- **Changing the identifier shape** invalidates nothing persisted — contexts
  live only for the incarnation — so there is no migration.

## Open Questions

- Whether Cursor and omp should join the published capability matrix now that
  they will have descriptors, or stay outside it with detection-only coverage.
  They ship as agent extensions today with no conformance claim at all, which
  is permitted but leaves them unverified.
