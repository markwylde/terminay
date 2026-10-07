## ADDED Requirements

### Requirement: Remote device connected fires once per device

The **Remote device connected** event trigger SHALL fire when a device that has no live connection to the server gains one. It SHALL NOT fire again for a further window of a device that is already connected, nor for a window that reconnects while another of the device's windows is live.

#### Scenario: First window of a device

- **WHEN** a device with no live connection connects a window
- **THEN** the trigger fires once, with that device as its subject

#### Scenario: A second window

- **WHEN** a device that already has a window connected connects another
- **THEN** the trigger does not fire
