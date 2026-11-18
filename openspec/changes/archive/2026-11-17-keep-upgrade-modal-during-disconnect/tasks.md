## 1. Preserve upgrade presentation

- [x] 1.1 Keep providers, upgrade board, and modal mounted across workspace-context loss; verify by reviewing the shared render tree and UI checks.

## 2. Regression verification

- [x] 2.1 Extend the restart E2E regression beyond the session timeout and assert the same modal survives above disconnected controls; verify through the Docker E2E runner.
- [x] 2.2 Run bounded upgrade UI/model checks and OpenSpec validation; record results and sync/archive once verification passes.
