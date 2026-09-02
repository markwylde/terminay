## Why

A user creating a Puzed VM through the released `v3.5.3` journey could pick a worker and a bridge that Puzed will not accept together, submit, and get `HTTP 409 bridge_worker_mismatch` with no clear way forward. The original delivery of this journey — a progressive create form, a dedicated SSH key, an idempotent create transaction, and a durable provisioning saga through address and SSH readiness — is in place, but it did not prevent that invalid combination or give the user a recoverable path when Puzed rejected it.

## What Changes

- Create new SSH-ready Puzed VMs through the focused progressive Terminay flow, and maintain a durable idempotent provisioning saga through address and SSH readiness.
- Discover bridge choices from the selected worker's authoritative route rather than the organization-wide list, so the form cannot offer a bridge Puzed will reject for that worker. Automatic and explicit host selection use the same compatibility source.
- Revalidate dependent host and bridge selections whenever the worker, placement mode, network mode, or refreshed provider options change, clearing or blocking a stale incompatible value with a safe actionable explanation before submit.
- Add an authoritative server-side preflight for the final worker and bridge combination immediately before create, without weakening the Puzed create request as the source of truth.
- Recover safely from a Puzed compatibility rejection including `bridge_worker_mismatch`: preserve the entered form state, refresh the applicable options, identify the invalid selection, and allow correction and resubmission without creating duplicate infrastructure.
- Keep a guest with no reachability retryable in the SSH readiness phase rather than reporting it ready.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `puzed-project-environments`: worker-scoped bridge compatibility across automatic and explicit placement, revalidation of dependent selections, a server-side pre-create preflight, bounded recoverable rejection handling, and an unreachable guest staying retryable rather than ready.

## Impact

- The Puzed extension's create form contract, its option sources, and its provider client.
- Server-core project-environment operations, where a rejected create must commit no environment or operation record.
- The SSH broker binding generation, which must not run before the final compatibility check passes.
- The connection chooser's projection of live SSH readiness while a durable operation is pending.
- Verification suites: the Puzed plugin tests, the project-environment UI tests, server-core project-environment operation tests, and manual acceptance against a real Puzed account.
