## Why

A person opening a folder from the OS can land on the old project with the new one sitting unopened behind it, text typed into a reopened project editor can go to the terminal's shell, and a project edit can be silently undone by the save before it. Both defects, plus two CI infrastructure limits, make `main` and pull requests fail or pass only on retry.

Evidence from the 60 CI runs since 2026-11-14 and a Docker run with retries off (15 repeats each):

- The folder-launch test failed 10 of 15 runs and passed only on retry in 12 CI jobs. Its captured error is `That project is not open in this window`.
- The recent-folder chooser test failed 6 of 15 runs and passed only on retry in 12 CI jobs. Its failure screenshot shows the typed folder path in the terminal's shell prompt, because a finished edit took focus from the editor opened after it.
- `main` at `2cfeb059` failed because a cold bot image build reached the driver's fixed 10-minute limit during `apt`.
- Three failed `main` jobs in the sampled history were npm `ECONNRESET` during install.

## What Changes

- A view request naming a project waits, within the existing render wait and a shared 9-second deadline, for that project to reach the window before it is refused.
- A finished project edit returns focus to the terminal only if no newer editor has opened.
- Saves of one project's editor apply in order, rebuild and retry a stale request up to four attempts, and cannot change a root the person left unchanged.
- The bot image build gets 20 minutes, and its job timeout and watchdog get 30.
- CI dependency installs retry transient registry failures three times within larger install bounds.
- The E2E tests listed in `tasks.md` are repeated with retries off after these fixes, and each one still failing gets a root-cause fix. Playwright retries, assertion timeouts and skips are not raised to hide a failure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-workspace-view`: a view request tolerates a project that is still reaching the window.
- `workspace-and-project-tabs`: saving a project edit preserves the latest committed root and every save.
- `pull-request-ci`: cold image builds and transient registry failures do not fail a run.

## Impact

- Renderer: `src/workspace/useWorkspaceViewController.ts`, `src/workspace/useProjectEditor.ts`.
- CI: `scripts/run-bot-mcp-real-tests.mjs`, `scripts/install-ci-dependencies.sh`, `.gitea/workflows/ci.yml` and their contract tests.
- E2E: specs or helpers only where measurement shows a remaining test defect.
- No protocol, persistence, privilege or scope change.
