## Context

`BotChat` loads the newest 25 top-level messages through `bots.messages.list`
and keeps its `nextCursor` as `older`. At the top of the history sits a "Load
older messages" button. It fetches the next page, sets `pinned = false` once the
page arrives, merges the messages (the higher revision wins), and in a
`requestAnimationFrame` adds the change in `scrollHeight` to `scrollTop`.
`BotThreadPanel` does the same for replies with "Load older replies", placed
under its reply-count divider. Both views stick to the bottom through a
`pinned` ref. `BotChat` unpins only on a user gesture (wheel up, touch,
scrollbar, keys) and re-pins within 80px of the bottom, and a `ResizeObserver`
keeps a pinned view at the bottom as images decode. `BotChat` also opens at the
unread divider when the unread run doesn't fit.

Issues with the button besides the extra click:

- `scrollHeight` compensation assumes the only change is at the top. A live
  message appended in the same frame, or an image decoding, moves the reader.
- A reader who is still pinned when the page arrives is unpinned after the
  `scrollTop` decision, so the result depends on timing.

## Research: how chat apps load backwards

Based on how Slack, Discord, WhatsApp Web and Telegram Web behave, and on the
open-source clients and libraries that document the technique (Element Web's
`ScrollPanel`, Telegram Web K, TanStack Virtual's chat guide, MUI X Chat, Kendo
Chat):

- **Load ahead, not at the edge.** Each app starts fetching the previous page
  while there is still roughly a screen of content above the reader, so
  ordinary reading never reaches an empty top. Element's `ScrollPanel` keeps a
  "fill" margin of loaded content above the viewport and backfills whenever
  that margin falls below about a screen.
- **Anchor on a message, not on scroll height.** Before prepending, the client
  records a visible message and its offset. After the DOM updates, it restores
  that offset. TanStack Virtual's chat guide recommends this over
  `flex-direction: column-reverse`, inverted transforms, or `scrollHeight`
  arithmetic, because only an element anchor survives concurrent appends and
  late image layout.
- **Quiet loading, clear end.** A spinner or skeleton rows show at the top
  while a page loads (WhatsApp Web shows a spinner, Slack and Discord show
  placeholders). At the true start, Discord shows "This is the beginning of
  #channel" and Slack shows the channel intro, so the reader knows there is no
  more.
