# ADR-0024: An agent provider that cannot bind names the directories it is waiting on; the host watches them and nothing else re-runs discovery

Status: accepted
Date: 2026-09-16

## Context

ADR-0022 decided that agent discovery is driven by watching files and that a
new session file appearing is the discovery event. It did not say who watches,
or how the host learns which directory matters, and the answer is not obvious:
the five built-in providers keep their evidence in different shapes. Claude
writes one pid-keyed file and a journal in a cwd-derived directory. Codex writes
rollouts keyed by session id and date. Grok keeps a pid registry file. omp has
several candidate roots. OpenCode has a session store and no per-session file.

Two placements were considered for the watch:

- An extension-wide watch opened at `activate()` on a manifest-declared root,
  with the extension asking the host which terminal owns the pid it found. This
  needs a new broker outside any admitted terminal context, a new pid-to-terminal
  authority the host must prove on demand, and only works for the one provider
  whose files are keyed by pid. It also cannot express a cwd-derived directory.
- A declaration from inside the observation attempt, using the terminal-scoped
  directory handles the provider already resolved, watched by the host for the
  life of that terminal incarnation.

The second keeps every existing boundary: observation stays inside an admitted
context, handles stay host-minted and context-scoped, and no host code learns
any provider's directory layout.

## Decision

1. **A `not-bound` observation result names the directories whose contents
   decide whether the provider can bind.** The names are terminal-scoped
   directory handles obtained during that attempt through the same context's
   file observation broker, each marked as the directory's own entries or its
   whole tree. A handle the context never issued is dropped.
2. **The host watches exactly those directories for that incarnation and
   re-runs observation on the first change.** The extension child reports the
   canonical path the broker resolved for each handle; the host opens one
   kernel watch per path, recursive only where the provider asked, bounded in
   number, and closes them when the incarnation binds, returns to the shell,
   is replaced, exits, or when agent integration is switched off.
3. **A `not-bound` result that names nothing ends discovery for the
   incarnation.** Only the next foreground edge can start it again. There is no
   fallback timer, no retry count, and no process-table or open-file sampling
   to decide whether to try again.
4. **Re-observation is damped by the shared ramping schedule from ADR-0022**,
   run promptly after a quiet period and widened under churn. That schedule is
   one module in server-core; every damped site adopts it rather than its own
   debounce.
5. **Process inspection runs only inside an observation attempt.** An attempt
   starts from a foreground edge or from a change in a named directory, never
   from a timer.

## Consequences

- Every provider, built-in or third-party, is responsible for knowing where its
  own evidence will appear. Conformance fails a provider that reports
  `not-bound` with nothing to await while its CLI is a descendant of the
  terminal.
- The extension agent runtime holds one disposable per terminal, its open
  discovery watches, and no other state between a foreground edge and a bind.
- The topology signature, its `ps` and `lsof` sampling, and its Electron
  wiring are removed rather than tuned.
- A third-party provider that still returns a bare `not-bound` keeps working
  but is not retried until the next foreground edge. That is a visible
  behaviour change for such a provider and is recorded here as intended.
- Extending discovery to a provider whose evidence is not a directory change,
  for example a socket, needs a new ADR; nothing here permits a timer for it.
