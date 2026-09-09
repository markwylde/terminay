## Context

`claudeCodeProvider.observe` binds in two steps. First it accepts the pid-keyed `~/.claude/sessions/<pid>.json` that a `claude` descendant wrote for itself, checking that the file's pid, cwd, and `startedAt` all agree with the observed process. That file names the conversation the process is holding. Second, `journalFor` derives `<encoded cwd>/<sessionId>.jsonl` below `.claude/projects` and requires the journal's first record to name the same session.

Step one is sound and stays exactly as it is. Step two carries an assumption that does not hold: that a conversation's journal lives under the directory the process is running in. Claude Code files a journal under the project directory where the conversation **originated**, and `--resume` in another directory does not move it. The session file for such a process is perfectly consistent — same pid, same cwd, same start time — while `journalFor` looks in a directory that has no journal for that id, returns `undefined`, and `observe` reports `not-bound`. Discovery then walks the other bundled providers, exhausts its ten retries, and the terminal never shows an agent.

Two mechanisms were checked against the live machine before designing:

- **Open-handle evidence.** `lsof` on a live `claude` shows zero handles below `.claude/projects`: the CLI appends and closes. The spec already anticipates this ("A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule"), so this route does not exist for Claude Code.
- **Bounded directory listing.** `AgentFileObservationBroker.listDirectory` walks an opaque root to a declared depth, returning files matching declared extensions. On the machine that produced the bug, `.claude/projects` holds 161 `.jsonl` files across 35 directories totalling 248 MB — inside the host's caps of 256 entries and 1 GB, but not by a wide margin.

Boundaries: this is extension code, so it may use only `@terminay/extension-api`, Node built-ins, and its own manifest dependencies. Terminal identity still comes only from the terminal-scoped observation broker — the extension's own AGENTS.md is explicit that a title, filename, cwd, timestamp, or newest-file heuristic is never enough to bind a session.

## Goals / Non-Goals

**Goals:**

- A conversation resumed in a directory other than its origin binds and shows its agent.
- The same resolution covers a conversation switch inside a live session, so `/resume` onto a conversation from elsewhere relabels the row.
- Every failure mode leaves the terminal unbound rather than bound to the wrong journal.

**Non-Goals:**

- Changing the session-file rule that decides *which* conversation a terminal holds. That evidence is correct and untouched.
- Changing the extension API, the host, or any other provider.
- Making the search a general journal finder. It resolves one already-named session id and nothing else.
- Following a conversation whose journal moves while it is already bound. The existing switch path re-resolves on the next switch record; a journal relocating underneath a live binding is not a case this change addresses.

## Decisions

### Resolve by session id, with the derived path first

`journalFor` gains a fallback rather than a replacement. The derived `<encoded cwd>/<sessionId>.jsonl` is still tried first and still answers almost every call with one `resolveHomeRelative`; only its absence triggers a search. This keeps the common path free and confines the new cost to the case that is currently broken.

Alternatives considered: searching first and treating the derived path as an optimisation — rejected because it makes every binding pay for a case that is rare; and recording the origin directory from the session file — rejected because the file does not carry one.

### The search is by exact filename, verified by the journal's own header

The search lists `.claude/projects` at depth 1 for `.jsonl` files and keeps only entries whose basename is exactly `<sessionId>.jsonl`. Each survivor's first record must name the same session, which is the same check the derived path already performs.

This is not the "newest file" or "nearest match" heuristic the extension's own rules forbid. The session id is not chosen by the search — it comes from the pid-keyed file the observed process wrote about itself. The search only answers "where is the file for this exact id", and the file has to name that id back. If two survive, nothing binds: a duplicate id across directories is not a case worth guessing at, which is the same stance the provider already takes for a `claude` nested inside a `claude`.

### The search is bounded and fails closed

Limits are declared at the host maximum — depth 1, 256 entries, and a byte budget — and the host stops the listing when either is reached. The byte budget is the sharp edge: `listDirectory` charges every matching file's size against it and stops the whole walk when the next file would exceed it, so a large enough `.claude/projects` truncates the snapshot alphabetically before reaching the target. In that case the provider reports `not-bound`, exactly as it does today.

That is the honest outcome rather than a regression, and it is not a dead end: the terminal keeps its existing discovery retries and topology polling, so a later attempt can still resolve it. Reporting `not-bound` also keeps the failure visible in the agent observation diagnostics rather than silent.

## Risks / Trade-offs

- **A very large `.claude/projects` truncates the search** → The derived path is unaffected, so only the resume case degrades, and it degrades to today's behaviour rather than to a wrong binding. The `admitted (not-bound)` record makes it visible.
- **One extra directory listing on the unbound path** → It runs only when the derived journal is absent, and only inside an already-bounded discovery attempt whose retries are capped. A bound terminal never pays it.
- **A resumed conversation and a same-id journal elsewhere could both match** → Verification is by the journal's own first record and two survivors bind nothing, so the ambiguous case is refused rather than resolved by preference.
- **The search widens what the provider reads** → It reads only `.jsonl` names below the provider's own project root, which the provider already resolves, and only the first record of an exact-id match. No other file is opened.

## Migration Plan

None. Behaviour only becomes available; nothing persisted changes and no journal is written. Rollback is reverting the change, which restores the derived-path-only resolution.

## Open Questions

None. No in-force ADR needs revisiting: the binding evidence rule from ADR-0014 is preserved — the CLI's own pid-keyed file still names the session, and the journal still has to name it back.
