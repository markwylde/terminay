## 1. Command defaults registry (server core)

- [x] 1.1 Add `terminalService/commandDefaults.ts`: a registry of `{ id, extensionId, command, prependArgs }` with validation (plain-word command, not a builtin or reserved word of zsh, bash, fish, or PowerShell; every argument starts with `-`; no control characters; bounded count and length). Verified by unit tests in `packages/server-core/test/command-defaults.test.mjs` covering each rejection.
- [x] 1.2 Resolve conflicts: two applying entries for one command apply neither and record an extension diagnostic. Verified by a unit test that asserts both are dropped and the diagnostic is listed.
- [x] 1.3 Add the `TERMINAY_COMMAND_DEFAULTS` separator-delimited encoder and a reference decoder, with round-trip tests on hostile values (quotes, `$()`, backticks, newlines rejected, unicode). Verified by unit tests.

## 2. Shell integration (server core)

- [x] 2.1 Add the integration scripts, embedded in `packages/server-core/src/terminalService/shellIntegrationScripts.ts`: zsh (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`), bash, fish, and PowerShell, adapted from VS Code (MIT notice kept). Each sources the user's startup files first, keeps login semantics, guards against running twice, and defines command-default functions from `TERMINAY_COMMAND_DEFAULTS`, skipping names the user already defined. Verified by tests in 2.5.
- [x] 2.2 Add `shellIntegration.ts`: given a resolved launch (shell path, args, env, startup mode), return injected args and `TERMINAY_` env per the design table, or no change for unsupported shells, WSL profiles, and unrecognised arguments. Reuse `shellStartupModeFamily`. Verified by unit tests for every shell × login/non-login × unsupported-args case.
- [x] 2.3 Prepare the zsh runtime directory `<server data>/shell-integration/zsh` with mode `0700` on first use, write the scripts there with mode `0600`, and skip integration (never repairing) if owner or mode is wrong. Verified by unit tests with a temp data root, including a wrong-mode directory.
- [x] 2.4 Call shell integration from `terminalService/launchResolver.ts` after profile resolution, carry the user's `ZDOTDIR` as `TERMINAY_USER_ZDOTDIR`, and record in the launch snapshot whether integration was applied. Verified by launch resolver unit tests and by checking that no profile field changes.
- [x] 2.5 Add real-shell script tests (node test spawning zsh, bash, and fish where installed; pwsh when present) that assert: user rc side effects run, `ZDOTDIR` and login state match a non-integrated start, `type codex` shows the function, a user-defined `codex` wins, and hostile default values are never evaluated. Verified by `npm test` in `packages/server-core`.

## 3. Shell integration setting

- [x] 3.1 Add the server-scoped `terminal.shellIntegration` setting (default on) in `settings/classification.ts` and its schema, read at terminal start only. Verified by a settings unit test.
- [x] 3.2 Add the switch under Settings → Shell → Shell integration in the workspace UI. Verified by a component test and the e2e in 7.2.

## 4. Extension API and host

- [x] 4.1 Add the `terminal-command-defaults` permission and the `contributes.terminalCommandDefaults` contribution (`id`, `command`, optional `harness`) to manifest validation in `packages/extension-api` and `server-core/src/extensions/descriptor.ts`. Verified by manifest validation tests for missing permission, duplicate ids, and invalid commands.
- [x] 4.2 Add `context.terminals.registerCommandDefault(id, { resolve(signal) })` to `packages/extension-api/src/terminals.ts` and the testing harness in `src/testing.ts`, plus README docs. Verified by `packages/extension-api/test/terminal-command-defaults.test.mjs`.
- [x] 4.3 Wire the host side alongside `terminalLauncherChild.ts`: resolve on registration and on harness switch-on with a bounded timeout, never await during launch, and drop entries on failure, harness switch-off, disable, or deactivation; the command name always comes from the manifest. Verified by `packages/server-core/test/terminal-command-default-host.test.mjs`.

## 5. Launchers apply defaults

- [x] 5.1 In `terminalService/launchers.ts`, append the registry arguments whose command equals the launcher executable's file name to the typed line, quoted by the server, whether or not shell integration is on. Verified by extending `terminal-launcher-host.test.mjs` with and without a matching default.

## 6. Built-in agents: Codex default

- [x] 6.1 Declare the `codex` command default for the Codex harness and the `terminal-command-defaults` permission in `extensions/builtin-agents` manifest. Verified by the extension's manifest test.
- [x] 6.2 Add `src/commandDefaults.ts`: locate Codex with `chat/locate.ts`, run `<path> --help` (5 s timeout, 256 KiB cap), match `^\s*--no-daemon\b`, cache by realpath, size, and mtime, and register via `registerCommandDefault`. Verified by unit tests with fake executables for supported, unsupported, missing, failing, timing-out, oversized, and replaced builds.

## 7. Binding safeguard

- [x] 7.1 Extend `processAncestry.ts` to read a process's controlling terminal (`ps -o tty=` on macOS, `tty_nr` from `/proc/<pid>/stat` on Linux), on the same edges as ancestry. Verified by unit tests with stubbed `ps` and `/proc` output.
- [x] 7.2 In `sessionSourceBridge.ts` `ownerOf`, bind only when the owner's controlling terminal equals the PTY shell's; a detached owner binds nowhere. Verified by bridge unit tests, including a detached child of a terminal's shell and a sub-agent sharing its parent's pid.

## 8. End-to-end and validation

- [x] 8.1 Add `e2e/shell-integration.spec.ts`: a zsh and a bash terminal define `codex` with a fake Codex that lists `--no-daemon`, the function is absent when the setting is off, and a launcher types `--no-daemon`. Verified by `npm run test:e2e -- e2e/shell-integration.spec.ts` (Docker only).
- [x] 8.2 Extend `e2e/agent-status-sidebar.spec.ts` with a detached fake server spawned from a terminal: its session shows as external and the terminal tab shows no dot. Verified by `npm run test:e2e -- e2e/agent-status-sidebar.spec.ts`.
- [ ] 8.3 Manually verify with a real Codex (`-m gpt-6-luna`) in two Terminay terminals that each tab shows its own dot. Verified by observation recorded in the PR.
- [x] 8.4 Run `npm run lint`, `npm run test:built-in-extensions`, and `npm run typecheck` and `npm test` in `packages/server-core` and `packages/extension-api`. Verified by clean output.
- [ ] 8.5 Run `openspec validate --all` and, at archive time, check the `extension-platform` `Contribution arrays` and `Bounded API scope` text against the unarchived `folders-pane-strip-and-agent-launchers` and `add-agent-chat-and-pixel` changes so the full list survives. Verified by validate passing and a diff review.
