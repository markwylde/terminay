# A data-root lock held by the kernel through `node:sqlite`

Date: 2026-10-09
For: `openspec/changes/kernel-held-data-root-lock`, and ADR-0055

## Question

Can a standalone server hold its data root with a lock the operating system
releases when the process dies, using only what the server already ships, and
does that lock hold between two containers that share a volume?

## Method

`BEGIN EXCLUSIVE` on a SQLite database takes POSIX advisory locks on the
database file and keeps them until the transaction ends or the process does.
One container opened `lock.sqlite` on a named volume, began an exclusive
transaction, and stayed up. A second container of the same image, on the same
volume, tried the same thing while the first was running, while it was paused,
and after it was killed with `SIGKILL`. The scripts are in
[`kernel-held-data-root-lock-spike/`](./kernel-held-data-root-lock-spike/).

Host: Pop!_OS, kernel 6.18.7, Docker 29.4.3, overlayfs, a local named volume.
Image: `markwylde/terminay:5.15.0-beta.54`, using its bundled Node 24.15.0.

## Result

```
node v24.15.0
== 1 holder up
hold: ACQUIRED pid=1
== 2 second container while held
try: REFUSED code=ERR_SQLITE_ERROR errcode=5 msg=database is locked
exit=3
== 3 second container while holder is paused
try: REFUSED code=ERR_SQLITE_ERROR errcode=5 msg=database is locked
exit=3
== 4 after docker kill (SIGKILL)
try: ACQUIRED pid=1
exit=0
== files left
-rw-r--r-- 1 terminay terminay    0 Oct  9 17:30 lock.sqlite
```

| Case | Outcome |
| --- | --- |
| Holder running, second container tries | refused at once, `SQLITE_BUSY` (5) |
| Holder paused with `docker pause` | refused |
| Holder killed with `docker kill` | acquired at once, nothing to clean up |

Both containers ran the server as pid 1, so a recorded process id could not
have told them apart; the lock did.

## What it shows

- The lock crosses containers on a shared local volume, because they share a
  kernel and the lock is on the file's inode.
- It survives a pause and does not survive the process, which is the property
  a heartbeat cannot have.
- The lock file stays empty, since the transaction never writes. A killed
  holder can leave a 512-byte `-journal` beside it; the next holder clears it
  as it takes the lock.
- No warning is printed and no flag is needed for `node:sqlite` on the pinned
  Node.

## The built lease

`lease-check.sh` repeats the three cases with the compiled
`FileDataRootLease` from this change in place of the spike script, on the same
host and image. The second container printed the "another server is using its
data root" message and exited 1 while the holder ran and while it was paused,
and acquired the root after `docker kill`, overwriting the dead holder's
`.terminay-server.lock`. After a clean release only the empty
`.terminay-server.lock.sqlite` remained.

## Not measured

- A network filesystem. POSIX locks over NFS depend on the server and mount;
  the design fails closed when a lock cannot be taken.
- A bind mount from a macOS or Windows host through Docker Desktop.
