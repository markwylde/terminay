## 1. Model

- [x] 1.1 Add `worktree` facts to `WorkspaceInventoryEntry` and `worktreeFactsFromProperties`, and carry them onto `DashboardPanelRow`. Verified by new cases in `scripts/dashboard-agent-model.test.mjs`.
- [x] 1.2 Stamp the folder's facts on every inventory entry a folder workspace publishes, republishing when they change by value. Verified by `npx tsc --noEmit -p .` exiting zero.

## 2. Presentation

- [x] 2.1 Render read-only pull request and checks chips on agent cards, panel cards, and List rows, worded by `worktreePropertyPresentation.ts`.

## 3. Specs and delivery

- [x] 3.1 Run `openspec validate dashboard-cards-show-pull-request --strict`.
- [ ] 3.2 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
