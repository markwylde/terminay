## ADDED Requirements

### Requirement: Server storage failures are named to the client

When a client protocol command fails because the server's storage refused a
filesystem operation, the server SHALL return a structured error that names the condition, and SHALL NOT
return a generic command failure. The error SHALL carry a stable
`details.reason`:

| Condition | Code | `details.reason` | Message | Retryable |
| --- | --- | --- | --- | --- |
| No space left | `unavailable` | `storage_full` | The server's disk is full | yes |
| Disk quota exceeded | `resource` | `storage_quota_exceeded` | The server's disk quota is exceeded | yes |
| Read-only filesystem | `unavailable` | `storage_read_only` | The server's storage is read-only | no |
| Permission refused inside the server data root | `unavailable` | `storage_permission` | The server does not have permission to access its data folder | no |
| Permission refused elsewhere | `unavailable` | `storage_permission` | The server does not have permission to access that file or folder | no |

The condition SHALL be recognised when a server service wraps the underlying
system error in its own failure, including a command that reports failure inside
its result. Only a refused filesystem operation SHALL be reported this way: an
exhausted file-watch limit, a refused process signal and a refused program launch
SHALL NOT. The error SHALL NOT carry a filesystem path or the platform's error
text; the server SHALL log the underlying error for its operator. A storage
failure SHALL remain distinct from an authorization failure.

A refusal that an operation defines for itself, such as a project start whose
chosen folder cannot be read or a vault operation's sanitized failure, SHALL
stay as that operation defines it. Queries
and the output of programs the server runs, such as Git, are not classified.

#### Scenario: Full disk while saving the workspace

- **WHEN** a command that commits workspace state fails because the disk is full
- **THEN** the client receives `unavailable` with the message "The server's disk is full", reason `storage_full` and retryable set

#### Scenario: Disk quota exceeded

- **WHEN** a command's write is refused because the disk quota is exceeded
- **THEN** the client receives `resource` with reason `storage_quota_exceeded` and retryable set

#### Scenario: Read-only storage

- **WHEN** a command's write is refused because the filesystem is read-only
- **THEN** the client receives reason `storage_read_only` with retryable unset

#### Scenario: Permission refused in the data root

- **WHEN** a command's write to a path inside the server data root is refused for lack of permission
- **THEN** the message names the server's data folder and carries no path

#### Scenario: Permission refused outside the data root

- **WHEN** a command's file operation outside the server data root is refused for lack of permission
- **THEN** the message names the file or folder generically and does not mention the data folder

#### Scenario: Wrapped failure in a file save

- **WHEN** a file save fails because the disk is full
- **THEN** the command fails with reason `storage_full` and the retained draft is unchanged

#### Scenario: Device without scope

- **WHEN** a device without write scope sends a command while the disk is full
- **THEN** it receives the authorization error, not a storage failure

#### Scenario: Deliberate project start refusal

- **WHEN** a project start names a folder the server account cannot read
- **THEN** the command keeps the project start refusal and its reason

#### Scenario: Nothing is committed

- **WHEN** a workspace command fails with a server storage failure
- **THEN** the workspace revision is unchanged and no workspace change is published

#### Scenario: Watch limit is not a full disk

- **WHEN** a command fails because the system's file-watch limit is exhausted
- **THEN** the client is not told the disk is full

### Requirement: Clients present server storage failures as sent

A client SHALL present a server storage failure with the server's message. It
SHALL NOT replace that message with connection-loss, reconnect, access-denied or
unsupported-operation wording, and SHALL NOT hide the failure while treating it
as a transport failure.

#### Scenario: Creating a project on a full disk

- **WHEN** a person creates a project and the server answers that its disk is full
- **THEN** the person sees "The server's disk is full"

#### Scenario: Feature failure on a full disk

- **WHEN** a project feature's operation fails with a server storage failure
- **THEN** its failure notice states the server's message and does not ask the person to reconnect

#### Scenario: Project root update on a full disk

- **WHEN** a project root update fails with a server storage failure
- **THEN** the person is not told the server lacks support for root updates
