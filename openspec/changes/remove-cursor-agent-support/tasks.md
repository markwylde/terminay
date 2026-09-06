# Tasks

- [x] 1.1 Delete `extensions/agent-cursor/`. Verified by the directory being absent and `npm run lint` passing.
- [x] 1.2 Remove the catalogue, built-ins, turbo, Dockerfile and root-script entries. Verified by `grep -ri cursor` over source, scripts, config and the container image returning only unrelated words.
- [x] 1.3 Update every packaging and installer test that names Cursor. **PARTIAL.** `release-artifact-build-contract`, `extension-installer`, `extension-host` and `extension-agent-runtime` pass (74 pass, 0 fail). `packaged-built-in-extension-runtime.test.mjs` and `packaged-desktop-startup-smoke.test.mjs` need a packaged app build (`TERMINAY_ELECTRON_BUILT_INS`) and have not been run; they are covered by 1.5.
- [x] 1.4 Remove Cursor from the `agent-cli-resume-and-session-restore` active change, which still lists it. **DONE.** `openspec validate --all`: 39 passed, 0 failed.
- [ ] 1.5 Rebuild the packaged app and confirm the built-in inventory carries seven extensions and no Cursor. Verified by reading `built-in-extensions/inventory.v1.json` from the build output.
