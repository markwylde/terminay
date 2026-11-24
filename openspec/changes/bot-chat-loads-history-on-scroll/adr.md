# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude (for Mark Wylde)
- Change: bot-chat-loads-history-on-scroll

## In-Force ADR Context Reviewed

I read the `Status` and `Supersedes` fields of all 148 ADR files (0001 to
0141, with some numbers used twice) and built the supersession graph from
them. These ADRs are named in a later ADR's `Supersedes` field, in whole or in
part: 0001, 0003, 0004, 0007–0010, 0014, 0016, 0018, 0022, 0024, 0027,
0030–0033, 0035, 0036, 0052, 0053, 0056, 0061, 0062, 0066, 0068, 0069, 0072,
0073, 0075, 0077, 0078, 0081, 0083, 0086, 0089, 0091–0095, 0097, 0099, 0100,
0105, 0110, 0121, 0129 and 0132. I also searched every ADR body for scroll,
pagination and renderer-paging decisions. The ADRs that bear on this change:

- ADR-0093, in force except where later ADRs supersede it in part (ADR-0096:
  the ACP reaffirmation only; ADR-0100: the MCP-exposure consequence only;
  ADR-0127: the shared-work lease only; ADR-0138: runtime-tool bot scoping for
  one read path only). Its durable, cursor-paginated message log is not
  superseded. This change keeps that page contract and only changes when the
  UI asks for the next page.
- ADR-0135 (accepted): threads live in the message log, and a thread is read
  through the same cursor-paginated list, with cursors bound to that thread.
  The thread panel keeps using that thread-bound list.
- ADR-0104 (accepted): a notification is acknowledged only by what the user
  does, and scrolling is not one of those actions. Scroll-triggered prefetch
  must therefore acknowledge nothing. Design decision 8 keeps an older root's
  thread summary from advancing the observed sequence, so a prefetched page
  never acknowledges a newer reply or moves the read position.
- ADR-0134 (accepted): recorded Terminay actions are entries in the log. It
  governs what the log holds, not how it is paged.
- ADR-0039 (accepted): mirrored app views carry their scroll position. Bot
  Chat is a Home tab, not a mirrored app view, so it doesn't apply.
- Every other in-force ADR governs hosts, server ownership, protocol, security
  boundaries, the bot runtime, releases or persistence, and isn't engaged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The highest ADR sequence number in use is 0141. The loading technique (a
sentinel, an anchor on a message element, one request in flight) is a
renderer implementation choice, recorded in this change's design.md.
