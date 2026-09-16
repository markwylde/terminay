## Why

Since omp 18.2, a terminal running omp never binds through its breadcrumb. The
agent sidebar shows the terminal on activity fallback instead of the session
omp is actually running, and the omp conformance job fails on every attempt
because binding is left to a race that only sometimes lands. omp 18.2 appends
a `cwdstat <device> <inode>` line to the breadcrumb it writes for the TTY, and
the extension refused any third line that was not exactly `fresh`.

## What Changes

- The omp extension accepts the marker lines omp writes after the CWD and
  session-file lines: `fresh`, and `cwdstat <device> <inode>`. Each is
  accepted once, in either order, and a bounded number of marker lines is
  read. Any other line still fails the breadcrumb closed.
- The breadcrumb's `cwdstat` identity is not used for binding. It is omp's
  own evidence for re-rooting a `--continue`, and the exact session-file path
  remains what the extension validates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: the "omp terminal breadcrumb binding"
  requirement names the marker lines a well-formed breadcrumb may carry.

## Impact

- `extensions/agent-omp/src/ompAgent.ts` — `parseBreadcrumb` reads marker
  lines rather than one optional `fresh`.
- `extensions/agent-omp/test/omp-agent.test.mjs` — a breadcrumb with the
  `cwdstat` line binds; unknown, repeated, or oversized markers fail closed.
- No host, protocol, or client surface is touched.
