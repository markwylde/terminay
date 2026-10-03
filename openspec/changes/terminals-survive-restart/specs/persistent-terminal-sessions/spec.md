## ADDED Requirements

### Requirement: Terminal sessions outlive the server process

A terminal session's shell and PTY SHALL be owned by a session holder process
that is separate from the server process and from every connection host. The
session holder SHALL keep its sessions running when the server process exits
for any reason, including a graceful quit, an update, and a crash. Exactly one
session holder generation SHALL accept new sessions for a server data root at a
time.

#### Scenario: Server exits while a command is running

- **WHEN** the server process exits while a terminal is running a command
- **THEN** the command keeps running and its PTY stays open

#### Scenario: Desktop crashes

- **WHEN** Terminay Desktop terminates unexpectedly
- **THEN** every terminal session of its Local server keeps running in the
  session holder

#### Scenario: No session holder is left without sessions

- **WHEN** the last session of a session holder ends and no server is attached
- **THEN** the session holder exits

### Requirement: A starting server reattaches to live sessions

A server that starts on a data root SHALL reattach to every session its session
holder still has, before the workspace is shown. A reattached session SHALL keep
its session identity, shell process, working directory, dimensions, and output
position, and SHALL be presented as running. Reattaching SHALL NOT send input to
the shell or start a new process.

#### Scenario: Restart with live sessions

- **WHEN** a server starts and its session holder has three live sessions
- **THEN** those three sessions are running in the workspace under their
  original session identities and no new shell is started for them

#### Scenario: Client resubscribes after a server restart

- **WHEN** a client resubscribes to a reattached session with the output
  position it last acknowledged
- **THEN** it receives only the output after that position that is still
  buffered

### Requirement: Output is buffered while no server is attached

The session holder SHALL keep a bounded buffer of each session's most recent
output, and SHALL keep filling it while no server is attached. When output
exceeds the bound, the oldest output SHALL be dropped and the session's output
position SHALL still advance by every byte produced. After reattachment a
terminal panel SHALL show the buffered output, including output produced while
nothing was attached.

#### Scenario: Output produced during a restart

- **WHEN** a command prints output between the server exiting and the next
  server starting
- **THEN** the terminal panel shows that output after the restart

#### Scenario: Output exceeds the bound

- **WHEN** a session produces more output than the buffer bound while no server
  is attached
- **THEN** the oldest output is dropped, the most recent output up to the bound
  is shown after the restart, and the session keeps running

### Requirement: Unattached sessions end after a limit

The server SHALL have a server-owned setting for how long sessions keep running
with no server attached. Its default SHALL be 5 minutes, and it SHALL offer a
value that keeps sessions until the machine restarts. When the limit passes with
no server attached, the session holder SHALL end every session it holds and
exit. A server attaching before the limit SHALL cancel it.

#### Scenario: Limit passes

- **WHEN** no server has attached for longer than the configured limit
- **THEN** every held session is ended and the session holder exits

#### Scenario: Server returns in time

- **WHEN** a server attaches before the limit passes
- **THEN** no session is ended and the limit no longer runs

#### Scenario: Setting changed

- **WHEN** the setting is changed while a server is attached
- **THEN** the new limit applies the next time the server detaches

### Requirement: A session that ended while unattached keeps its panel

A terminal panel whose session ended while no server was attached SHALL be
restored in its place in the layout. It SHALL show the last output available for
that session and a notice, styled as an error, stating that the session has
ended and cannot be resumed. It SHALL show the exit code when one is known. It
SHALL NOT accept input and SHALL NOT be presented as running. Closing it SHALL
remove the panel.

#### Scenario: Shell exited during the restart

- **WHEN** a shell exits with code 0 between the server exiting and the next
  server starting
- **THEN** its panel is restored with its last output, its exit code, and the
  ended-session notice

#### Scenario: Limit passed before relaunch

- **WHEN** Terminay is relaunched after the unattached limit has passed
- **THEN** every terminal panel is restored in its place with its last output
  and the ended-session notice

#### Scenario: Session lost without a record

