## 1. Contract and proxy transport
- [x] 1.1 Specify default shared-engine attribution and ADR-0094; verify existing boundary decisions and reconcile pending specifications.
- [x] 1.2 Implement versioned Docker and native Podman creation labelling with preserved application labels; verify two identities, direct API calls, malformed/oversized JSON and no unlabelled side effects.
- [x] 1.3 Preserve ordinary HTTP, uploads, streaming, upgrades and half-close; verify bytes, backpressure, cancellation, errors and shutdown with socket fixtures.

## 2. Container integration and UI
- [x] 2.1 Start and supervise the proxy before container readiness with private upstream mount and bootstrap identity; verify init, mount and failure tests.
- [x] 2.2 Ship standard Docker and Compose; remove CLI labelling and socket opt-in settings; verify protocol/store migration, client and UI tests.
- [x] 2.3 Attribute workload lists independently of internal helpers and preserve creator labels on controls; verify backend and UI behavior.

## 3. Verification and delivery
- [x] 3.1 Run relevant server/client/protocol/UI checks, typechecks and OpenSpec validation; record actual results and limits.
- [x] 3.2 Verify real Compose, direct API, concurrent bot identities, unrelated-container control and exec/build/log streams on available engines; record untested modes honestly.
- [x] 3.3 Rebuild/recreate the development bot with its home/sign-in/history intact; verify default proxy and Compose in the app/container.
- [x] 3.4 Update the existing Gitea PR, read back its description and require every final-head status success or skipped.

## 4. Container presentation refinement
- [x] 4.1 Replace raw engine JSON/timestamps and cramped columns with readable port mappings, relative creation age, combined name/image identity, status badges and horizontal accessible actions. Verify wide/narrow layouts, action targeting, cancelable removal and the live development workload.
