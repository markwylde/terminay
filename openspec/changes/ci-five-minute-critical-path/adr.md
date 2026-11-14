# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Codex
- Change: ci-five-minute-critical-path

## In-Force ADR Context Reviewed

- ADR-0036: CI budget, layered images, independent verification and eighteen shards.
- ADR-0088: durable state writes remain unchanged.
- ADR-0116: real service-manager terminal usability evidence remains required.
- ADR-0079 and ADR-0086: current platform boundaries retain Linux floor guarantees through their supersession chain.
- ADR-0080: pinned toolchain and extension installation boundaries.

## Repository-Level ADRs Created

- openspec/adr/0121-ci-readiness-is-measured-from-original-creation.md: strict readiness accounting and duration-balanced complete coverage.

## Notes

Reviewed the repository supersession fields; highest existing sequence was 0120. No prior accepted record is modified.

The measured installer follow-up is recorded in ADR-0122, which permits daemon-owned npm download-cache volumes while preserving integrity verification and scoped native-header selection. ADR-0121 remains immutable.
