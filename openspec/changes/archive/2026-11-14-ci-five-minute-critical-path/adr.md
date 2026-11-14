# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Codex
- Change: ci-five-minute-critical-path

## In-Force ADR Context Reviewed

- ADR-0036: layered images, independent verification and eighteen shards; budget accounting follows the partial supersession chain.
- ADR-0121: strict elapsed-time budget is historical after ADR-0123; its complete coverage and isolation boundaries remain.
- ADR-0122: daemon-owned integrity-verified npm cache storage remains in force.
- ADR-0088: durable state writes remain unchanged.
- ADR-0116: real service-manager terminal usability evidence remains required.
- ADR-0079 and ADR-0086: current platform boundaries retain Linux floor guarantees through their supersession chain.
- ADR-0080: pinned toolchain and extension installation boundaries.

## Repository-Level ADRs Created

- openspec/adr/0121-ci-readiness-is-measured-from-original-creation.md: historical strict readiness accounting and duration-balanced complete coverage.
- openspec/adr/0123-ci-execution-budget-excludes-runner-queueing.md: owner-approved execution critical-path target excluding runner queueing, with original elapsed evidence retained.

## Notes

Reviewed the repository supersession fields; highest existing sequence is 0122. ADR-0123 supersedes ADR-0121 only for budget accounting. No accepted record, including ADR-0121 or ADR-0122, is modified.

The measured installer follow-up is recorded in ADR-0122, which permits daemon-owned npm download-cache volumes while preserving integrity verification and scoped native-header selection. ADR-0121 remains immutable.

The owner rejected dedicated runners and the infrastructure companion PR was closed without deployment. The owner accepted the disclosed variation and requested wrap-up. Final head verification, delivery and archive remain open. Historical run 25369 is 1084s elapsed / 288s execution; latest run 25375 is 412s elapsed / 391s execution and misses the revised budget.
