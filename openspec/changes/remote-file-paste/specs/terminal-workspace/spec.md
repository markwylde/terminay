## MODIFIED Requirements

### Requirement: Desktop clipboard preference order

On Desktop, a user-initiated paste into a terminal whose server is this machine's own Local server SHALL prefer copied file paths, then text, then convert an image-only clipboard item into a PNG in Terminay's temporary clipboard directory and insert its shell-escaped path. Clipboard images and their temporary paths SHALL be read and created only by Electron.

On Desktop, a user-initiated paste into a terminal whose server is not Local SHALL NOT insert a path from this machine. It SHALL prefer copied files, copying each to the terminal's server exactly as a dropped file is copied, with the same progress indicator and Stop control, and inserting the shell-escaped server paths once every file has arrived; then text, pasted as text; then an image-only clipboard, materialised on the server into the server-owned clipboard directory with its shell-escaped server path inserted. Electron SHALL read the copied files and SHALL give the renderer only their names, sizes and bounded parts of their contents, never their local paths. A copied folder, or a server that cannot receive files, SHALL produce a visible failure message and insert nothing.

A browser client SHALL paste non-empty clipboard text as text, and SHALL materialise an image-only clipboard on the server into a server-owned clipboard directory and insert its shell-escaped path.

#### Scenario: Image-only clipboard on Desktop

- **WHEN** a Desktop user pastes with only an image on the clipboard into a terminal whose server is Local
- **THEN** Electron writes a PNG into Terminay's temporary clipboard directory and inserts its shell-escaped path

#### Scenario: Copied file pasted into a remote terminal on Desktop

- **WHEN** a Desktop user pastes a copied file into a terminal whose server is remote
- **THEN** the file is uploaded into a per-drop folder under the server's `terminay-drops` scratch directory, keeping its name
- **AND** the shell-escaped server path is inserted once the file has arrived
- **AND** the Desktop machine's native path is not inserted

#### Scenario: Image-only clipboard pasted into a remote terminal on Desktop

- **WHEN** a Desktop user pastes with only an image on the clipboard into a terminal whose server is remote
- **THEN** the image is written under the server-owned clipboard directory and its shell-escaped server path is inserted

#### Scenario: Copied folder pasted into a remote terminal on Desktop

- **WHEN** a Desktop user pastes a copied folder into a terminal whose server is remote
- **THEN** a failure message is shown and nothing is inserted

#### Scenario: Browser paste

- **WHEN** a browser client pastes into a terminal
- **THEN** non-empty clipboard text is pasted as text
- **AND** an image-only clipboard is written under the server-owned clipboard directory and its shell-escaped path is inserted
