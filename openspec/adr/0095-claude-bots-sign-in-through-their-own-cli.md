# ADR-0095: Claude bots sign in through their own CLI

Status: accepted, supersedes ADR-0091 in part
Date: 2026-11-03
Supersedes: ADR-0091 (supported Claude credential methods only; all per-bot credential and no-host-login boundaries continue)

## Context

ADR-0091 limited Claude bots to pasted setup tokens and API keys, while Codex offered guided browser sign-in. The owner requests the same guided experience for Claude. Claude supports a persistent Linux login, and Terminay already runs sign-in commands in the bot’s own terminal and persistent home.

## Decision

Claude bots also offer Sign in with Claude, using their own compatible CLI’s subscription login flow inside the bot container. The user follows its browser URL and enters its authorization code in the sign-in terminal when requested. Claude stores and refreshes the login in that bot’s home; Terminay does not read or copy the credential or create an OAuth client or refresh service. Existing token and API-key methods remain available, and the selected method governs each new execution.

The CLI’s own sign-out command removes the saved login. Each bot retains a separate home and separate sign-in; no host login or other bot’s login is detected, mounted or copied. No idle provider process is retained solely to refresh credentials.

## Consequences

Claude gains the existing guided sign-in surface without host credential handling. Its saved login survives ordinary container restarts through the persistent home volume. The bot and its tools can read that file, and revocation or expiry can still require signing in again.

Installing an unrelated CLI, implementing OAuth exchanges in Terminay, or copying host credentials are rejected because they add version or credential-management boundaries the existing CLI flow avoids. The pinned SDK’s native executable and headless code-paste flow must be verified before release. Existing active bot planning artifacts must be reconciled before archive; the accepted ADR-0091 file remains untouched.
