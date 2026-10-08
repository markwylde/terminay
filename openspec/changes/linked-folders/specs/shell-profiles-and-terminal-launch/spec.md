## MODIFIED Requirements

### Requirement: New terminals start in policy

The server setting **New terminals start in** SHALL support **Current terminal
or panel** (the default), which inherits the active terminal's live working
directory, the active folder, or the containing directory of the active file in
the target project; **Project folder**, which uses the canonical root of the
folder the terminal is created in, being the worktree of a linked folder and the
canonical root of the target project otherwise; and **Home folder**, which uses
the verified account home reported by the server. Working-directory selection
SHALL be part of the canonical launch resolver but SHALL be configured
separately from shell profiles.

#### Scenario: Current terminal or panel

- **WHEN** the policy is Current terminal or panel and a file panel is active
- **THEN** the new terminal starts in the containing directory of that file in
  the target project

#### Scenario: Project folder in a linked folder

- **WHEN** the policy is Project folder and the terminal is created in a linked
  folder
- **THEN** the new terminal starts in that folder's worktree

#### Scenario: Home folder

- **WHEN** the policy is Home folder
- **THEN** the new terminal starts in the account home verified by the server

### Requirement: Working-directory resolution order

For the default policy, the resolver SHALL consider inputs in this order: an
explicit working directory from an authorized user action; a verified live
working directory from the active terminal, folder, or file panel of the folder
the terminal is created in; the canonical root of that folder, being the
worktree of a linked folder and the target project's canonical root otherwise;
then the server's verified account home, only when the project has no usable
root by design. The server SHALL resolve the folder's root itself from the
folder id; a launch request SHALL NOT supply it. An explicitly requested missing
or non-directory path SHALL fail and MUST NOT be retargeted. A stale observed
panel working directory MAY fall through to the folder's canonical root. A
linked folder whose worktree has become missing SHALL fall through to the target
project's canonical root. A configured project root that has become missing or
inaccessible SHALL remain a recoverable project error and MUST NOT be silently
replaced with home.

#### Scenario: Explicit path is missing

- **WHEN** an authorized action requests a working directory that does not exist
  or is not a directory
- **THEN** creation fails and the request is not retargeted to another directory

#### Scenario: Missing project root

- **WHEN** the configured project root is missing or inaccessible
- **THEN** a recoverable project error is presented and home is not substituted

#### Scenario: Stale panel cwd

- **WHEN** the observed panel working directory is stale
- **THEN** resolution falls through to the canonical root of the folder the
  terminal is created in

#### Scenario: First terminal in a linked folder

- **WHEN** a terminal is created in a linked folder that holds no panels
- **THEN** it starts in that folder's worktree

#### Scenario: Active panel belongs to another folder

- **WHEN** a terminal is created in one folder while the device's last active
  panel belongs to another folder
- **THEN** the other folder's panel directory is not inherited

#### Scenario: Project opened at home

- **WHEN** a project rooted at the user's home directory creates its first and
  subsequent terminals
- **THEN** each starts in that home directory
