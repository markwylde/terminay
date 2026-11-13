## Context

`createTeaTokenStore` (`extensions/gitea/src/teaConfig.ts`) memoises one
promise of the parsed `tea` logins. A failed read resolves that promise to `[]`
through `.catch(() => [])`, and the memo is only cleared by the file watch. The
watch is installed inside the success path, so when the file is missing at
activation no watch ever exists and the empty list is permanent. The same is
true when watch installation throws, and when the watcher later errors: the
adapter in `index.ts` closes it without telling the store, so the memo outlives
the only thing that could invalidate it.

Every consumer goes through the store: the worktree insight runtime
(`token`, `reject`) on its approved refresh floors (ADR-0028), and the forge
source (`origins`, `token`, `user`) on demand (ADR-0106). **Check again** in
Settings re-runs the forge source's `accounts()`, which calls `origins()` — so
fixing the store fixes the button with no UI or protocol change.

The change stays inside the `terminay-gitea` extension child process. It does
not cross the renderer/server boundary, and tokens remain in memory there only.

## Goals / Non-Goals

**Goals:**

- A `tea` config created after activation is read on the next lookup.
- A config that is edited, deleted and re-created, or replaced by rename keeps
  being observed, and no change is lost between a read and the watch.
- A login whose token was rejected becomes usable again when the config gives
  that origin a new token.

**Non-Goals:**

- Watching the config's parent directory for creation. The directory may not
  exist either, and a lookup-driven retry already covers the case.
- Running `tea` (still forbidden by the spec and ADR-0063).
- Any change to sign-in prompts, the Settings view, or refresh intervals.

## Decisions

1. **The memo is kept only while a live watch guards it.** A load first tries
   to install a watch on the config path, then reads. The result is memoised
   only if the read succeeded *and* a watch is live. A failed read, a failed
   watch installation, or a read with no watch leaves no memo, so the next
   `token`/`origins`/`user` call reads the file again.
   *Alternative:* keep a failure and add an explicit `recheck()` wired to
   **Check again**. Rejected: it needs a new extension API path for a generic
   button and still leaves the worktree insight runtime stale until the user
   clicks it.
2. **Watch before read.** Installing the watch first means a write that lands
   during or after the read raises an event. Any event (or watcher error)
   clears the memo, closes and forgets the watcher, and clears per-origin
   rejections; a read already in flight is then not retained, because the memo
   it would occupy has been cleared. The next lookup installs a fresh watch on
   the current file and reads it.
   *Alternative:* read first, then watch (today's order). Rejected: a write
   between the two is missed and stale or partial content is kept until the
   next change.
3. **Watcher errors are change events.** The `index.ts` adapter forwards
   `error` to the store's change handler instead of only closing the watcher,
   so the store never holds a memo behind a dead watch.
4. **Rejections are cleared on change, not on re-read.** A 401 still
   suppresses that origin's tea token across lookups while the file is
   unchanged (no memo churn re-enables it). Only a change event clears
   rejections, so a new token written by `tea login` is tried.

## Risks / Trade-offs

- [With no `tea` config, or where watching is unsupported, every lookup now
  reads the file] → It is a single `readFile` per lookup, no process spawn, so
  ADR-0021 (background cost is counted in spawns) and ADR-0063 are untouched,
  and lookups are already bounded by the ADR-0028 refresh floors and on-demand
  forge requests.
- [Without a memo, a rejected origin could be retried on every lookup] →
  Rejections are kept independently of the memo (decision 4), so a rejected
  token stays suppressed until the file changes.
- [A watch event fires mid-write and the read sees a partial file] → The
  parser skips what it does not recognise, and because the watch precedes the
  read, the write's completion raises another event that clears the memo.
