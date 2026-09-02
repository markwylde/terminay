# Task 51 extension resource-bound evidence

Date: 2026-08-12

The release candidate uses explicit admission limits rather than relying on
available memory or remote-provider behaviour.

| Surface | Bound and measured behaviour | Evidence |
| --- | --- | --- |
| Menus and forms | 256 options, 128 fields, 32 sections; the advertised maximum is accepted and one extra is rejected. | `extension-resource-bounds.test.mjs` |
| Installed package inventory | 20,000 regular files and 256 MiB across the materialized tree; links, native modules, and one-over-limit trees fail installation. | `packageValidation.ts` and extension installer suites |
| SFTP | Directory listings cap at 10,000 entries. Observation snapshots default to 2,000 entries/depth 16 and cannot exceed 10,000/depth 64. The explicit two-entry traversal test fails closed on entry three. | SSH `filesystem.test.mjs` |
| Provider IPC | 16 concurrent callback invocations per extension. Invocation 17 is rejected rather than queued; the test observed rejection under 250 ms. Messages cap at 1 MiB. | `extension-resource-bounds.test.mjs` and Extension API limits |
| SSH connections | One transport is shared only for an exact profile revision, with 32 channels by default. The one-over-limit acquisition is rejected; a different revision receives a distinct transport. | SSH `pool-terminal.test.mjs` |
| Puzed event streams | One stream is shared per profile/organization. A server admits 64 distinct pairs by default, configurable only within 1–1,024; one-over-limit acquisition is rejected and final release aborts the stream. | Puzed `puzed.test.mjs` |
| Provisioning | Project-environment create mutations serialize at concurrency 1 for a server registry. Concurrent resumes of one durable Puzed operation coalesce onto one execution and one create request. | `extension-resource-bounds.test.mjs` and Puzed `provisioning.test.mjs` |

Focused verification:

```text
Terminay resource/upgrade suite: 6 passed
SSH SFTP/pool/observation suite: 15 passed
Puzed complete unit and packed-runtime suite: 24 passed
```
