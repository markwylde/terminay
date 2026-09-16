## MODIFIED Requirements

### Requirement: omp terminal breadcrumb binding

OMP SHALL write a terminal-scoped breadcrumb below its effective agent data root at `terminal-sessions/<terminal-id>`, whose identifier derives from the OMP process's TTY and which records its CWD, exact session-file path, and then marker lines: an optional `fresh` marker, and an optional `cwdstat <device> <inode>` line recording the identity of the directory the session was started in. Terminay SHALL derive the same ID from the registered PTY shell's TTY, accept only a bounded well-formed breadcrumb whose target is a validated root JSONL below an allowed OMP sessions root, and recheck it while OMP remains foreground. A well-formed breadcrumb SHALL carry each marker at most once, in either order, within a bounded number of marker lines; a breadcrumb carrying any other marker line SHALL be refused. The `cwdstat` identity SHALL NOT establish ownership. A `fresh` breadcrumb whose JSONL is not yet materialized SHALL keep terminal-activity fallback until the target exists. A changed breadcrumb SHALL rebind the same terminal to the newly validated root. CWD, filename timestamps, and newest-file heuristics SHALL NOT establish ownership, and open file-descriptor observation SHALL be supplementary evidence only. A `bun` wrapper SHALL be admitted only after the OMP terminal breadcrumb for the exact PTY identifies a validated OMP root JSONL, while an `omp` binary that sets its process title SHALL match `omp` directly.

#### Scenario: Fresh breadcrumb without a file

- **WHEN** the breadcrumb carries a `fresh` marker and its target JSONL does not yet exist
- **THEN** the terminal stays on terminal-activity fallback until the target exists

#### Scenario: Breadcrumb carries the directory identity

- **WHEN** the breadcrumb carries a `cwdstat <device> <inode>` line after the session-file path, with or without a `fresh` marker
- **THEN** the terminal binds to the validated root the session-file path names, and the identity line plays no part in ownership

#### Scenario: Breadcrumb carries an unknown marker

- **WHEN** a marker line is neither `fresh` nor a well-formed `cwdstat` line, or a marker repeats
- **THEN** the breadcrumb is refused and the terminal does not bind through it

#### Scenario: Breadcrumb changes

- **WHEN** the breadcrumb for the bound terminal changes to another validated root
- **THEN** the same terminal rebinds to the newly validated root

#### Scenario: Bun wrapper

- **WHEN** the foreground process is a `bun` wrapper
- **THEN** it is admitted only after the OMP breadcrumb for the exact PTY identifies a validated OMP root JSONL
