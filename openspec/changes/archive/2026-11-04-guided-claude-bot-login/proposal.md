## Why

Claude Code bots require users to obtain and paste a token outside Terminay, while Codex bots guide users through browser approval. Claude users should be able to sign in from the same Profile surface and retain a refreshable login in their bot’s own home.

## What Changes

- Add **Sign in with Claude** using Claude’s own interactive authentication command inside the bot container, including browser URL and code-paste instructions.
- Persist the CLI-managed login in the existing bot home volume; leave refresh and locking to Claude.
- Expose the adapter-compatible Claude executable in the image without installing a second independent CLI.
- Preserve sign-in-token and API-key options, with explicit selection precedence over a saved login.
- Support cancellation, failure, successful completion, and sign-out through the existing bot sign-in lifecycle.

## Capabilities

### New Capabilities

- `claude-bot-sign-in`: Guided Claude subscription login, persistence, refresh ownership, credential selection, and sign-out.

### Modified Capabilities

None in the canonical specs. The existing bot contracts remain in the active `add-terminay-bots` change; its Claude-only-token scenarios and ADR-0091’s supported-credential list need reconciliation before this change is archived. This change explicitly extends that earlier contract rather than silently treating it as already updated.

## Impact

Built-in bot-agent manifest and documentation; bot image executable exposure; existing server sign-in shell, profile UI, credential selection, and adapter conformance checks. No host credential access, shared login volume between bots, custom OAuth client, refresh daemon, or requirement to keep a bot running. A new proposed ADR supersedes ADR-0091 only for supported Claude sign-in methods.
