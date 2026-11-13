## Why

A user who installs `tea` and runs `tea login` after Terminay Server has
started — typical on a remote host set up after the server — never gets their
Gitea account picked up. Settings > Extensions > Gitea keeps saying "No account
found", and **Check again** changes nothing; only restarting the extension does.

The cause is in `terminay-gitea`'s tea token store: a failed read of tea's
`config.yml` is cached as an empty login list for the life of the extension,
and the file watch that would notice the file is only installed after a read
succeeds. So a file that does not exist at activation is never read again.

## What Changes

- A failed read of the `tea` configuration file is not remembered. The next
  credential or account lookup — including the one **Check again** triggers —
  reads the file again.
- Logins are cached only while a live file watch guards them, and the watch is
  set up before the file is read. A change, replacement, or watch error drops
  the cache and the watch, so later edits, deletions, re-creations, and renames
  are all picked up.
- A change to the file also lifts a 401 rejection, so a new token from
  `tea login` for that origin is used.
- No change to the credential order, sign-in, the Settings UI, or the refresh
  floors.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `built-in-extensions`: the "Gitea credentials come from tea or sign-in"
  requirement gains the rule that a `tea` configuration file created or changed
  after the extension starts is used without restarting it.

## Impact

- Code: `extensions/gitea/src/teaConfig.ts` (`createTeaTokenStore`) and the
  watch adapter in `extensions/gitea/src/index.ts`.
- Tests: `extensions/gitea/test/parsing.test.mjs` and `forge.test.mjs`.
- No protocol, UI, settings, or dependency changes. Tokens stay in the
  extension process and in memory only.
