## ADDED Requirements

### Requirement: A data root is held by one running standalone server

A standalone server SHALL hold its data root exclusively from before it reads or writes any durable state in it until its process ends. The hold SHALL belong to the server process and SHALL be enforced by the operating system, so that it ends when the process ends by any means, including a kill, and continues while the process is paused or suspended. A second standalone server started on a held data root SHALL NOT start. Whether a data root is held SHALL NOT be decided from the presence, contents, or age of a file, from a recorded process id, or from a deadline. A server that cannot establish whether the data root is held SHALL NOT start.

#### Scenario: A second server on a held data root

- **WHEN** a standalone server starts on a data root that a running server holds
- **THEN** it does not start, and the running server is unaffected

#### Scenario: Start after a kill

- **WHEN** a standalone server is killed and another is then started on the same data root
- **THEN** the second server starts with no operator action

#### Scenario: Start after a graceful stop

- **WHEN** a standalone server is stopped gracefully and another is then started on the same data root
- **THEN** the second server starts

#### Scenario: A paused server keeps its data root

- **WHEN** a standalone server starts on a data root whose holder is paused
- **THEN** it does not start, however long the holder has been paused

#### Scenario: Two containers on one volume

- **WHEN** two containers of the official image are started on the same data volume
- **THEN** exactly one of them runs a server

#### Scenario: A data root that cannot be locked

- **WHEN** a standalone server starts on a data root whose filesystem cannot provide the lock
- **THEN** it does not start, and reports that the data root could not be locked

### Requirement: A held data root is explained to the operator

A standalone server that cannot take its data root because another server holds it SHALL exit with a non-zero status and SHALL leave the data root as it found it. It SHALL write to standard error a message that states that another server is using the data root, names the data root and the lock file, gives the time the holder recorded when one is recorded, explains that the lock is held by a running server and ends when that server does, and gives the command that finds that server and the instruction to use it or stop it. The message SHALL NOT tell the operator to remove a file. In the official container image the commands SHALL be expressed for containers and volumes, SHALL say that a paused container holds the lock, and SHALL NOT refer to a process id. The message SHALL NOT include a stack trace.

#### Scenario: A container starts on a volume another container holds

- **WHEN** the official image starts on a data volume that a running container holds
- **THEN** the container exits non-zero and its log states that another server is using the data root, names the lock file, and gives the command that lists the containers using the volume

#### Scenario: A host server starts on a held data root

- **WHEN** a standalone server outside a container starts on a data root that a running server holds
- **THEN** it exits non-zero and names the process id the holder recorded and the command that checks it

#### Scenario: The data root is left as found

- **WHEN** a server refuses a held data root
- **THEN** the holder's lock and its record are unchanged

## REMOVED Requirements

### Requirement: A locked data root is explained to the operator

**Reason**: A lock no longer outlives the server that held it, so there is no stale lock to explain or remove. "A held data root is explained to the operator" covers the one case left, a running holder.
**Migration**: None. An operator who removed `.terminay-server.lock` after a kill no longer needs to; the next start proceeds.
