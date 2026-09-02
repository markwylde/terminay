## ADDED Requirements

### Requirement: Documentation panel height allocation

The Documentation panel SHALL allocate its available height only to the surfaces it is currently presenting. When no live preview is displayed, the editing surface — toolbar and reading canvas together — SHALL occupy the panel's full available height at every viewport size, and the panel SHALL NOT reserve height for an absent preview. The stacked arrangement used at narrow viewports SHALL apply only when the editor and a live preview are presented together, and the boundary drawn between them SHALL be present only in that arrangement.

#### Scenario: Markdown document at a phone-sized viewport

- **WHEN** a Documentation panel presenting only the editor is displayed at a phone-sized viewport
- **THEN** the editing surface fills the panel's available height, and its toolbar and reading canvas are visible and scrollable

#### Scenario: Editor and preview at a narrow viewport

- **WHEN** a Documentation panel presenting both the editor and a live preview is displayed at a narrow viewport
- **THEN** the editor and the preview stack vertically, each retaining usable height, separated by a visible boundary

#### Scenario: No boundary without a preview

- **WHEN** a Documentation panel presents the editor without a live preview
- **THEN** no editor-to-preview boundary is drawn, at any viewport size
