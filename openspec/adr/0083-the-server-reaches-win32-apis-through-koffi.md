# ADR-0083: The server reaches Win32 APIs that Node does not expose through `koffi`, loaded only on Windows

Status: accepted
Date: 2026-10-30

## Context

On Windows the server needs several things that Node does not expose:

- the process table;
- another process's current directory;
- the current user's SID;
- a protected DACL on a directory;
- the computer name of a named pipe's client.

On macOS and Linux the same facts come from `ps`, `lsof`, `/proc`, and POSIX
modes. On Windows, the process-spawning equivalents (`wmic`, PowerShell CIM,
`tasklist`) cost 100–600 ms each. Terminal observation runs often enough that
this would breach ADR-0021's spawn budget.

ADR-0026 lets extensions ship prebuilt native modules, and the built-in agents
extension already depends on `koffi`. `koffi` is an FFI library that ships
prebuilt N-API binaries for every supported platform, and it loads with install
scripts disabled. ADR-0026 says nothing about native modules in the server
itself, where `node-pty` has been the only native module (ADR-0004, ADR-0081).

## Decision

1. **Server-core may call Win32 APIs through `koffi`, on Windows only.**
   `koffi` is an optional dependency of server-core. It is loaded lazily from
   code that runs only when the injected platform is `win32`. macOS and Linux
   never load it.
2. **Bindings are narrow and declared in one module.** Each Win32 function the
   server binds is declared in one place, `processObservation/windows.ts` and
   its siblings, with its parameter and result types. No code builds a binding
   from a runtime-supplied name.
3. **A failed call is an absent answer, not a crash.** Every binding returns a
   typed failure that callers map to `limited`, unplaceable, or refused, as
   their spec says. A missing `koffi` on Windows is a startup failure with a
   stated reason. Observation does not silently stop.
4. **Only the process's own authority.** Bindings run with the server's user
   token and never request privileges it does not already have, such as
   `SeDebugPrivilege`.

## Consequences

- The Windows payload carries `koffi`'s win32-x64 binary. The PE architecture
  check and the native probe cover it.
- A `koffi` major upgrade touches both the server and the built-in agents
  extension, and is qualified once for both.
- Adding a binding is a reviewable change to one module, not a new native
  artifact.
- An undocumented layout (the PEB's `ProcessParameters`) is read through it.
  A layout change in a future Windows release shows up as `limited`, not as
  wrong data, because the read is bounded and validated.
