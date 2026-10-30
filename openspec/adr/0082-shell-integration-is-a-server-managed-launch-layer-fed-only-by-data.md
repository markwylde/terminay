# ADR-0082: Shell integration is a server-managed launch layer, fed only by data

Status: accepted
Date: 2026-10-30

## Context

Terminay needs to run its own code inside a terminal's shell after the user's startup files have loaded. The first use is defining command defaults (ADR-0081), and later uses could include prompt and command marks. Shells offer no common hook for this. Measured on a real machine, values set at spawn do not survive startup: a wrapper first on `PATH` ended at position 23 after macOS `path_helper`, nvm, and installer rc lines had run. Editing users' startup files would affect every terminal they use and is ruled out. The shell-profile contract forbids startup scripts and pre-launch hooks in profiles, and passes profile arguments without shell parsing.

VS Code, Ghostty, and Kitty solve this with per-shell injection: zsh through a private `ZDOTDIR` whose files source the user's own, bash through `--init-file`, fish through `--init-command`, and PowerShell through `-NoExit -Command`. VS Code's implementation is MIT-licensed and has been in production for years.

## Decision

1. **A launch layer, not a profile feature.** Terminay Server adds shell-integration arguments and environment after profile resolution, as server-managed values that profiles cannot see, edit, or override. Profiles keep containing no scripts.
2. **Per-shell injection for a fixed set.** zsh, bash, fish, and PowerShell are integrated using the VS Code mechanisms. Any other shell, a WSL profile, or a profile whose arguments Terminay does not recognise starts exactly as it would without integration. Adding a shell is a spec change.
3. **User startup first, never written.** The integration loads the user's and the system's startup files in the shell's normal order before running Terminay code, keeps a login start a login start, and never creates or edits a file outside Terminay's own directory.
4. **Fixed scripts, data in.** Integration scripts are files shipped with the server. Extensions and clients feed integration only validated data, through `TERMINAY_` environment variables. Every quoting and code-generation step lives in Terminay's scripts and is tested against hostile values. No contribution point accepts shell code.
5. **Private runtime files.** Writable runtime files, such as zsh's `ZDOTDIR`, live under the server's data directory with owner-only permissions, and integration is skipped when that directory's owner or mode is wrong.
6. **One switch.** A server-scoped setting, on by default, turns integration off for new terminals.

## Consequences

- Features that need code inside the shell have one place to live, and per-shell maintenance is limited to four small loader scripts.
- Users of other shells get no integration features. Features built on integration must degrade to the non-integrated behaviour.
- Integration can change how a shell starts in edge cases. Every change to the scripts needs real-shell end-to-end coverage of login and non-login starts.
- Reviewers treat a contribution or setting that sends shell code into integration, or any write to a user startup file, as a defect.