- **Pitfalls others hit.** Some lists stop loading when the reader is parked
  exactly at the top, because the trigger fires only on a scroll *change*
  (tlon-apps PR #3346). Others restore the position to the wrong end of the new
  chunk. Both inform the decisions below.

Virtualisation (Slack, Discord, Telegram) is a separate concern, covered under
Non-Goals.

## Goals / Non-Goals

**Goals:**

- Older history loads by scrolling alone, in Chat and in the thread panel.
- No visible jump when a page is prepended. A reader at the bottom stays at the
  bottom.
- One request in flight per view, stale responses dropped, and no retry loop on
  failure.
- A clear loading state and a clear end state.

**Non-Goals:**

- Virtualising the message list. DOM size grows only as far as the reader
  scrolls, and videos already release their bytes when far away.
- Jump-to-message or loading newer history from a point in the middle. Chat
  always holds a contiguous run ending at the newest message.
- Changing page size, the `bots.messages.list` protocol, or the server.

## Decisions

### 1. An IntersectionObserver sentinel one viewport above the top

A zero-height sentinel sits at the top of the loaded history. In Chat it goes
directly above the oldest message. In the thread panel it goes directly under
the reply-count divider, where older replies are inserted. An
`IntersectionObserver` rooted at the view's scroller fires while the sentinel
is within one viewport height above the visible area. When it fires and a
cursor remains, the hook requests the next page.

The top `rootMargin` is the scroller's measured `clientHeight` in pixels, not
`100%`. Percentage root margins resolve against the root's width on every
side, so a narrow, tall panel would load late and a wide one early. A
`ResizeObserver` on the scroller rebuilds the observer when its height
changes, and that rebuild also re-checks the sentinel.

*Alternatives:* An `onScroll` distance check misses changes that are not
scrolls, such as a window resize, a short first page or deleted messages. It
also runs on every scroll frame. A fixed pixel threshold doesn't scale from a
phone to a tall monitor, while one viewport does.

### 2. Re-arm after every page

The hook observes the sentinel again whenever the cursor changes. On a new
`observe`, an IntersectionObserver always delivers the current intersection.
So after each page, a view that is still close to the top (a tall window, a
short page, a reader parked at the top) loads the next page without another
scroll. Pages stop once the oldest loaded message is more than one viewport
height above the visible area, or once the cursor is `null`. The spec's fill
scenario states the same stopping point. This avoids the "stuck at top"
failure described above.

### 3. One request in flight, scoped by generation

A ref, not React state, guards against a second request. The ref holds the
view generation that owns the request, and is set synchronously before the
fetch, so two observer callbacks in one frame can't both start one. Each
request captures the view's existing `generation` counter, which bumps on
reload, event gap, clear and bot switch. The thread panel is keyed by its
root, so a thread switch remounts it.

When a request finishes, the hook applies it, and clears the in-flight guard,
loading state or error, only if its generation is still current. A request
from a previous generation therefore can't clear the guard, loading row or
error of the request that replaced it. A change of generation also resets the
guard, loading and error, so a dropped request never blocks the new view.
Unmounting disconnects the observers and marks the view dead.

### 4. Who fetches, anchors, merges and restores

The hook owns the sequence of steps, and the view supplies two callbacks:

1. `fetchPage(cursor)` fetches a page and its full messages, and returns them.
   It does not touch state.
2. The hook checks the generation. If the view is not pinned (read from the
   view's `pinned` ref, passed in), it records the first message element
   (`[data-terminay-message-key]`) whose bottom is below the scroller's top,
   and that element's offset from the top.
3. `apply(page)` merges the messages (the higher revision wins, as today) and
   stores the new cursor.
4. After the render, a `useLayoutEffect` in the hook finds the same keyed
   element and moves `scrollTop` by however far it drifted, then forgets the
   anchor. This happens before paint, so the reader never sees a frame at the
   wrong place.

The correction measures where the element actually is. That makes it correct
whether or not the browser's own scroll anchoring (`overflow-anchor`) has
already compensated, and it still works where anchoring is missing, which
historically includes Safari on phones. Remote clients there run this same
workspace UI.

Images that decode later above the reader are left to the browser's native
scroll anchoring, as they are today for any message. This change adds no
continued correction loop, which could fight the reader's own scrolling.

*Alternatives:* `scrollHeight` arithmetic breaks on concurrent appends and late
image layout. `flex-direction: column-reverse` reverses DOM and keyboard order
against visual order, and it would invert the existing unread-divider jump and
pinning logic.

### 5. Following wins over anchoring

Loading older history never changes `pinned`. If the view is pinned when the
page arrives, the anchor step is skipped and the view's pinned layout effect
keeps the newest message in view. If the reader has scrolled up, the anchor
holds them in place. New messages arriving while the reader is scrolled up
already leave them untouched, because the pinned effect only scrolls a pinned
view. The current unpin-on-load is removed from both views.

The thread panel works out `pinned` from the distance to the bottom on every
scroll event. A prepend with its anchor correction doesn't change that
distance, so the panel stays unpinned. A pinned panel is returned to the
bottom by its layout effect, so it stays pinned. Both cases are covered by
tests.

The observer is armed only after the initial page has loaded and Chat's
entry-time jump to the unread divider is done. Prefetching can then never race
the decision about where Chat opens.

### 6. One hook for both views

`useOlderHistory({ scroller, sentinel, cursor, generation, enabled, pinned,
fetchPage, apply })` returns `{ loading, error, retry }`. `BotChat` fetches a
top-level list and `BotThreadPanel` a `threadId` list, so the hook doesn't care
what a page contains.

### 7. Loading, error and end states

- **Loading:** a single muted row with a small spinner, "Loading earlier
  messages…" (or "replies" in a thread). It has `role="status"`, so it is
  announced politely. It sits where the sentinel is, above the anchor, so its
  appearance never moves the message being read.
- **Error:** the same row turns into an inline error, "Couldn't load earlier
  messages", with a Retry link. The observer is suspended until Retry, which
  prevents a request loop against a failing server. A failed older page no
  longer takes over Chat's main error banner, whose "Reload messages" throws
  away the loaded history.
- **End (Chat):** when `older` is `null` and messages exist, a quiet centred
  "Start of conversation" marker sits above the oldest message. An empty chat
  keeps its existing empty state instead. In a thread, the root and divider
  already mark the start, so nothing is added.

### 8. Loading older history marks nothing read

Prefetch happens without a deliberate user action, so it must not acknowledge
or mark anything read (ADR-0104: scrolling acknowledges nothing). Older pages
hold older messages. But an older root's thread summary can name a reply newer
than anything Chat has observed, and `observedThrough` counts thread
summaries. So `BotChat` records a floor, the sequence of the oldest message on
its initial page. `observedThrough` ignores the thread summaries of roots
below that floor. Such a thread still shows its "new" marker, and its replies
are acknowledged when the reader opens it, through the panel's own observed
sequence.

### Boundaries

This is renderer-only. It uses the existing `bots.messages.list` query through
`BotMessagesClient`, so it crosses no Electron privilege, project/window or
terminal-session boundary, and adds no protocol message.

## Risks / Trade-offs

- [The browser's scroll anchoring and our correction both adjust] → The
  correction is computed from the element's measured position, so it is zero
  if the browser already compensated.
- [An image above the reader decodes after the anchor correction and pushes
  content down] → Native scroll anchoring in Chromium, Firefox and newer
  Safari compensates, as it already does for any message. The hook doesn't
  keep correcting, so it never fights a reader who is scrolling.
- [Very long scroll-back keeps all messages in the DOM] → This is accepted. It
  matches today's button behaviour, grows only on demand, and media already
  releases far-away bytes. Virtualisation stays a possible later change.
- [A reader parked at the top of a huge history loads page after page] → Each
  page re-arms only while the sentinel is within one viewport. One page
  normally pushes it out of range, so loading stops unless the reader keeps
  scrolling.

## Migration Plan

None. This is UI behaviour only, with nothing stored.

## Open Questions

None. No in-force ADR governs chat scrolling.
