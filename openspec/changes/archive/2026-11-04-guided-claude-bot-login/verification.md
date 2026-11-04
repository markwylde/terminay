# Guided Claude bot sign-in verification

## Implementation

The built-in provider declares `claude auth login --claudeai` and `claude auth logout` through the existing authorized sign-in terminal. The generated bot image resolves the native executable from the ACP adapter's exact SDK dependency. It verifies version and both auth subcommands at build time. No independent CLI, OAuth client, refresh timer, credential reader, host login access, or additional shared volume is introduced.

Image: ACP 0.99.1, SDK 0.3.312, Claude Code 2.1.312. The Linux ARM64 production image built successfully. Unit fixtures resolve Linux ARM64 and AMD64 native packages, reject unsupported architectures and missing runtime dependencies, and cover deterministic image fingerprinting. An attempted local AMD64 runtime probe failed within Bun under QEMU before command execution; native AMD64 verification passed in Gitea run 23189, job 69075 (Bot MCP real-container ownership), whose production-image build runs the new version/login/logout checks.

## Checks

- Server-core image tests: pass.
- Server composition and credential-protocol tests: 19 pass, covering sign-in lifecycle, failure/cancellation, sign-out failure, credential delivery and connection authority.
- Built-in manifest and bot-agent tests: pass.
- Offline conformance harness tests: pass.
- Packed extension: both tests pass in an isolated Linux container. A host run detected the real active Codex session, so isolated evidence is used.
- Real pinned Codex and Claude adapters in a network-disabled ARM64 production image: both pass. Claude's CLI prints the browser authorization URL and code-entry prompt without a callback port forward. Synthetic stored login, selected API key and setup token, switching back to saved login, and rejected-key no-fallback behaviour are exercised against the real adapter and a loopback fake API. Test-only `CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` permits the synthetic OAuth test; it is not configured in product code.
- Synthetic login file mode 0600, persistence across stop/start and a replacement container retaining the home volume, and removal by the real CLI logout command: covered by opt-in container conformance.
- Electron UI: run through `npm run test:e2e -- e2e/bots.spec.ts --grep 'signs in with'` in Docker, covering both provider buttons, completion, and sign-out. The Claude fixture requires entering the browser code through the actual sign-in terminal.
- Full Bots Electron suite in Docker: 14 passed on the first attempt; engine-reset recovery passed on retry (one flaky test). Both sign-in cases passed first attempt.
- Lint: passes with existing repository warnings.
- OpenSpec current-tree validation: passes. Archive-inclusive validation retains the four pre-existing incomplete archived changes.

## Limits

No dedicated Anthropic test account was supplied. Real browser approval, server-issued refresh-token rotation, provider revocation and concurrent live refresh are not claimed as verified. The tests use only synthetic credentials and an offline endpoint; they never inspect host credentials. Refresh and cross-process coordination remain the pinned Claude runtime's responsibility, and the UI does not promise indefinite login validity.

## Workflow

The owner explicitly requested implementation in the same PR, overriding the proposal-before-main merge checkpoint for this change. Accepted existing ADRs remain unchanged; only active bot spec deltas are reconciled with the new supported method.