- **WHEN** a session is gone at restart and no output was saved for it
- **THEN** its panel is restored with the ended-session notice and no output

#### Scenario: Typing into an ended session

- **WHEN** a user types into a panel showing the ended-session notice
- **THEN** no input is sent and the notice remains

### Requirement: Last output of an ended session is saved, bounded, and removed with its panel

When a session ends with no server attached, or the session holder exits in an
orderly way, the last output of each affected session SHALL be saved under the
server data root, limited to the per-session buffer bound and readable only by
the account that owns the data root. Saved output SHALL be deleted when its
panel is closed. Output of a running session SHALL NOT be written to disk by
this capability.

#### Scenario: Machine shuts down

- **WHEN** the machine shuts down in an orderly way while sessions are held
- **THEN** each session's last output is saved before the session holder exits

#### Scenario: Panel closed

- **WHEN** a user closes a panel showing the ended-session notice
- **THEN** its saved output is deleted

#### Scenario: Running session

- **WHEN** a session is running and attached
- **THEN** none of its output is written to disk by this capability

### Requirement: Only the owning server reaches a session holder

A session holder SHALL accept connections only on a local socket inside its
server data root, readable and writable only by the account that owns the data
root, and only from a peer that presents the holder credential stored in that
data root with the same restriction. It SHALL NOT open a network listener. It
SHALL serve at most one attached server at a time. Renderer, browser, extension,
and MCP code SHALL NOT reach a session holder directly; every terminal command
SHALL pass through the server's authorization.

#### Scenario: Peer without the credential

- **WHEN** a local process connects to the holder socket without the holder
  credential
- **THEN** the connection is closed and no session is listed, read, or written

#### Scenario: Second server attaches

- **WHEN** a server attempts to attach while another server is attached
- **THEN** the attempt is refused and the attached server is unaffected

#### Scenario: Client terminal input

- **WHEN** a client sends terminal input
- **THEN** it reaches the session holder only through the server, after the
  server authorizes it for that session

### Requirement: A newer server version does not end existing sessions

Sessions started under one version of Terminay SHALL keep running after a newer
version starts on the same data root, and the newer server SHALL be able to
read, write, resize, signal, and end them. A session holder SHALL keep serving
its existing sessions after the installation it was started from is replaced or
removed. New sessions created after the newer version starts SHALL be owned by a
session holder of the newer version.

#### Scenario: Update installed

- **WHEN** Terminay restarts onto a newer version with five live sessions
- **THEN** all five sessions are running and interactive in the new version

#### Scenario: New terminal after an update

- **WHEN** a user opens a new terminal after the update while older sessions
  still run
- **THEN** the new session starts and the older sessions are unaffected

#### Scenario: Incompatible session holder

- **WHEN** a server cannot speak any protocol version a session holder offers
- **THEN** that holder's sessions are presented as ended with the ended-session
  notice, the holder is told to end them, and new sessions still start

### Requirement: Ending sessions is always explicit and complete

An explicit terminal-close command SHALL end that session's process in the
session holder. An end-all command SHALL end every session of the data root,
remove their terminal panels, and leave no session holder running. A project
whose root is removed SHALL NOT keep sessions running in a session holder.

#### Scenario: Closing a terminal

- **WHEN** a user closes a running terminal
- **THEN** its process ends in the session holder and no process of that
  session remains

#### Scenario: End all

- **WHEN** an end-all command completes
- **THEN** no terminal session, terminal panel, or session holder remains for
  that data root

### Requirement: Session-scoped integrations keep working after reattachment

A reattached session SHALL keep the agent status, MCP, and activity behaviour it
had before the restart. Environment the server injected into the shell at launch
SHALL remain valid for that session after any number of server restarts.
Foreground-process, working-directory, and activity observation SHALL resume for
a reattached session without input from the user.

#### Scenario: MCP from a reattached terminal

- **WHEN** a tool running in a reattached terminal calls the MCP endpoint named
  in its environment
- **THEN** the call is authorized as that terminal session

#### Scenario: Busy state after restart

- **WHEN** a reattached session is running a foreground command
- **THEN** it is shown as busy without the user interacting with it
