# Windows process observation through koffi

Spike 1.4 of `native-windows-desktop`, for ADR-0082. Script:
`scripts/windows-spikes/process-observation.mjs`, which calls the bindings in
`packages/server-core/src/processObservation/windows.ts` as built.

- Date: 2026-10-30
- Runner: GitHub `windows-latest`, run 41101066460 of
  `markwylde/terminay-windows-tests` (job `process-observation`)
- Node: v24.15.0; koffi 2.16.3

## Method

Each shell started in `C:\` and then changed to `C:\Windows\System32\drivers`.
The spike then read each one's current directory from its PEB. It also read:

- the process table and the foreground process beneath a Command Prompt
  running `ping`;
- how long one cwd read and one snapshot take;
- the user's SID, compared with `whoami /user`;
- the DACL that `protectWindowsDirectory` writes, as `icacls` reports it.

## Results

| Check | Result |
| --- | --- |
| Bindings load | yes |
| 64-bit `cmd.exe` after `cd /d` | `C:\Windows\System32\drivers` |
| 32-bit (WoW64) `cmd.exe` after `cd /d` | `C:\Windows\System32\drivers` |
| Windows PowerShell after `Set-Location` only | `C:\` (unchanged) |
| Windows PowerShell after `Set-Location` and `[Environment]::CurrentDirectory = …` | `C:\Windows\System32\drivers` |
| Own process | matches `process.cwd()` |
| A SYSTEM process | `null` (access denied, no throw) |
| Process table | 156 rows; `cmd.exe`'s children are `conhost.exe` and `PING.EXE`; creation times are plausible |
| Foreground under `cmd.exe` | `{ kind: 'process', command: 'PING' }` (conhost skipped) |
| One cwd read | 26 µs |
| One snapshot | 5 ms |
| SID | equals `whoami /user` |
| Protected directory | exactly the user, `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`, each `(OI)(CI)(F)`, with no inherited entries |

## Consequences for the design

- The PEB offsets, the WoW64 path, the Toolhelp32 table, the SID and the DACL
  work as designed, well inside a 1 s observation budget.
- **PowerShell's location is not the process's current directory.**
  `Set-Location` moves only PowerShell's provider location, so reading the
  PEB gives the directory PowerShell started in. Full parity needs PowerShell
  to keep the Win32 directory in step. Terminay therefore launches PowerShell
  profiles with a prompt hook. After each prompt, the hook sets
  `[Environment]::CurrentDirectory` to the location whenever the location is a
  FileSystem path. The PEB read then needs no shell-specific handling (design
  decision 5).
- The per-read cost is from a single timed read, not an average over many.
  At 26 µs it is four orders of magnitude inside the budget, so no longer run
  was made.

## The PowerShell location hook (ADR-0084)

Run 41105425106. Windows PowerShell and PowerShell 7 were each started in a
ConPTY through the packaged `node-pty` prebuild. Each was given
`-NoLogo -NoProfile` plus the arguments `shellLaunchArgs` adds. Each was then
sent `Set-Location 'C:\Windows\System32\drivers'`, and then
`Set-Location 'HKCU:\Software'`.

| Shell | cwd after `Set-Location` | cwd after moving into the registry | Prompt drawn as before |
| --- | --- | --- | --- |
| `powershell.exe` | `C:\Windows\System32\drivers` | `C:\Windows\System32\drivers` (kept) | yes (`PS …drivers>`) |
| `pwsh.exe` | `C:\Windows\System32\drivers` | `C:\Windows\System32\drivers` (kept) | yes (`PS …drivers>`) |

A non-filesystem location leaves the last filesystem directory in place, as
designed.
