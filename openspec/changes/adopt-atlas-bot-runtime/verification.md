# Verification — 2026-11-04

Implementation lives in the `feat/adopt-atlas-bot-runtime` worktree. Proposal/ADR commit `d3144592` reached canonical `origin/main` before implementation. No implementation or archive merge is recorded here.

## Public inputs and source provenance

`docker/terminay-bot/PORTING.md` and `port-source.json` identify the authorized Atlas source copies at revision `1927383d62c5bf6d941c52bd26181e3bf3bcc9a0`. The runtime, generated Dockerfile and shipped context have no Atlas checkout, internal import, private registry or Gitea build dependency. Public-input audit: `node --test scripts/bot-runtime-public-inputs.test.mjs`.

Pinned native versions: Codex 0.165.0, Claude Code 2.1.312, chrome-devtools-mcp 1.1.1. Thirteen ArtCraft pins are in the installer. Extension API 3.6 declares native driver/version explicitly and rejects ACP declarations.

Public arm64 and amd64 image builds succeeded locally with Podman. Final arm64 image `localhost/terminay-bot:native-gate`: `eadb6d2c3b1c3ebf6c58a86a393311b7bd4d7d38c09888c1d0d5375d86171ef0`, generated input fingerprint `393b490f7682852be14d15831a4956c05cf26d5a085ee9778a7fe7b309e13b67`. The amd64 public-build proof predates final helper refinements; rerun it in native CI before acceptance.

## Local passing gates

- Shared package build and renderer/Electron TypeScript checks.
- Repository lint: no errors (existing warnings/info remain).
- Extension SDK: `npm run test --workspace @terminay/extension-api`, 121 passed.
- Targeted bot server/client/extension/public-input suites: 266 passed, 12 opt-in skipped including the final build-redaction test. These cover native event parsing, final outcome plus exit validation, permissions/expiry/cancellation, credential leases, process ownership, corrections, durable posts/attachments, work fencing, engine identity, private relay and build progress.
- Build progress/service checks after log redaction: 10 passed, including fragmented credential-shaped diagnostics, bounded retention, cache/parallel steps, publication failure, restart and retry identity.
- Desktop control: `python3 -m unittest discover -s docker/terminay-bot -p test_desktop_control.py`, 31 passed, including cancellation of disconnected in-flight actions.
- Final real arm64 native conformance: `TERMINAY_BOT_CONFORMANCE=1 TERMINAY_BOT_ENGINE=podman TERMINAY_BOT_CONFORMANCE_IMAGE=localhost/terminay-bot:native-gate node --test extensions/builtin-agents/test/bot-conformance.test.mjs`, 2 passed. Controlled model endpoints prove streaming, model selection, native permissions, explicit MCP posts, tool credential exclusion, rejected credentials, selected key/setup-token versus saved-login precedence, device prompts, persistence and logout.
- Final real private runtime/relay suite passed 6/6 on the final arm64 image (`TERMINAY_BOT_MCP_SMOKE_IMAGE=localhost/terminay-bot:native-gate node --test packages/server-core/test/bot-runtime-real.test.mjs`).
- Final arm64 `desktop-gate.sh` passed: visible XFCE and sandboxed Chromium, same-browser CDP forwarding, real screenshot, all thirteen apps rendered visible windows as bot without GPU. This does **not** prove per-app document saving or native amd64 desktop operation.
- Final Docker-isolated Electron suite: `npm run test:e2e -- e2e/bots.spec.ts --workers=2 --retries=0`, **16 passed**, zero retries. Includes compact-banner/timeline failure/retry/cache, renderer reload/reconnect with the same build id, completion/back/mobile layout, corrected engine-reset recovery, independent bots, stop/replacement/restart, durable chat, and per-bot sign-in/out. Artifacts: `.docker-cache/e2e/20261104T111937Z-25031/`. Earlier runs exposed the test cleanup/reset race described below; final run is clean.
- `openspec validate --all`: 108 passed, zero failed. Strict change validation passed. `git diff --check` passed.

## Outstanding acceptance evidence

Tasks 3.3, 3.4, 3.5, 6.2, 6.3 and 6.4 remain unchecked. Do not archive or describe the change as fully verified.

1. Run the complete runtime/desktop/security gates on native amd64 Docker. The local CLI is backed by Podman on arm64. The amd64 image builds, but its pinned Claude binary aborts even for `claude --version` under QEMU with Bun/JavaScriptCore `MemoryExhaustion`; emulation cannot establish runtime compatibility. Do not weaken sandboxing or approvals to work around it.
2. Exercise document creation/saving for every ArtCraft app on both architectures, and the full human-visible desktop/browser-save/posted-attachment journey. Existing automated launch/render and Python operation tests cover only part of this acceptance requirement.
3. Final Electron recovery correction is verified by the clean 16/16 run. Diagnostic repeats established that the test reset the engine after the Completed projection but before supervisor cleanup, yielding the expected fail-closed `session cleanup failed; bot remains blocked` state. The test now waits for process cleanup before reset and for the new recovered execution record; the fake supervisor is also scoped to its owning bot. The fixture regression suite passed 60/60. Repeat final real-engine checks on both Docker and Podman. `scripts/run-bot-mcp-real-tests.mjs` now runs both native CLI gates and desktop/app gate before the private MCP tests in the existing native Docker CI lane.
4. Validate every remaining scenario with final CI evidence before checking task 6.4.

Archive validation has four pre-existing failures unrelated to this change: `2026-09-06-agent-provider-status-conformance` (8 unfinished tasks), `2026-10-07-notifications-icon-and-project-dot` (1), `2026-10-10-macros-script-editor` (1), `2026-10-27-github-worktree-status` (1). `openspec validate --all --archived` reports 204 passed, 4 failed. These historical records were left unchanged.

## Pull-request CI and Docker sandbox correction

PR #488 run 23301 on `8bb52450` passed 27 checks, including all eighteen E2E shards, packaging, lint/unit/workspace, glibc, WebRTC and container/MCP compatibility checks. Both pinned native CLIs passed the real amd64 Docker conformance tests. The desktop portion exposed missing `chromium-sandbox` and Docker's namespace seccomp restrictions. A local isolated Docker daemon reproduced both errors; installing the package and using the vendored Playwright deny-by-default seccomp profile passed the visible desktop, shared-browser screenshot/CDP and all thirteen app renders. The same package with Podman's native profile also passed all thirteen app renders. Production Docker container creation now supplies that scoped profile inline, without privileged mode or new capabilities; Podman keeps its native profile. Final PR-head statuses must still be read back after this correction.

The profile is copied from microsoft/playwright commit `ae935a43d9e376e4759548f6b3c6905c7b282333`, `utils/docker/seccomp_profile.json`, with its Apache-2.0 license retained in server-core and staged alongside the packaged profile. See https://playwright.dev/docs/next/docker and https://docs.docker.com/engine/security/seccomp/.

The default-derived browser profile is extended with `pidfd_open` and `pidfd_send_signal` so the existing supervisor retains its PID-reuse protection. A real Docker probe verified both operations; the real MCP test containers now use the production profile too. The upstream profile and license remain unmodified, with the small extension assembled in `browserSandbox.ts`.
