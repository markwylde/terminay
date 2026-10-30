## ADDED Requirements

### Requirement: Git command reports on Windows

On Windows, the terminals Terminay launches SHALL name a Trace2 event target
that is a directory, not a socket. The directory SHALL be private to the server
and user, SHALL grant access to the current user only, and SHALL have an
address derived from the data directory, so that a terminal kept across a
server restart still reports to the next server. The server SHALL observe the
directory for new files rather than polling it. It SHALL parse each file as Git
writes it, bound every line and every file, and delete the file once it is
consumed or exceeds the bound. Nothing parsed SHALL be kept beyond the event it
describes. A report SHALL be handled with the same trust as one received on a
socket: it can say that a command ran in a session, it never supplies a path,
project, or folder to act on, and a token the server did not issue is ignored.

#### Scenario: A PowerShell terminal creates a worktree

- **WHEN** Git for Windows runs `git worktree add` in a PowerShell terminal of
  the project and the capture setting is on
- **THEN** that terminal moves into the new worktree's folder, as it would on
  macOS or Linux

#### Scenario: Files do not accumulate

- **WHEN** many Git commands run in Terminay terminals over a working day
- **THEN** the directory holds only the files of commands that are still being
  read, and every consumed file has been deleted

#### Scenario: The server is not running

- **WHEN** Git runs in a held terminal while no server is attached
- **THEN** Git completes normally, and the next server deletes the files it
  finds and does not attribute commands from before it started

#### Scenario: Forged report

- **WHEN** another process writes a file into the directory naming a session
  token the server did not issue
- **THEN** no terminal is attributed and the file is deleted
