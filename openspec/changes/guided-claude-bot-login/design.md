## Context

The built-in manifest exposes Codex `deviceSignIn`, but Claude only `credentialSecrets`. `BotShellService` already starts a declared sign-in command in an interactive container terminal and marks success on exit zero. `composition.ts` selects environment secrets only for token sign-in; saved-login sessions receive no injected secrets. Each bot has its own persistent `/home/bot` volume. The image currently exposes only the adapter’s Codex executable.

The pinned Claude ACP adapter 0.99.1 depends on Claude Agent SDK 0.3.312. The SDK npm package includes native platform packages, rather than the older `cli.js` path. Its README documents the platform-package `claude` binary. Exact command availability must be checked in the generated Linux image before wiring the contribution; do not assume the installed host Claude 2.1.316 equals the adapter’s runtime (SDK metadata says Claude 2.1.312).

Canonical bot specs have not been archived: `add-terminay-bots` explicitly offers only token and API key for Claude. This proposal extends that contract and must be reconciled with those scenarios before archive. ADR-0091 also explicitly enumerates Claude’s supported methods and requires a narrow supersession. Relevant continuing decisions are ADR-0092 (engine transport), ADR-0093 (fresh, concurrent executions), and ADR-0094 (engine workload attribution). None requires a long-running idle Claude process.

## Goals / Non-Goals

Goals: guided browser login with code entry, persistent per-bot login, CLI-owned refresh, predictable credential selection and sign-out, no host credential access.

Non-goals: implementing OAuth in Terminay, sharing one bot’s credential with others, keeping an idle agent running, refreshing on a Terminay timer, or changing existing token/API-key delivery.

## Decisions

1. Reuse the declared sign-in command and existing interactive terminal surface, despite the internal `deviceSignIn` name. Claude uses browser authorization with a code-paste fallback, not Codex’s device-code protocol. Label it **Sign in with Claude** and explain copying the URL and pasting the returned code. Do not forward container loopback ports. Boundary: untrusted client input reaches only the authorized bot terminal; the server chooses the declared executable.
2. Expose the installed SDK’s compatible native Claude executable as `claude`, resolving its platform package during image build and checking `claude --version` and `claude auth login --help`. Prefer this to installing an unrelated CLI version or assuming `cli.js`. Verify login and logout availability in the pinned package; if unavailable, revise this design before implementation proceeds further. Declare `claude auth login --claudeai` and `claude auth logout` only after that check passes.
3. Keep credentials in the bot home. Linux Claude normally writes `/home/bot/.claude/.credentials.json` with mode 0600 and manages expiry, refresh, and locks there. Preserve the entire existing home volume across ordinary stop/recreate. Boundary: CLI-owned secrets remain inside the bot; Terminay relays login terminal text but never reads the saved credential file.
4. Preserve explicit credential selection. Verify saved-login sessions receive neither configured API keys nor setup tokens, and selected token/API-key executions cannot silently fall back to a retained login. If the pinned adapter needs explicit credential-selection support, implement that at its launch boundary with tests. Do not delete a retained login merely to change methods.
5. Keep existing lifecycle semantics: command exit zero marks signed in; failure/cancel leaves selection unchanged; logout clears selection after success. Do not confuse the persisted chosen method with a guarantee the provider still accepts it. Reuse existing visible authentication errors and retry sign-in. Concurrent same-bot executions rely on Claude’s lock in their shared home.

## Risks / Trade-offs

- Native SDK packaging or auth subcommands differ from the host → verify the pinned Linux package and generated image, with a targeted failure if unsupported.
- Container callbacks cannot reach the user’s browser → document and exercise the CLI’s URL and code-paste fallback.
- Saved credentials can be read by the bot and its tools → retain the existing disclosure and bot-home boundary; never claim the file is encrypted or hidden from the bot.
- Pasted keys can coexist with saved login → exercise both switching directions against the pinned adapter, including invalid-key no-fallback behaviour.
- A selected saved login can expire or be revoked → show provider authentication failures and offer sign-in again; no perpetual-login claim.

## Migration Plan

Rebuild the fingerprinted bot image with the executable exposure. Existing token and API-key selections continue unchanged. Guided login is opt-in and retains its file in the existing home. Rollback removes the contribution and image change without copying or transforming saved credentials.

## Open Questions

The exact native SDK auth command availability and headless code-paste behaviour require verification against the pinned Linux runtime; this is the first implementation task. ADR-0091’s supported-Claude-method restriction is superseded only if this proposed decision is accepted. The older active bot-change scenarios must be reconciled before archive.

## Sources

- Observed local implementation: `extensions/builtin-agents/package.json`, `packages/server-core/src/botService/{image,shell,composition,credentialProtocol}.ts`.
- Anthropic authentication documentation: https://code.claude.com/docs/en/authentication (Linux credential storage, retained container volumes, browser code-paste fallback).
- Published npm metadata and SDK 0.3.312 README: platform-specific native Claude package, `claudeCodeVersion` 2.1.312.
