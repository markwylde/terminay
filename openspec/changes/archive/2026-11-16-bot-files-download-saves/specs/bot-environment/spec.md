## ADDED Requirements

### Requirement: Files downloads

Download SHALL be offered for every file and folder in Environment › Files that is not a credential link, including dotfiles, empty files, and names with any characters the home allows. A file SHALL be saved under its own name and a folder as a `<name>.tar` archive; a name the local filesystem cannot take SHALL be suggested in a safe form. In Desktop, the save SHALL go through the host save of connections-and-client-hosts: the user chooses the destination before any bytes are transferred, and the bytes stream from the Files helper. In a browser, the download SHALL use the browser's own download flow. A download that fails SHALL show its error in the view and SHALL never fail silently. Cancelling the save dialog SHALL show no error.

#### Scenario: Download a file in Desktop

- **WHEN** a user chooses Download on `notes.txt` in Desktop and picks a destination in the save dialog
- **THEN** a file with the same bytes as `notes.txt` is saved at that destination

#### Scenario: Download a folder in Desktop

- **WHEN** a user chooses Download on the folder `project` in Desktop and picks a destination
- **THEN** a `project.tar` archive of that folder is saved at that destination

#### Scenario: Download a dotfile

- **WHEN** a user chooses Download on `.env`
- **THEN** the save dialog suggests `.env` and the saved file has its bytes

#### Scenario: Cancel the save dialog

- **WHEN** a user chooses Download in Desktop and cancels the save dialog
- **THEN** nothing is read from the bot's home, nothing is written, and no error is shown

#### Scenario: Download fails part way

- **WHEN** a download's transfer fails after the user picked a destination
- **THEN** the view shows the error, no new file is left at or beside the destination, and a file the user chose to replace keeps its original contents

#### Scenario: Download in a browser

- **WHEN** a user chooses Download on a file or folder in a browser
- **THEN** the browser's own download flow receives the file, or `<name>.tar` for a folder
