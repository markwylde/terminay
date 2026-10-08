## ADDED Requirements

### Requirement: Window data

A window record SHALL be able to hold one JSON value supplied when the window is shown, bounded to 64 KiB when serialised. For an agent-authored view the host SHALL expose that value to the document as a read-only `data` member of the provided script interface, available before any script the author wrote runs, and SHALL expose `undefined` when the window has none. The value SHALL reach the document as data only: no part of it SHALL be interpreted as markup or script by the host. Replacing a window's content SHALL replace its data, and a replacement that supplies none SHALL leave the window with none.

#### Scenario: A document reads its data

- **WHEN** an agent shows a window with a document whose first script reads the provided `data` member, and with data `{"questions": ["Ship it?"]}`
- **THEN** the script reads an object whose `questions` holds "Ship it?"

#### Scenario: Data that looks like markup

- **WHEN** a window's data contains the string `</script><script>alert(1)</script>`
- **THEN** the document reads that exact string from `data` and no script from the data runs

#### Scenario: No data

- **WHEN** an agent shows a window without data
- **THEN** the document reads `data` as undefined

#### Scenario: Content replaced without data

- **WHEN** an agent replaces the content of a window that had data and supplies none
- **THEN** the new document reads `data` as undefined

### Requirement: A window message carries attachments

The script interface of an agent-authored view SHALL let a message for the conversation carry files the person chose in the view. Attachments SHALL travel only as part of a window message and SHALL be subject to everything a window message is subject to: the user's gesture, an open window, the presentation lease, and the Window Messages policy. A message SHALL carry at most 16 attachments. A message that carries at least one attachment MAY have empty text.

The server SHALL write each attachment as a regular file in a scratch directory it owns under the system temporary directory, readable and writable by the server's user only and never executable. The server SHALL choose each file's name: a random component followed by the offered name reduced to letters, digits, dot, hyphen, and underscore, keeping its extension. The server SHALL accept bytes and an offered name only, SHALL NEVER accept a destination path, and SHALL NEVER write an attachment anywhere else. An attachment MAY be of any type and the server SHALL NEVER execute or interpret one.

When every attachment of a message is written, the server SHALL type the message into the owning terminal as one paste submitted once: the message text, then one line per attachment giving its absolute path. The 16 KiB bound SHALL apply to the text the view supplied and not to the path lines. The view SHALL be told only that the message was delivered or refused, and SHALL NEVER be given a path. If any attachment cannot be written, nothing SHALL be typed, every file already written for that message SHALL be removed, and the view SHALL be told the message failed.

#### Scenario: A photo with an answer

- **WHEN** the person picks a photo in a window of Terminal 1 and presses a button that sends "2. Use the new logo? Yes" with that photo
- **THEN** Terminal 1 receives one paste holding that text and one line with the path of a file in the server's scratch directory, submitted once, and the file's bytes are the photo's

#### Scenario: The view names a destination

- **WHEN** a view offers an attachment whose name is `../../.ssh/authorized_keys`
- **THEN** the file is written inside the scratch directory under a server-chosen name, and no file outside that directory is created or changed

#### Scenario: Attachments without a gesture

- **WHEN** a view sends a message with an attachment as it loads, before the person has touched it
- **THEN** nothing is uploaded, nothing is written to disk or to the terminal, and the view is told the person is not using the window

#### Scenario: Attachments from an observer

- **WHEN** an attachment upload arrives from a client that does not hold the terminal's presentation lease
- **THEN** it is refused and nothing is written to disk or to the terminal

#### Scenario: Attachments only

- **WHEN** a view sends a message with one attachment and empty text
- **THEN** the terminal receives one paste holding the attachment's path line, submitted once

#### Scenario: Disk full part way

- **WHEN** the second of two attachments cannot be written
- **THEN** nothing is typed into the terminal, the first file is removed, and the view is told the message failed

#### Scenario: Seventeen attachments

- **WHEN** a view sends a message with seventeen attachments
- **THEN** it is refused before anything is uploaded

#### Scenario: The view asks where the file went

- **WHEN** a message with an attachment is delivered
- **THEN** the result the view receives contains no path

### Requirement: Attachments are streamed and have no size limit

An attachment SHALL have no size limit. It SHALL travel from the view to the server in parts of at most 256 KiB, each acknowledged before the next is sent, and the server SHALL write each part to disk as it arrives, so that neither the workspace nor the server holds a whole attachment in memory. Progress SHALL be driven by acknowledgements and never by a timer. An upload that is abandoned, because the window closes, the client loses the presentation lease, or the connection ends, SHALL leave no partial file.

#### Scenario: A file larger than memory budgets

- **WHEN** a view sends a message with a 200 MiB attachment
- **THEN** the file arrives complete in the scratch directory and no single protocol message carried more than 256 KiB of it

#### Scenario: Window closed during upload

- **WHEN** the person closes a window while its attachment is uploading
- **THEN** the upload stops, the partial file is removed, and nothing is typed into the terminal

#### Scenario: Takeover during upload

- **WHEN** another client takes control of the terminal while an attachment is uploading
- **THEN** the upload stops, the partial file is removed, and nothing is typed into the terminal

### Requirement: Large attachments are confirmed by the person

When the attachments of one message total more than 8 MiB, the window frame SHALL ask the person to confirm before any byte is uploaded, stating the number of files and their total size. The confirmation SHALL be drawn by the workspace outside the view, so a view can neither draw it nor answer it. Declining SHALL send nothing, SHALL leave the window open and unchanged, and SHALL tell the view the message was not sent. While attachments upload, the window frame SHALL show that they are uploading and SHALL let the person cancel.

#### Scenario: A 30 MiB video

- **WHEN** a view sends a message with a 30 MiB attachment
- **THEN** the window frame asks the person to confirm sending one file of 30 MiB, and nothing is uploaded until they do

#### Scenario: Declined

- **WHEN** the person declines the confirmation
- **THEN** nothing is uploaded or typed, the window stays open with its content unchanged, and the view is told the message was not sent

#### Scenario: A small photo

- **WHEN** a view sends a message with a 3 MiB attachment
- **THEN** it uploads without a confirmation

#### Scenario: Cancelled part way

- **WHEN** the person cancels while an attachment is uploading
- **THEN** the upload stops, the partial file is removed, nothing is typed, and the view is told the message was not sent

### Requirement: Attached files outlive their terminal session

A file written for an attachment SHALL remain after its message is delivered, after its window closes, and after its terminal session ends. Terminay SHALL NOT remove a delivered attachment; it stays until the operating system clears the temporary directory or the person removes it.

#### Scenario: Terminal closed after an attachment

- **WHEN** a terminal session ends after a window in it delivered a message with an attachment
- **THEN** the attached file still exists at the path that was typed

### Requirement: Attachments are a negotiated capability

Attachments SHALL be offered only on a connection that negotiated the app-window attachments capability. The script interface SHALL tell an agent-authored view whether attachments are available through a boolean `attachments` member. Where they are not, a message that carries files SHALL be refused before anything is sent, with an error that says attachments are unavailable, and a message without files SHALL behave as it always does.

#### Scenario: Server without the capability

- **WHEN** a view on a connection without the capability sends a message with a file
- **THEN** the call is refused with an attachments-unavailable error, and nothing is uploaded or typed

#### Scenario: View checks first

- **WHEN** a view on a connection without the capability reads the `attachments` member
- **THEN** it reads false
