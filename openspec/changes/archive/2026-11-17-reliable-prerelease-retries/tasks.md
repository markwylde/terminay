## 1. Deterministic retries

- [x] 1.1 Preserve the release base from the version planner through desktop retries. Verify with a temporary Git repository regression that adds a stable tag between planning and retry, including the no-tag case and rejected invalid inputs.

## 2. Windows packaging

- [x] 2.1 Investigate the Windows update-test packaging failure and preserve diagnostics. The original exit 127 did not reproduce on a clean native runner; no speculative packaging workaround is applied. Verify with native Windows packaging and regression coverage for successful and failed script execution.

## 3. Verification and delivery

- [x] 3.1 Run focused release tests and OpenSpec validation, record evidence and limitations, and submit the fix to origin. Verify every Gitea head status reaches success or skipped before reporting delivery complete.
