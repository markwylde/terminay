# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: control-socket-path-fits

## In-Force ADR Context Reviewed

Depth of review: the decision section of 0052 that concerns its socket, and the context and decision of 0049 (read for an earlier change in this session), were read. 0035, 0011 and 0031 were screened by title and `Status` line and by what the code that implements them says about sockets and the data directory; their full text was not read. Every other ADR was screened by title and `Status` line only.

- openspec/adr/0052-terminals-report-git-commands-to-the-server-through-git-trace2.md - its socket is in the temporary directory at a short path on purpose and may be unreachable without harm. The control socket differs: its address is given to terminals that outlive the server, so it cannot be random.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - terminals outlive Desktop, which is why the control socket's address must be the same after a relaunch. The holder's own handling of the path limit is left as it is.
- openspec/adr/0011-security-trust-boundary-model.md - the general trust model. This change adds a second place a local socket may live and states the conditions that keep it owner-only.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - MCP authority is the capability's scope and the user's policy, not the socket's location. Moving the socket changes neither.
- openspec/adr/0028-no-polling-without-owner-approval.md - nothing is polled; a socket removed from a temporary directory is not watched for.
- Screened by title and not engaged: 0002, 0003, 0005, 0006, 0007, 0012, 0013, 0015, 0016, 0017, 0019, 0020, 0021, 0023, 0025, 0026, 0027, 0029, 0033, 0034, 0036, 0037, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046, 0047, 0048, 0049, 0050, 0051, 0053.
- Superseded and treated as history only: 0001 (by 0033), 0004 (by 0035), 0008 (by 0018), 0009 (by 0017), 0010 (by 0032), 0014 and 0024 (by 0025), 0018 (by 0047), 0022 (by 0028), 0030 (by 0031), 0032 (by 0036).

## Repository-Level ADRs Created

- openspec/adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md - a local socket with a fixed address stays in the data directory when its path fits, and otherwise lives in a runtime directory named for the data directory that is used only if it is the user's own and closed to others.

## Notes

The highest ADR sequence number in use is now 0054. No ADR is superseded.
