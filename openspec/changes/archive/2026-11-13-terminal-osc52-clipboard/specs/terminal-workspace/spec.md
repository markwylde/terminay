## ADDED Requirements

### Requirement: Program clipboard writes through OSC 52

A terminal SHALL honour an OSC 52 clipboard write in live program output by writing its decoded text to the clipboard of the device showing the terminal: through the presentation bridge on Desktop, and through the Clipboard API in a browser. Every OSC 52 target SHALL write the one system clipboard. The sequence SHALL never be drawn as text.

#### Scenario: A program on a remote server copies

- **WHEN** a program on a remote server writes `ESC ] 52 ; c ; <base64 of "hello"> BEL` while a Desktop window shows its terminal
- **THEN** the Desktop's clipboard holds `hello`

#### Scenario: Multi-line text

- **WHEN** a program copies text containing tabs and line breaks
- **THEN** the clipboard holds that text unchanged

#### Scenario: The browser refuses

- **WHEN** a browser refuses the clipboard write
- **THEN** the terminal keeps rendering output and accepting input

### Requirement: Program clipboard writes are write-only, live-only and bounded

A terminal SHALL never answer an OSC 52 query and SHALL never write anything to the PTY because of an OSC 52 sequence. Output replayed on attach, on reconnect, from a checkpoint or from a recording SHALL never write the clipboard. A request SHALL be ignored when its payload is empty, is not valid base64, is not UTF-8 text, decodes to more than 1 MiB, or contains a control character other than tab, line feed and carriage return.

#### Scenario: A program asks to read the clipboard

- **WHEN** a program writes `ESC ] 52 ; c ; ? BEL`
- **THEN** nothing is written to the PTY and the clipboard is unchanged

#### Scenario: Reattaching to a terminal that copied earlier

- **WHEN** a client attaches or reconnects to a terminal whose history contains an OSC 52 write
- **THEN** the clipboard is not written

#### Scenario: Text with an escape sequence

- **WHEN** a program writes an OSC 52 request whose decoded text contains an ESC character
- **THEN** the clipboard is unchanged

#### Scenario: An empty request

- **WHEN** a program writes `ESC ] 52 ; c ; BEL`
- **THEN** the clipboard is unchanged
