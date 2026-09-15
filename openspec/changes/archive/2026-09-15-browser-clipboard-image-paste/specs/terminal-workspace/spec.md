## MODIFIED Requirements

### Requirement: Desktop clipboard preference order

On Desktop, a user-initiated terminal paste SHALL prefer copied file paths, then text, then convert an image-only clipboard item into a PNG in Terminay's temporary clipboard directory and insert its shell-escaped path. Clipboard images and their temporary paths SHALL be read and created only by Electron. A browser client SHALL paste non-empty clipboard text as text, and SHALL materialise an image-only clipboard on the server into a server-owned clipboard directory and insert its shell-escaped path.

#### Scenario: Image-only clipboard on Desktop

- **WHEN** a Desktop user pastes with only an image on the clipboard
- **THEN** Electron writes a PNG into Terminay's temporary clipboard directory and inserts its shell-escaped path

#### Scenario: Browser paste

- **WHEN** a browser client pastes into a terminal
- **THEN** non-empty clipboard text is pasted as text
- **AND** an image-only clipboard is written under the server-owned clipboard directory and its shell-escaped path is inserted

## ADDED Requirements

### Requirement: Browser clipboard image paste

A user-initiated paste in a browser client SHALL prefer non-empty clipboard text, then an image. When the clipboard holds an image and no usable text, Terminay Server SHALL write the bytes into a server-owned clipboard directory — `terminay-clipboard` under the process temporary directory, which is `/tmp/terminay-clipboard` on typical Unix hosts — under a server-chosen name, and the client SHALL insert the shell-escaped absolute server path into the focused terminal. The client SHALL NOT choose the destination path, SHALL NOT write the file into the project, and SHALL NOT receive a browser-local filesystem path.

The read SHALL happen inside the user activation that requested it (`navigator.clipboard.read()` from the Paste control, or the trusted `paste` event's image files). A pointer-activated Paste control SHALL issue the read from the event that carries activation for its pointer type, which for touch is `pointerup`. Where the host exposes only a text clipboard route, the Paste control SHALL still paste text. The mobile accessory Paste control, a native paste into the terminal, and the terminal context-menu paste SHALL share this behaviour. Desktop Electron paste is out of scope for this requirement.

The upload SHALL be authorized for the same project and terminal session that will receive the path, SHALL reject a body larger than 8 MiB, and SHALL accept PNG, JPEG, WebP, and GIF. A denied clipboard permission, an empty clipboard, an unsupported type, or a failed upload SHALL NOT insert a path.

A browser may refuse a programmatic clipboard read outright, and a terminal offers the platform no editable element to raise its own paste control over. When the read is refused, Terminay SHALL offer a focused editable field through which the user can complete the paste using the platform's own paste control, and a paste into that field SHALL reach the terminal through the same preference order and server materialisation as any other browser paste. A refused read SHALL NOT be reported as terminal output.

#### Scenario: iOS Safari screenshot via Paste

- **WHEN** a browser user activates the terminal Paste control with an image-only screenshot on the iOS Safari clipboard
- **THEN** the image is read inside that user activation
- **AND** Terminay Server writes it under the server-owned clipboard directory
- **AND** the shell-escaped absolute server path is inserted into the focused terminal

#### Scenario: Native paste event with an image

- **WHEN** a browser user pastes an image into the terminal through the platform paste gesture
- **THEN** the image is taken from the paste event
- **AND** Terminay Server writes it under the server-owned clipboard directory
- **AND** the shell-escaped absolute server path is inserted into the focused terminal

#### Scenario: Text still wins

- **WHEN** a browser user pastes and the clipboard holds non-empty text
- **THEN** the text is pasted
- **AND** no clipboard image is uploaded

#### Scenario: Client cannot choose the path

- **WHEN** a browser client materialises a clipboard image
- **THEN** the server chooses the directory and file name
- **AND** the file is not written into the selected project

#### Scenario: Oversized or unsupported clipboard image

- **WHEN** a browser clipboard image exceeds 8 MiB or is not PNG, JPEG, WebP, or GIF
- **THEN** the server rejects the upload
- **AND** no path is inserted into the terminal

#### Scenario: Clipboard permission denied

- **WHEN** the browser refuses the clipboard read
- **THEN** no path is inserted
- **AND** nothing is written to the terminal as output
- **AND** a focused editable field is offered so the user can complete the paste with the platform's own paste control

#### Scenario: Paste completed through the offered field

- **WHEN** the user pastes an image into the field offered after a refused read
- **THEN** Terminay Server writes it under the server-owned clipboard directory
- **AND** the shell-escaped absolute server path is inserted into the focused terminal
- **AND** the field is dismissed and the terminal regains input focus
