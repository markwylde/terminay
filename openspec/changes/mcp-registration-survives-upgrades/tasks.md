## 1. Stable installation path

- [x] 1.1 Add `apps/terminay-server/src/stableInstallPath.ts` implementing design decision 1, and use it for both the command and the entry argument of `mcpServerCommand` in `apps/terminay-server/src/cli.ts`. Verified by `apps/terminay-server/test/stable-install-path.test.mjs`: a path inside `<prefix>/versions/<r>/` with `current` → that release maps to `<prefix>/current/...`; `current` pointing at another release, `current` missing or a plain directory, a path outside `versions`, and a non-existent path are all returned unchanged.

## 2. Replace operation

- [x] 2.1 Add optional `replace` to `McpInstallTargetRuntime` in `packages/extension-api` (and `mcpReplace` to its testing harness), route a `replace` operation through `packages/server-core` host, manager, child and `McpInstallRouter.replace()`; a target without `replace` fails closed in the child and the harness. Verified by `packages/server-core/test/mcp-install-router.test.mjs` (replace routes with the host command; an unknown target is refused without a call).
- [x] 2.2 Implement replace in all six built-in adapters by sharing the install path with the changed-entry refusal skipped. Verified by `extensions/builtin-agents/test/mcp-targets.test.mjs`: replace over a changed entry writes exactly the expected entry for every client and preserves unrelated config; replace over an unparsable file changes nothing; install over a changed entry still refuses.
- [x] 2.3 Add `mcp-install.replace` to the standalone server (`cli.ts`) and Desktop (`electron/serverTerminalAuthority.ts`), `replace()` to the renderer client, and a Replace button on changed rows of `McpInstallModal`. Verified by `tsc -p tsconfig.json --noEmit` (renderer and Electron) and `scripts/mcp-install-modal.test.mjs` (Replace enabled only on a changed row; unavailable and error rows disabled).

## 3. Docs and ADR

- [x] 3.1 ADR-0119 added and indexed in `openspec/adr/README.md`; `docs/operations/standalone-server.md` describes the stable registration and Replace. Verified by review.

## 4. Verification

- [x] 4.1 `openspec validate mcp-registration-survives-upgrades` passes. Verified by the run.
- [ ] 4.2 Builds and bounded `node --test --test-force-exit --test-timeout=120000` runs of the touched packages pass, and `npm run typecheck` passes. Verified by exit status 0.
- [ ] 4.3 Pull request CI statuses on Gitea are all `success` or `skipped`. Verified with `tea`.
