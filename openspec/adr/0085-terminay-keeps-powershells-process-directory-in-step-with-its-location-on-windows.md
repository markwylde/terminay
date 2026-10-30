# ADR-0085: Terminay keeps PowerShell's process directory in step with its location on Windows

Status: accepted
Date: 2026-10-30

## Context

On Windows, Terminay reads a terminal's directory from its foreground
process's PEB (ADR-0083). This is how a split starts in the right place, and
how worktree capture and close protection work.

PowerShell's `Set-Location` moves only the provider location, not the process's
current directory. Spike 1.4 confirmed this (see
[process observation](./evidence/windows-process-observation-koffi.md)):

- after `Set-Location`, Windows PowerShell still reported the directory it had
  started in;
- after `[Environment]::CurrentDirectory` was also set, it reported the new
  directory.

PowerShell is the default Windows shell, and the owner requires full parity.
Nothing passive can be observed: a prompt may emit OSC 7 or OSC 9;9, but only
where the user has configured it to.

ADR-0051 says Terminay observes the tools in its terminals and does not
instrument them. Exceptions need the owner's approval, recorded in an ADR. The
owner approved this one on 2026-10-30.

## Decision

1. **An interactive PowerShell that Terminay starts on Windows runs one
   command after its profiles load.** Terminay appends `-NoExit
   -EncodedCommand <hook>` to its arguments. The hook wraps whatever `prompt`
   function the profiles left. Each prompt first sets
   `[System.Environment]::CurrentDirectory` to the location when the location
   is a filesystem path, then calls the user's prompt and returns what it
   returns.
2. **Nothing else changes.** Terminay does not add the hook when PowerShell is
   given its own command, a script, an encoded command, or `-NonInteractive`.
   It writes no profile, setting, or file. It sets no variable that another
   tool reads. It adds nothing to the prompt's output.
3. **This is the only shell instrumentation approved.** No other shell, and no
   agent, gains a hook through this decision. ADR-0051 governs everything else.

## Consequences

- A PowerShell terminal's directory follows `Set-Location`, as cmd's follows
  `cd`. Splits, worktree capture, and close protection behave the same in both.
- PowerShell's process directory now follows its location, so native programs
  that a script starts with a relative path see the location too. This is
  what a user expects, and what cmd already does.
- A profile that redefines `prompt` after start-up, from a module loaded
  later, replaces the wrapper. That terminal's directory then stays where the
  shell started until the next new terminal, and nothing else breaks.
- The hook defines one global variable, `$__TerminayPrompt`, which holds the
  user's original prompt.
