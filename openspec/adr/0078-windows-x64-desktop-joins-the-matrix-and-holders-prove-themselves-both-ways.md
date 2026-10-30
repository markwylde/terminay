# ADR-0078: Windows x64 Desktop joins the distribution matrix, and a holder and its server prove the credential to each other

Status: accepted, supersedes ADR-0077
Date: 2026-10-30
Supersedes: ADR-0077

## Context

ADR-0077 restated the session holder topology of ADR-0035 and set the glibc
floor. Its decision 6 keeps Windows outside the distribution matrix. A
colleague has run the Linux build under WSLg on Windows. That puts a Linux
app on a Windows desktop, with no PowerShell or Command Prompt, no updates, and
a five-page from-source setup. The `native-windows-desktop` change ships a
native Windows Desktop instead, with full feature parity.

Two parts of ADR-0077 do not hold on Windows as written:

- **Decision 3** carries the holder protocol "over an owner-only Unix socket
  inside the data root". Node serves only named pipes on Windows. The pipe
  namespace is machine-wide, so any local user can create a pipe under a name
  first. Today the server presents the credential to whatever answers, which
  is safe only where the listener's location is itself owner-only.
- **Decision 2** says a holder "needs nothing from its installation directory
  after start-up". On Windows, a running executable cannot be replaced, and
  the NSIS updater kills running processes by name. A holder started from the
  installation would block or die in every update.

Releases are built only on the GitHub mirror, and Gitea pull-request CI has no
Windows runner. The owner has decided not to add one.

## Decision

1. **PTYs are owned by a detached session holder, not by the server.**
   Unchanged from ADR-0077 §1.

2. **One holder serves all sessions of one data root, per generation.**
   Unchanged from ADR-0077 §2. In addition, a holder keeps no file in the
   application's installation directory open or mapped. Where the platform
   forbids replacing a running image, as Windows does, the holder runs from a
   copy of its runtime that is private to its generation and kept under the
   data root. Its executable has a name distinct from the application's. A
   later server removes the copy only after the generation's holder has
   exited.

3. **The holder protocol is internal, versioned, and local, and both ends
   prove the credential.** It is carried over an owner-only Unix socket inside
   the data root, or, on Windows, a named pipe:
   - its name is derived from the user's SID, the data root, and the
     generation;
   - it is created as the first instance of that name;
   - no other non-administrative user can write to it;
   - remote clients are refused.

   Before any session frame, each end proves to the other, by an HMAC over
   both ends' nonces, that it holds the credential stored in the data root.
   The credential itself never crosses the channel. It is never a network
   listener and never part of the application protocol. Renderers, browsers,
   extensions, and MCP do not reach a holder.

4. **A holder never runs unbounded.** Unchanged from ADR-0077 §4.

5. **Terminal output reaches disk only as a bounded tail of a session that
   ended unattached.** Unchanged from ADR-0077 §5.

6. **The distribution matrix:**
   - Desktop: macOS 12 or newer on arm64, GNU/Linux x64, and Windows 10 22H2
     or Windows 11 on x64, through a per-user NSIS installer;
   - standalone Server: GNU/Linux x64 and arm64;
   - every GNU/Linux target needs glibc 2.31 or newer, `GLIBCXX_3.4.28`, and
     `CXXABI_1.3.12`;
   - outside the matrix: macOS x64, Linux arm64 Desktop, Windows on ARM,
     standalone macOS or Windows Server, and Alpine/musl Linux.

   There is one PTY implementation, shared by every target, and every
   supported target needs its own native `node-pty` build from the release
   pipeline.

7. **The floor is a build input, not a runner property.** Unchanged from
   ADR-0077 §7.

8. **No Linux artifact merges or publishes without proof that it meets the
   floor.** Unchanged from ADR-0077 §8.

9. **No Windows artifact publishes without running on Windows.** The release
   and `main` lanes build the installer on a native Windows x64 runner. They
   check that every PE file in it is x64, then install that exact installer and
   probe it, before anything is uploaded or named in update metadata. The probe
   covers:
   - holder readiness;
   - PowerShell and Command Prompt through the packaged `node-pty`;
   - a held terminal surviving a server restart.

   Pull-request CI proves Windows logic only through injected-platform unit
   tests on Linux. Native Windows behaviour is proven after merge.

## Consequences

- Windows users get an installer and in-place updates, and shells that
  survive both.
- A Windows-only regression can merge. It is caught on the next `main` lane,
  which then withholds that run's Windows assets, so beta clients stay on the
  last good build.
- The holder protocol gains a version. The server keeps speaking the previous
  one for any holder that is still live (ADR-0035), and that previous version
  is retired only once no supported release can have started such a holder.
- Every live holder generation on Windows costs a copy of the Electron runtime
  on disk, and its first launch pays for copying it.
- The release pipeline now spans three operating systems. An outage of
  GitHub's Windows runners delays Windows assets, and does not delay macOS or
  Linux.
- Signing is not part of this decision. An unsigned Windows build is
  permitted, and SmartScreen will warn users about it.

## Open items

- ADR-0077's open items carry over unchanged.
- A spike must record under `./evidence/` whether libuv creates pipes with
  `FILE_FLAG_FIRST_PIPE_INSTANCE` and rejects remote clients, and the minimal
  file set `ELECTRON_RUN_AS_NODE` needs on Windows. A negative result changes
  how the pipe is created or the runtime is copied, not this decision.
