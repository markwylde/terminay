## Context

`claudeCodeProvider.observe` binds in two steps. First it accepts the pid-keyed `~/.claude/sessions/<pid>.json` that a `claude` descendant wrote for itself, checking that the file's pid, cwd, and `startedAt` all agree with the observed process. That file names the conversation the process is holding. Second, `journalFor` derives `<encoded cwd>/<sessionId>.jsonl` below `.claude/projects` and requires the journal's first record to name the same session.

Step one is sound and stays exactly as it is. Step two carries an assumption that does not hold: that a conversation's journal lives under the directory the process is running in. Claude Code files a journal under the project directory where the conversation **originated**, and `--resume` in another directory does not move it. The session file for such a process is perfectly consistent — same pid, same cwd, same start time — while `journalFor` looks in a directory that has no journal for that id, returns `undefined`, and `observe` reports `not-bound`. Discovery then walks the other bundled providers, exhausts its ten retries, and the terminal never shows an agent.

Two mechanisms were checked against the live machine before designing:

- **Open-handle evidence.** `lsof` on a live `claude` shows zero handles below `.claude/projects`: the CLI appends and closes. The spec already anticipates this ("A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule"), so this route does not exist for Claude Code.
- **Bounded directory listing.** `AgentFileObservationBroker.listDirectory` walks an opaque root to a declared depth, returning files matching declared extensions. On the machine that produced the bug, `.claude/projects` holds 161 `.jsonl` files across 35 directories totalling 248 MB — inside the host's caps of 256 entries and 1 GB, but not by a wide margin, which is why the listing itself is narrowed below rather than merely used as it stood.

Boundaries: this is extension code, so it may use only `@terminay/extension-api`, Node built-ins, and its own manifest dependencies. Terminal identity still comes only from the terminal-scoped observation broker — the extension's own AGENTS.md is explicit that a title, filename, cwd, timestamp, or newest-file heuristic is never enough to bind a session.

## Goals / Non-Goals

**Goals:**

- A conversation resumed in a directory other than its origin binds and shows its agent.
- The same resolution covers a conversation switch inside a live session, so `/resume` onto a conversation from elsewhere relabels the row.
- Every failure mode leaves the terminal unbound rather than bound to the wrong journal.

**Non-Goals:**

- Changing the session-file rule that decides *which* conversation a terminal holds. That evidence is correct and untouched.
- Changing any other provider, or the binding evidence any provider relies on.
- Making the search a general journal finder. It resolves one already-named session id and nothing else.
- Following a conversation whose journal moves while it is already bound. The existing switch path re-resolves on the next switch record; a journal relocating underneath a live binding is not a case this change addresses.

## Decisions

### Resolve by session id, with the derived path first

`journalFor` gains a fallback rather than a replacement. The derived `<encoded cwd>/<sessionId>.jsonl` is still tried first and still answers almost every call with one `resolveHomeRelative`; only its absence triggers a search. This keeps the common path free and confines the new cost to the case that is currently broken.

Alternatives considered: searching first and treating the derived path as an optimisation — rejected because it makes every binding pay for a case that is rare; and recording the origin directory from the session file — rejected because the file does not carry one.

### The search is by exact filename, verified by the journal's own header

The search lists `.claude/projects` at depth 1 for `.jsonl` files and keeps only entries whose basename is exactly `<sessionId>.jsonl`. Each survivor's first record must name the same session, which is the same check the derived path already performs.

This is not the "newest file" or "nearest match" heuristic the extension's own rules forbid. The session id is not chosen by the search — it comes from the pid-keyed file the observed process wrote about itself. The search only answers "where is the file for this exact id", and the file has to name that id back. If two survive, nothing binds: a duplicate id across directories is not a case worth guessing at, which is the same stance the provider already takes for a `claude` nested inside a `claude`.

### The listing is bounded by the file it asks for

`listDirectory` charged every matching file's size against the byte budget and stopped the whole walk when the next would exceed it. For a lookup that already knows its filename that is the wrong bound entirely: the budget is spent on files the caller never wanted, and the walk is truncated alphabetically before reaching the one it did. On the machine that produced this bug, `.claude/projects` was 248 MB against a 1 GB cap — fitting today, and failing as soon as it did not.

So the listing gains an optional exact-name filter. A caller may declare the filenames it is resolving, and the host considers and charges only those, applying the filter before the budget is touched and before the file is even stat'd. The provider declares one name, so the number and size of unrelated journals stop mattering: hundreds of them, of any size, no longer crowd out the one being resolved.

Alternatives considered: raising the provider's limits — rejected because they were already at the host maximum, so it moves the cliff rather than removing it; and exempting name lookups from the byte budget inside the provider — rejected because the budget is the host's to enforce, not the caller's to opt out of. The filter narrows what is measured instead of loosening what is allowed, so the operation stays bounded and host-enforced.

Each declared name must be a single path segment, validated with the same rule the host already applies to directory entries, so a name cannot become a traversal.

### It still fails closed

A truncated snapshot is still evidence of nothing, and the provider still reports `not-bound` for one. That path is now much harder to reach — it takes hundreds of directories all claiming one session id — but it stays, because a limit reached before the journal was seen must never produce a plausible answer. The terminal keeps its existing discovery retries and topology polling, so a later attempt can still resolve it, and the `not-bound` record keeps the failure visible in the agent observation diagnostics rather than silent.

## Risks / Trade-offs

- **A very large `.claude/projects` truncates the search** → Removed at the source: the lookup declares its filename, so unrelated journals are neither considered nor charged. What remains is the case of hundreds of directories claiming one session id, which is ambiguous anyway and binds nothing.
- **The name filter is a new public API surface** → It is one optional field that narrows what a listing considers, validated by the host with the rule it already applies to directory entries. Omitting it preserves the previous behaviour exactly, so every existing caller is unaffected.
- **One extra directory listing on the unbound path** → It runs only when the derived journal is absent, and only inside an already-bounded discovery attempt whose retries are capped. A bound terminal never pays it.
- **A resumed conversation and a same-id journal elsewhere could both match** → Verification is by the journal's own first record and two survivors bind nothing, so the ambiguous case is refused rather than resolved by preference.
- **The search widens what the provider reads** → It reads only `.jsonl` names below the provider's own project root, which the provider already resolves, and only the first record of an exact-id match. No other file is opened.

## Migration Plan

None. Behaviour only becomes available; nothing persisted changes and no journal is written. Rollback is reverting the change, which restores the derived-path-only resolution.

## Open Questions

None. No in-force ADR needs revisiting: the binding evidence rule from ADR-0014 is preserved — the CLI's own pid-keyed file still names the session, and the journal still has to name it back.
