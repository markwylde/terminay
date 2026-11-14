## ADDED Requirements

### Requirement: Install the latest release on a server's channel

A remote server's Updates page SHALL show an **Install latest on <channel>**
action, naming that server's installed channel and the latest release its status
names. The action SHALL be shown whenever the status names a latest release. It
SHALL be disabled, with the reason, when that release is the running one, when
an upgrade is in progress, or when the status says the server cannot install it.
For a server that cannot install it, the page SHALL show the reason and any
command the status gives, with a copy action. The page SHALL never show the
action for **Local**, whose Updates page sends the user to the Desktop Updates
page.

Choosing the action SHALL open the server upgrade confirmation. The
confirmation names the server, its running version, and the target version, and
states that the connection drops briefly and terminals keep running. When the
target is older, the confirmation SHALL say so and SHALL warn that state written
by the running release might not carry over. Nothing SHALL be sent until the
user confirms. Confirming SHALL send the upgrade request with `allowOlder` only
when the target is older, and in-progress and outcome reporting SHALL be those
of any server upgrade.

#### Scenario: Server ahead of its channel

- **WHEN** a remote server on `main` is ahead of the newest `main` build and the
  user chooses Install latest on main and confirms
- **THEN** the confirmation warned that the target is older, and the request
  sent carries the in-place mode and `allowOlder` and no version

#### Scenario: Newer release on the channel

- **WHEN** a remote server's status names a newer latest release
- **THEN** Install latest names it, its confirmation shows no downgrade warning,
  and the request sent carries no `allowOlder`

#### Scenario: Already the latest

- **WHEN** the server runs its channel's latest release
- **THEN** the action is disabled and says the server is already on the latest
  release of its channel

#### Scenario: Server cannot install the older release

- **WHEN** the status reports that the older release cannot be installed in place
- **THEN** the action is disabled, and the page shows the reason and the host
  command with a copy action

#### Scenario: Local server

- **WHEN** the user opens the Updates page of **Local**
- **THEN** no Install latest action is shown on it
