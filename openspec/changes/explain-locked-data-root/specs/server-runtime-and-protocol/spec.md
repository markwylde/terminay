## ADDED Requirements

### Requirement: A locked data root is explained to the operator

A standalone server that cannot take its data root because a lock is present SHALL NOT start, SHALL leave the lock as it found it, and SHALL exit with a non-zero status. It SHALL write to standard error a message that states that the data root is locked, names the data root and the lock file, gives the time the lock records when it records one, explains that a lock remains when a server is killed before it can remove it and that the server never removes one automatically, and gives the commands that check for another server and remove a stale lock. In the official container image those commands SHALL be expressed for containers and volumes and SHALL NOT refer to a process id. The message SHALL NOT include a stack trace.

#### Scenario: A container starts on a volume a killed container left locked

- **WHEN** the official image starts on a data volume that holds a lock from a container that was killed
- **THEN** the container exits non-zero and its log states that the data root is locked, names the lock file, and gives the commands to check for another container on the volume and to remove the lock

#### Scenario: A host server starts on a locked data root

- **WHEN** a standalone server outside a container starts on a data root that holds a lock
- **THEN** it exits non-zero and names the process id the lock records and the command that removes the lock

#### Scenario: The lock is left in place

- **WHEN** a server refuses a locked data root
- **THEN** the lock file is unchanged
