## 1. Hide the rail behind the overlay

- [x] 1.1 In `WorkflowPanel.tsx`, render `WorkflowRail` only while the narrow-pane overlay is closed. Verify: `npx tsc --noEmit` and `npm run lint` pass.
- [x] 1.2 In `WorkflowPanel.css`, give `.workflow-overlay` `z-index: 2`. Verify: lint passes. Screenshot from 2.1 shows no marker over the overlay.

## 2. Tests

- [x] 2.1 Extend `e2e/workflows-narrow.spec.ts` to cover each close path. While the overlay is open, the panel has no `.workflow-rail`, no rail markers and no "Expand workflow" button. After Escape, after the collapse control, and after focusing the terminal, the rail is back, the terminal keeps its width, and the setting is unchanged. Widening the window with the setting expanded closes the overlay and shows the expanded panel with no rail. Capture screenshots of the overlay and of the restored rail. Verify: `npm run test:e2e -- e2e/workflows-narrow.spec.ts` passes in Docker.
- [x] 2.2 Run `npx tsc --noEmit`, `npm run lint` and `npm run test:workflow-ui`. Verify: each exits 0.

## 3. Spec

- [x] 3.1 Run `openspec validate workflow-overlay-hides-rail` and `openspec validate --all`. Verify: the change is valid, and `--all` shows no failures beyond the 7 pre-existing failures in other changes (add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, server-notification-manager, unified-settings-window).
- [x] 3.2 After verification, archive the change so the delta folds into `openspec/specs/terminal-workflows/spec.md`. Verify: `openspec validate --all --archived` reports no failures in `terminal-workflows` or in the archived change beyond the baseline.
- [x] 3.3 Open the PR on Gitea and read back every CI status on the head SHA. Verify: each status is `success` or `skipped`.
