# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: reorder-any-folder

## In-Force ADR Context Reviewed

Depth of review: the decision of 0049 was read in full. Every other ADR was screened by its title and `Status` line only, which is enough to build the supersession graph. The notes on 0011 and 0028 below rest on their titles and on how this repository's project context states them, not on a fresh reading of their bodies.

- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a folder is a server-owned workspace object that carries no authority, and every project has one General folder that cannot be removed. It does not say where General sits in the order, so letting General move contradicts nothing in it. General still exists exactly once and still cannot be removed.
- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. The server still validates every `folder.reorder` and still owns the order; one refusal is removed and no privileged call, command, or IPC is added.
- openspec/adr/0028-no-polling-without-owner-approval.md - nothing is polled. The drag is pointer-driven and the reduced-motion preference is read from a media query.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - the alternative of a per-device folder order was rejected in the design; folder order stays server state, unlike Home tabs.
- Screened by title and not engaged: 0002, 0003, 0005, 0006, 0007, 0012, 0013, 0015, 0016, 0017, 0019, 0020, 0021, 0023, 0025, 0026, 0027, 0029, 0031, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0041, 0042, 0043, 0044, 0045, 0046, 0047, 0048, 0050, 0051, 0052, 0053, 0054.
- Superseded and treated as history only: 0001 (by 0033), 0004 (by 0035), 0008 (by 0018), 0009 (by 0017), 0010 (by 0032), 0014 and 0024 (by 0025), 0018 (by 0047), 0022 (by 0028), 0030 (by 0031), 0032 (by 0036).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It loosens one validation rule inside the server's existing ownership of folder order, and redraws one renderer interaction with a library the project bar already uses.

## Notes

The highest ADR sequence number in use is 0054.

Finding General by its kind and not by its position is a coding rule that follows from the spec change, and the `project-folders` spec carries it ("wherever General is in the order"). It sets no new boundary, contract, or technology, so it is recorded in the spec and the design and not as an ADR.
