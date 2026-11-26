## 1. Native Claude lifecycle

- [x] 1.1 Keep the approval stream open across an interim result and background wake-up. Verify that Autonomous approvals and Ask me decisions reach Claude after the wake-up and stdin closes on the final result.
- [x] 1.2 Mark a Claude approval-stream closure as failed. Verify that a clean provider exit preserves the tool diagnostic and rejects the execution, and that ordinary tool errors and imitated error text retain their existing behavior. Verify the session service persists dispatched runner failures and applies its existing follow-up rules.

## 2. Verification

- [x] 2.1 Run the server-core dependency build and bounded native-bot tests, including overlapping jobs, repeated wake-ups, ordinary completion, and Stop during a pending wake-up approval. Check the existing service tests for process cleanup and runtime revocation.
- [x] 2.2 Run the pinned Claude CLI against a loopback fake model and verify follow-up host approval and denial for shell and runtime-tool requests.
- [x] 2.3 Validate the OpenSpec change and confirm the delta matches the implementation.
