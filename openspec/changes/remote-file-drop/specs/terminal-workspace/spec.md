## MODIFIED Requirements

### Requirement: File drop behaviour

Dropping operating-system files onto a Desktop terminal whose server is this machine's own Local server SHALL insert their native paths without copying the files. Dropping files onto any other terminal, from Desktop or from a browser client, SHALL copy each file to the server that runs the terminal and insert the shell-escaped server paths. A client-local path SHALL NOT be inserted into a terminal whose server is not Local, and browser clients SHALL NOT receive or infer a local absolute path.

Terminay Server SHALL write dropped files into a server-owned scratch directory, `terminay-drops` inside the server's per-account scratch root under the process temporary directory, in a folder it creates for that drop, keeping a sanitised form of each file's offered name. The client SHALL supply only names and bytes, never a destination. The upload SHALL be authorised for the same project and terminal session that will receive the paths. It SHALL travel in bounded, ordered parts so that neither side holds a whole file, and SHALL have no total size limit.

While files upload, the terminal SHALL show the upload's progress with a Stop control. Nothing SHALL be inserted until every file has arrived. A stopped, failed or abandoned upload SHALL insert nothing, and the server SHALL remove its partial files. A dropped folder, or a server that cannot receive dropped files, SHALL produce a visible failure message and insert nothing.

#### Scenario: Desktop file drop

- **WHEN** operating-system files are dropped onto a Desktop terminal whose server is Local
- **THEN** their native paths are inserted and the files are not copied

#### Scenario: Desktop file drop on a remote terminal

- **WHEN** operating-system files are dropped onto a Desktop terminal whose server is remote
- **THEN** each file is uploaded into a per-drop folder under the server's `terminay-drops` scratch directory, keeping its name
- **AND** the shell-escaped server paths are inserted once every file has arrived
- **AND** the Desktop machine's native paths are not inserted

#### Scenario: Browser file drop

- **WHEN** browser-local files are dropped onto a web terminal
- **THEN** each file is uploaded into the server's `terminay-drops` scratch directory, not into the project
- **AND** the shell-escaped server paths are inserted
- **AND** the browser client receives no local absolute path

#### Scenario: Stopping a drop upload

- **WHEN** the user activates the upload indicator's Stop control before every file has arrived
- **THEN** nothing is inserted into the terminal
- **AND** the server removes the files it had partially written

#### Scenario: Dropping a folder on a remote terminal

- **WHEN** a folder is dropped onto a terminal whose server is not Local
- **THEN** a failure message is shown and nothing is inserted

#### Scenario: Server that cannot receive dropped files

- **WHEN** files are dropped onto a remote terminal whose server does not advertise `terminal-file-drop.v1`
- **THEN** a failure message is shown and no path is inserted
