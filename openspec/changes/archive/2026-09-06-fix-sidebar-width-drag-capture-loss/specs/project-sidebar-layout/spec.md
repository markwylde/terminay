## MODIFIED Requirements

### Requirement: Pointer gesture handling

Resize handling SHALL support pointer capture, SHALL prevent text selection and native dragging, and SHALL keep window-level listeners for the gesture. This SHALL apply to every resize separator in the sidebar, including the sidebar width separator, whose handle also moves with its preview. Losing capture because the separator moved with the preview SHALL NOT cancel the resize, and pointer-up SHALL still commit it. `pointercancel`, window blur, hidden visibility, and unmount SHALL cancel it.

#### Scenario: Capture lost by preview movement

- **WHEN** the separator moves with the preview and pointer capture is lost
- **THEN** the resize continues and pointer-up still commits it

#### Scenario: Sidebar width capture lost mid-drag

- **WHEN** pointer capture is lost during a sidebar width drag while the pointer is still held
- **THEN** the sidebar keeps following the pointer, and releasing it commits the dragged width through one project-scoped sidebar update

#### Scenario: Gesture aborted

- **WHEN** `pointercancel`, window blur, hidden visibility, or unmount occurs during a resize
- **THEN** the resize is cancelled

#### Scenario: Text selection suppressed

- **WHEN** a resize gesture is in progress
- **THEN** text selection and native dragging are prevented
