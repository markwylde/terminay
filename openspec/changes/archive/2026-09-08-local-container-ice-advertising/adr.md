# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-08
- Reviewer: Mark Wylde
- Change: local-container-ice-advertising

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the advertised address is a routing hint and crosses no trust boundary; what authenticates a peer is unchanged
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - approval and host-key proof are unaffected by which candidate a peer arrives on
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - this changes candidates, not signaling; direct exposure is untouched
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - no change to the supported matrix

ADR-0001, 0002, 0003, 0005, 0006, 0008, 0009, 0010, 0012, 0014, and 0016 are in
force but do not constrain this change.

## Repository-Level ADRs Created

- None. Adding an operator-supplied candidate to an existing offer is a
  configuration surface, not a durable architectural decision. The decision that
  would deserve an ADR is the one this change deliberately does not make:
  whether to run TURN. That trades the data-blind hosted design for reachability
  in cases no candidate can solve, and should be recorded as its own decision if
  it is ever taken.

## Notes

The measurements this change rests on — three unusable candidate pairs, and a
published UDP port that round-trips — are in design.md rather than an ADR,
because they describe one environment at one moment rather than a decision the
project is bound by.
