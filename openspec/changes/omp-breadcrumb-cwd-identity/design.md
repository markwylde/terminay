## Context

omp writes `terminal-sessions/<tty>` below its agent state root as the CWD on
line one, the session-file path on line two, and marker lines after that.
Through omp 18.1 the only marker was `fresh`. omp 18.2.0 added
`cwdstat <dev> <ino>`, the identity of the directory the session started in,
so that `--continue` re-roots a project that was moved on the same filesystem
and leaves one that was deleted alone.

The extension's parser accepted two or three lines and required a third line
to be exactly `fresh`. A three-line breadcrumb ending in `cwdstat …`, or a
four-line one with both markers, was refused as malformed on every poll. With
the breadcrumb path closed, the only remaining bind was the open-writable
journal fallback, which omp gives no persistent handle for, so binding
depended on a poll landing inside the moment a write held the file open.

The breadcrumb is untrusted provider data read through the environment
broker. Nothing here changes what the extension does with it: the session
file it names is still resolved only beneath an allowed omp sessions root and
still has to be a validated root journal. No security boundary moves.

## Goals / Non-Goals

**Goals:**

- A breadcrumb from omp 18.1 or 18.2 parses, with or without either marker.
- A line the extension does not understand still fails the breadcrumb closed.
- Marker parsing stays bounded in count and in bytes per line.

**Non-Goals:**

- Using the `cwdstat` identity for anything. It is omp's re-rooting evidence
  and says nothing about which PTY wrote the session.
- Pinning the omp version the conformance image installs. The image installs
  `@latest` deliberately, because that is the only version Terminay supports.

## Decisions

**Parse markers as a bounded set, not a positional third line.** Lines after
the second are markers. `fresh` and `cwdstat <digits> <digits>` are each
accepted once, in either order; anything else, a repeat, a line over 256
bytes, or more than four marker lines returns no breadcrumb. This is
deliberately not "ignore lines we do not understand": a breadcrumb that omp
has changed in a way this extension has not seen should surface as a refused
breadcrumb, which the conformance matrix catches, rather than bind on a
half-understood record.

## Risks / Trade-offs

- The next omp marker will need the same change. That is the intended
  failure mode, and the conformance suite is where it shows up.
