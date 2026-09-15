# ADR review

ADR review is complete for `reduce-idle-subprocess-spawns`.

## In-force ADRs reviewed

Derived by walking `Supersedes:` links across `openspec/adr/`. ADR-0007
(superseded by 0008), ADR-0008 (superseded by 0018) and ADR-0009 (superseded by
0017) are historical and were not treated as live commitments.

In force at review time: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0011, 0012,
0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020.

The binding ones here:

- **ADR-0011 (trust-boundary model)** — agent observation and Git services sit
  behind the server boundary, with terminal-session identity as a security
  boundary. Gating observation cancels work per terminal through the existing
  identity-checked release path rather than behind a global flag a fired timer
  could race. Honoured, not amended.
- **ADR-0020 (per-operation canonical roots)** — its closing principle, that
  externalised filesystem cost counts as cost, is the reason this report was
  taken seriously. ADR-0021 corrects how that cost is measured; it does not
  reverse the principle, so it supersedes nothing.
- **ADR-0004 (node-pty and the supported distribution matrix)** — the reason
  replacing `lsof`/`ps` with a native `proc_pidinfo` addon is out of scope: it
  adds a compiled dependency to the packaging matrix and needs its own
  decision.

## New durable decision recorded

- [ADR-0021: Measure idle background cost in child processes, not in the
  parent's syscalls](../../adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md)

It meets the bar. ADR-0020's budget was asserted against a `fs_usage` trace of
one PID, and that instrument is satisfied by moving work into a child — which is
exactly what happened. Recording the correct instrument, and the three design
rules that follow from it (a debounce is not a rate limit; per-sample spawning
is a design error; "off" means cancelled), constrains every future change in
this area. It supersedes nothing.

Supporting measurements:
[idle subprocess spawn cost](../../adr/evidence/idle-subprocess-spawn-cost.md).

## Decisions deliberately not recorded as ADRs

- Scoping a Git refresh to the worktree that raised it, and throttling refresh
  cadence. Both are captured by the `git-worktrees-and-quick-push` delta;
  ADR-0021 states the general rule they follow.
- `lsof` repeat mode. A technique, not a commitment — the spec keeps per-sample
  invocation as a conforming fallback.
