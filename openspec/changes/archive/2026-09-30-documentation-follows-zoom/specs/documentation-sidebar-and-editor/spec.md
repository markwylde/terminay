## ADDED Requirements

### Requirement: Documentation follows desktop zoom

The Documentation editor SHALL follow the desktop zoom level that Zoom In, Zoom Out, and Reset Zoom set for terminals. Each zoom step SHALL scale rich text, source mode, and diff mode text by the same proportion it scales a default-sized terminal, and the reading column's maximum width SHALL scale with it. A Documentation tab opened after the zoom level changed SHALL start at the current level. Editor toolbars SHALL keep their size.

#### Scenario: Zooming in on a document

- **WHEN** a Documentation tab is open and the user invokes Zoom In
- **THEN** the document text grows

#### Scenario: Resetting zoom

- **WHEN** the user invokes Reset Zoom after zooming a document
- **THEN** the document text returns to its default size

#### Scenario: Opening a document while zoomed

- **WHEN** the user opens a document after zooming out
- **THEN** the document opens at the zoomed-out size
