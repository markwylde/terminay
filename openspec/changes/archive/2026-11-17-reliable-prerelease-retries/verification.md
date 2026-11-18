# Verification

- 2026-11-17: 72 focused release tests passed under Node 24.15.0 with `--test-force-exit --test-timeout=120000`, bounded by a 150-second outer timeout.
- Regression fixtures add a stable tag after planning and verify unchanged retry versions and notes, including planning without any stable tag. Invalid and missing release bases fail closed.
- Packaging-script fixtures preserve exit 127 and builder diagnostics, reject missing feed metadata, and return only the next version on successful standard output.
- `openspec validate --all`: 124 passed, 7 failed. Baseline main: 123 passed, the identical 7 failed changes (add-terminay-bots, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window).
- [Gitea PR #634](https://git.i.wylde.net/markwylde/terminay/pulls/634): all 30 commit statuses succeeded for 1b21fc7b, including packaged macOS startup, Linux floor, Windows contract tests in the fast gate, and the Docker-isolated E2E shards.
- Native Windows full-source diagnostic [44200119433](https://github.com/markwylde/terminay-release-retry-tests/actions/runs/44200119433) was cancelled after exceeding its expected ten-minute duration. It built the application and reached NSIS packaging, then stopped producing output for over three minutes after downloading the 7zip helper. It did not reach the update-probe step. The focused packaging reproduction below completed successfully.

- Native Windows focused diagnostic [44201500100](https://github.com/markwylde/terminay-release-retry-tests/actions/runs/44201500100) succeeded. With Node 24.15.0, Electron 45.3.2 and electron-builder 26.18.1, it built the original fixture installer then ran the production update-test script to produce `6.10.0-main.3637.canary`, `terminay-update-probe-Setup.exe` and `nightly.yml`. This exercises packaging with a small application fixture, not the full Terminay install/update lifecycle. The original exit 127 remains unexplained; no deterministic packaging defect was observed and no workaround is claimed.

- After archive, `openspec validate --all --archived` passed 302 items and retained the same eight failures as baseline main (301 passed, eight failed), including the pre-existing archived change failure.
