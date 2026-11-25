## 1. Server configuration and transport

- [x] 1.1 Add server-owned provider configuration snapshot and explicit routing in both server hosts; verify host wiring and service snapshot and stale capture configuration tests.
- [x] 1.2 Implement custom multipart adapter with validated full endpoint, optional isolated Bearer credential, local TLS bypass, bounded output, abort and no redirects; verify HTTP and self-signed HTTPS fixtures including cancellation during upload/response, stalled-response timeout, streaming output limit, redirects with no follow-up and post-bypass verification.
- [x] 1.3 Wire separate custom vault key and selected-provider secret commands on both hosts; verify optional key, configured-key failure and OpenAI key isolation and concurrent provider switch tests using explicit credential selectors.

## 2. Settings and disclosure

- [x] 2.1 Add OpenAI-compatible choice, endpoint URL, free-form model, optional secret control and TLS checkbox; verify normalization/defaults and provider-appropriate field tests.
- [x] 2.2 Disclose the custom endpoint and owning server before capture without credentials; update client-core DTO/normalization for endpoint preservation and keyless custom capture; verify disclosure tests and existing providers.

## 3. Verification and delivery

- [x] 3.1 Extend existing focused dictation suites and Docker-isolated UI coverage; run affected tests and capture settings screenshots during verification.
- [x] 3.2 Run typecheck, lint, OpenSpec validation and diff checks; record results and resolve new failures.
- [x] 3.3 Complete independent Codex implementation review and OpenSpec verification; fix agreed findings and record evidence.
- [x] 3.4 Commit and push to origin, open Gitea PR with screenshots, and confirm no merge conflicts and all head statuses success or skipped.

- [x] 3.5 Sync verified dictation deltas into the canonical spec in this worktree; verify semantic consistency and OpenSpec validation.
