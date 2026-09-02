# ADR-0002: Use SQLite through `node:sqlite` for the server state repository

Status: accepted
Date: 2026-07-27

## Context

Terminay Server is the canonical, revisioned, multi-client authority for
workspace state. The pre-existing JSON stores cannot atomically commit
workspace, revision, trust, and audit changes together. A whole-file
temp/rename write improves one file, but separate files can still disagree
after an interruption, and the stores provide no ordered revision index, no
committed schema version, no whole-state integrity check, and no consistent
backup or restore path. Supplying those on top of the filesystem would amount
to writing a new database layer.

Three options were compared against the requirements — atomic multi-object
commits, revision lookup, numbered migrations with a ledger, interrupted
migration recovery, corruption detection and recovery, recoverable
backup/restore, concurrent readers with serialized writers, native
distribution, and support on the pinned runtime:

- **Current JSON / temp-rename stores.** Simpler only while each file is an
  independent cache. Meeting the remaining requirements requires substantial
  custom persistence code — a transaction journal, an append log and index, a
  cross-store schema ledger, a coordinated rollback protocol, a whole-state
  integrity check, a quiesce-and-manifest backup procedure, and process-wide
  locking with read snapshots — none of which exists.
- **`node:sqlite`.** Present in the pinned Node executable, so it adds no
  native add-on or target matrix. Every listed requirement was exercised by a
  Terminay spike on the pinned runtime.
- **`better-sqlite3`.** SQLite supports the same transaction boundary, schema,
  WAL behaviour, and integrity facilities, but the Terminay adapter was never
  implemented or executed, so none of it is Terminay evidence. It also adds a
  native Node-API module and its prebuilt/source-build compatibility to every
  standalone target.

Both SQLite adapters meet the data-model shape. "Proven" here means a Terminay
spike exercised the property on the pinned runtime; a SQLite engine capability
is not treated as Terminay evidence for an adapter that was not run.

## Decision

Terminay Server uses SQLite through the pinned runtime's `node:sqlite`
adapter, behind a repository interface and a dedicated storage worker.

The repository uses WAL journaling, `synchronous=FULL`, foreign keys, a bounded
busy timeout, one serialized writer, `BEGIN IMMEDIATE` for canonical mutations,
numbered transactional migrations, an explicit migration ledger, integrity
checks with recoverable backups, and one transaction covering the object state,
revision/event, trust, and audit changes that belong to the same command.

Terminal stream data does not enter the workspace database hot path.

`node:sqlite` is selected over `better-sqlite3` because the pinned server
runtime already contains it. `better-sqlite3` is retained only as the
repository-interface fallback if the pinned Node API or a declared platform
fails a release gate.

## Consequences

- The repository interface and the pinned runtime are mandatory boundaries,
  not layering preferences: the Node 22 `node:sqlite` API was Stability 1.1 and
  under active development, so the adapter must remain swappable.
- Adding a native SQLite module to every standalone target is avoided.
- Evidence: `scripts/server-state-sqlite-crash.test.mjs` runs five isolated
  proofs — process death before commit restores the prior workspace and
  revision rows; process death after commit preserves the complete next
  revision; process death after transactional DDL plus migration-ledger
  insertion rolls both back and repeated migration runs then apply exactly
  once; an online backup at revision 2 restores a valid database beside a
  deliberately corrupted revision-3 database while the corrupt file's SHA-256
  is unchanged; and a reader stays available during an uncommitted WAL write
  while a competing writer receives bounded `SQLITE_BUSY` and an
  expected-revision mismatch returns a conflict without creating revision 3.
  Every reopened valid database returns `PRAGMA integrity_check = ok`. The
  suite passes on the pinned Node 22.23.1 runtime as well as the development
  runtime, using the real `node:sqlite` adapter, WAL, `synchronous=FULL`,
  foreign keys, `BEGIN IMMEDIATE`, and the Node online-backup API.

## Open items

The spike does not establish, and these remain release, migration-design, and
implementation gates rather than inferred properties:

- physical power-loss behaviour on every filesystem;
- recovery from every possible page or WAL corruption pattern (only a damaged
  database header is proven; `integrity_check` exists but broader corruption
  cases are unproven);
- migrations that use non-transactional SQLite operations;
- sustained production contention;
- backup retention policy; and
- the repository/worker integration in the server itself.
