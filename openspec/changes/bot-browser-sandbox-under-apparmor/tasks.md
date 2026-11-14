## 1. Profile and installer

- [x] 1.1 Add `apps/terminay-cli/src/apparmor.ts` with `BOT_APPARMOR_PROFILE` (Moby `v28.0.0` `docker-default` template rendered as in design.md, plus `userns,`), `installBotAppArmorProfile`, and `removeBotAppArmorProfile`, with injectable filesystem and command runner. Verified by `apps/terminay-cli/test/apparmor.test.mjs`: the profile equals the pinned rendered text; install writes atomically, sets root ownership and 0644 even when contents are unchanged, and runs `apparmor_parser -r -W` once; no AppArmor or no parser skips; a write, chown, or chmod failure returns a warning and does not load; a parser failure returns a warning; remove deletes the file and never runs `-R`.
- [x] 1.2 Call install from system-scope `daemon install` before the service starts and at the start of `daemon upgrade` as root (also when nothing is to do); add hidden `daemon host-setup`, run by `daemon upgrade` from the new release's directory after activation and before start, bounded, failure a warning; call remove from `daemon uninstall`. Verified by tests that these calls happen for system scope as root and not for user scope, and that host-setup runs the new release's binary.

## 2. Server

- [x] 2.1 Add an AppArmor decision to the bot environment: on Docker with `name=apparmor` in `/info`, probe `unshare -Ur true` in bot-image containers (bot user, bot seccomp, `--network none`, bounded, removed) under the default profile and then `apparmor=terminay-bot`; cache the result per process; engine errors are not cached. Verified by `packages/server-core/test` cases: default works, profile works, neither, Podman, no AppArmor, engine error.
- [x] 2.2 In container creation, add `--security-opt apparmor=terminay-bot` when chosen, the `terminay.apparmor` label always, and `TERMINAY_BROWSER_SANDBOX=userns-refused-no-profile` when neither works. Verified by a create-args test.
- [x] 2.3 Use one currency helper (fingerprint and AppArmor label; missing label means `default`) at start-time recreation and in the `current` status. Verified by tests: default→terminay-bot while stopped recreates keeping home; while running reports not current; terminay-bot→default while stopped recreates; unlabelled container treated as default.

## 3. Browser

- [x] 3.1 In `docker/terminay-bot/bin/terminay-browser`, when `TERMINAY_BROWSER_SANDBOX=userns-refused-no-profile`, write the condition-and-fix line to the browser log before launching Chromium; launch arguments never include `--no-sandbox`. Verified by a test that checks the script's text and log line.

## 4. Docs

- [x] 4.1 `docs/operations/standalone-server.md`: what the profile is, that system-scope installs manage it, upgrading from an older release, the manual root commands for user-scope and container installs, and the server restart after a manual load. Verified by review against ADR-0120.

## 5. Verification

- [x] 5.1 `openspec validate bot-browser-sandbox-under-apparmor` passes, and `--all` adds no failure. Verified by both runs.
- [x] 5.2 Build the affected packages and run the new and touched node test files under `timeout 600` with `--test-force-exit --test-timeout=120000`. Verified by exit status 0.
- [x] 5.3 On this AppArmor host, install the profile with the built CLI as root, run the probe and a bot-image container under `terminay-bot`, and record in `openspec/adr/evidence/bot-apparmor-userns.md`: `docker inspect` AppArmorProfile, `/proc/1/attr/current` showing `terminay-bot (enforce)`, sandboxed Chromium rendering a page with a renderer in its own user namespace and `Seccomp: 2`, and `/proc/sysrq-trigger` unwritable. Verified by the recorded output.
- [ ] 5.4 Pull request CI statuses on Gitea are all `success` or `skipped`. Verified with `tea`.
