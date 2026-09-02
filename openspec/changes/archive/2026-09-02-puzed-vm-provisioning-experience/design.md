# Design

## Context

This change was reopened from completed history on 2026-08-26 after a user observed the released `v3.5.3` VM-create journey allow an incompatible worker and bridge selection, which Puzed rejected with `HTTP 409 bridge_worker_mismatch`. The earlier delivery — the progressive form, the key and create transaction, and the durable saga — remains in place and is historical evidence, but it does not prove that the live form prevents the invalid combination or offers a recoverable path when Puzed rejects one. The corrective work is the remaining scope.

The original delivery ran in parallel with the official SSH extension work, against the stable SSH provider contract and its test double until live convergence, and depends on the project-environment and extension UI and the Puzed extension foundation. It is governed by the Puzed project environments contract.

## Goals / Non-Goals

Goals:

- An incompatible worker and bridge pair cannot be submitted from the form.
- A compatibility rejection, whether from Terminay's preflight or from Puzed itself, leaves the draft correctable and creates no infrastructure.
- The durable provisioning guarantees already delivered continue to hold: exactly one VM per create, no silent deletion, and recovery across restart.

Non-Goals:

- Changing Puzed's own create validation. Puzed's create request stays the source of truth; Terminay's checks narrow the input, they do not replace the authority.
- Reworking the progressive form's shape, the SSH key handling, or the saga phases, all of which were delivered and are unchanged.

## Decisions

**Bridge options come from the worker, not the organization.** The form loads bridges from the selected worker's authoritative bridges route. This is the smallest change that makes the invalid pair unrepresentable in the UI rather than merely rejected at submit. Loading the organization-wide list and filtering client-side was rejected: the filter would be a second, drifting model of Puzed's compatibility rules.

**Automatic placement uses the same compatibility source as explicit selection.** Automatic placement remains advisory — the create request may still reject changed capacity — but it must not be able to produce a pair the explicit path would have refused. Two compatibility sources for one field is how the original defect became reachable.

**Dependent selections are revalidated on every input that can invalidate them.** Changing the worker, the placement mode, the network mode, or refreshing option sources revalidates host and bridge, and clears or blocks a stale value with an actionable explanation before submit while the rest of the draft survives. Silently clearing the whole draft was rejected as user-hostile for a long progressive form.

**A server-side preflight sits immediately before create.** The final worker and bridge pair is rechecked server-side, before an SSH binding is generated and before the POST. Its position matters: running it earlier would reintroduce a time-of-check window, and running it after binding generation would leave key material created for a create that never happens.

**A rejection commits nothing and exposes nothing raw.** Whether the rejection comes from the preflight or from a late Puzed `bridge_worker_mismatch` caused by infrastructure changing under the user, no environment or operation record is committed, the draft is retained, its option sources reload, the invalid selection is identified, and only a bounded rejection reaches the client. This preserves the existing rule that failures preserve the VM and never fall back to the local machine, and the rule that no raw provider error or secret crosses to a client.

### Security and architectural boundaries crossed

- The project-environment routing boundary: the server derives the environment from canonical state, and a client-supplied worker, bridge, host, or address cannot redirect the operation. The preflight is server-side for that reason.
- The vault boundary: the dedicated SSH private key stays in the SSH-owned vault binding and only the public half enters the Puzed request. Ordering the preflight before binding generation keeps a rejected attempt from minting key material.
- The redaction boundary: Puzed rejections are projected as bounded provider-neutral errors, never as raw provider payloads, in the UI, audit records, and logs.

## Risks / Trade-offs

- Worker-scoped bridge loading adds a request on every worker change → the selectors are already paginated and cancellable, and selections are preserved across refreshes.
- A preflight immediately before create narrows but cannot close the window in which Puzed's infrastructure changes → the late-rejection recovery path is required regardless, and is what the acceptance checks exercise.
- Automated tests can prove the form and server paths but cannot prove the released journey → manual acceptance against a real Puzed account with a previously rejectable pair remains an explicit, open obligation.

## Evidence

Recorded 2026-08-26. Puzed provider tests prove worker-scoped bridge option loading, a paginated final-pair preflight before SSH binding generation or POST, and a bounded late `bridge_worker_mismatch` rejection. Project-environment operation tests prove that the rejection commits no environment or operation record. The declarative form contract reloads option sources and clears a stale selection while retaining the draft. The Puzed plugin test suite, the project-environment UI suite, the server-core project-environment operation tests, and the root typecheck passed.

Previously completed acceptance evidence, from the original delivery: a lost create response or a restart creates exactly one VM and resumes the same job; the private key sentinel never appears in the Puzed request or in client, audit, or log output; every created VM carries the `system:Terminay` tag and untagged VMs never enter the Terminay inventory or opening flow; job success waits for observed address, SSH, and trust independently; and the form matches Puzed's drilldown behaviour across wide and narrow clients.

The real released Puzed-account correction, retry, and create acceptance remains explicitly open.

## Open Questions

- Whether the recorded manual acceptance should be repeated per release for this journey, or once against the corrected form.
