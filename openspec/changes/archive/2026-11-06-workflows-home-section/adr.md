# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (with Mark Wylde)
- Change: workflows-home-section

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - the section only reads workflows and opens their terminal; it never changes a step or writes to a terminal.
- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md - templates only; the section reads no templates.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - the Workflows section is a Home tab, and its view options are device-local presentation state like the tab arrangement.
- openspec/adr/0047-a-window-is-bound-to-one-server-desktop-runs-its-packaged-bundle-for-it-with-compatibility-negotiated-by-the-protocol.md - a window is one server; the section shows only the window's server's workflows and never aggregates.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - workflows are shown per attached connection and never merged across servers; visibility comes from what each connection already serves.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The section is a renderer-side join of two projections the client already holds (workflows and the dashboard inventory). It adds no authority path: opening a terminal reuses the dashboard's activation.
