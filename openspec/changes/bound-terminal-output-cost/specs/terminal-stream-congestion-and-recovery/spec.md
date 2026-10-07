## MODIFIED Requirements

### Requirement: Server continues consuming PTY output

The server SHALL continue consuming PTY output into its bounded replay and canonical checkpoint state when a renderer cannot keep up. It SHALL NOT indefinitely buffer the lifetime transcript, pause unrelated terminal sessions, or block the PTY merely to preserve obsolete intermediate repaints for one display.

Retaining an output event SHALL cost work proportional to the bytes of that event. It SHALL NOT cost work proportional to the bytes already retained or to the number of chunks already retained, in the terminal service's replay or in any host-side copy of recent output. A retained copy of recent output SHALL be assembled into one contiguous value only when it is read. Keeping a retention bound SHALL NOT change which bytes are retained: a bounded copy of recent output holds exactly the most recent bytes up to its bound, in order.

#### Scenario: Renderer falls behind

- **WHEN** one renderer cannot keep up with PTY output
- **THEN** the server keeps consuming output into bounded replay and checkpoint state without blocking the PTY or pausing other sessions

#### Scenario: Output arrives in many small chunks

- **WHEN** a terminal whose replay is full receives a small output event, once with the replay held as a few hundred chunks and once with the same bytes held as tens of thousands of chunks
- **THEN** retaining the event costs the same order of work in both cases

#### Scenario: Output arrives after a megabyte is retained

- **WHEN** a terminal receives a small output event, once with a few kilobytes of recent output retained and once with the full retention bound retained
- **THEN** observing the event costs the same order of work in both cases

#### Scenario: Recent output is read

- **WHEN** recent output is read after many small events have displaced older output
- **THEN** the value read is exactly the most recent bytes up to the retention bound, in the order they were produced
