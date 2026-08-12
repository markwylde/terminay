# AI tab metadata

## Summary

Terminay can generate a concise terminal tab title or note from bounded recent
terminal context using a configured Codex or Claude Code provider.

Generation is an explicit command for the active terminal. Terminay Server owns
provider discovery and execution, bounded context, settings, and the resulting
server-state mutation.

## Commands

The Command Bar contains two Terminal actions:

- **Set tab title with AI**
- **Set tab note with AI**

Each action:

- targets the exact active terminal and panel revision;
- reports a clear error when no live terminal is active;
- reports when its provider is disabled or unavailable;
- remains searchable without requiring a default shortcut;
- generates one value and applies it only after the original target is
  revalidated; and
- never silently retargets after focus, title, project, view, or connection
  changes.

The title command replaces the terminal's display title. The note command
replaces or fills the terminal note. Both updates are canonical server
mutations and reach every authorized connected client.

## Settings

Title and note generation are configured independently:

- `aiTabMetadata.title.provider`
- `aiTabMetadata.title.model`
- `aiTabMetadata.note.provider`
- `aiTabMetadata.note.model`

Provider values are:

- `disabled`
- `codex`
- `claude-code`

Both providers default to `disabled`. A model field is visible and enabled only
when its provider is enabled.

The settings UI requests the model list from Terminay Server. It shows loading,
unavailable, empty, and error states and preserves a saved model that is
temporarily absent, marked as unavailable. Changing provider clears an
incompatible model selection.

Title and note use separate settings because users can choose different cost,
latency, and capability trade-offs.

## Provider boundary

Provider adapters expose a common server interface:

- list available models;
- generate a title; and
- generate a note.

Codex and Claude Code execute on the server machine using that machine's
configured CLI/provider environment. Provider-specific commands, model-list
formats, response envelopes, stderr, and exit codes remain inside the adapter.
This provider execution location does not change when the target terminal is
SSH/Puzed-backed: bounded context comes from the server-owned terminal stream,
and the adapter is never given a remote project path as a local filesystem path.

The server implementation builds Codex and Claude Code adapters through
`createServerAiProviderAdapters` in `packages/server-core`. It owns the bounded
child-process environment, model-catalog cache, CLI output cap, timeout, and
credential callback. A credential callback may inject a vault secret into the
short-lived provider environment, but the secret is never part of an adapter
model/status snapshot or client payload; provider output is bounded and
credential-redacted before it crosses the adapter boundary.

Codex model discovery uses its JSON catalog command by default. Claude Code
generation uses its non-interactive stream output mode; its model catalog is
provided by a bounded server configuration or an injected host command because
the CLI does not expose a stable non-interactive catalog command. Both paths
normalize model IDs/labels and keep provider-specific envelopes inside the
adapter. A cancelled or timed-out child is terminated and, if necessary,
force-killed, with a typed server error.

Remote clients never receive provider credentials, provider configuration
files, raw process environment, or unbounded provider output.

Model discovery:

- is bounded by time and output size;
- normalizes provider results into stable model id and display label;
- can use a short server-side cache;
- never invents a model when discovery fails; and
- reports actionable sanitized errors.

## Context

The server collects recent context from its bounded terminal replay buffer. A
client xterm instance is not the source of truth.

Context contains only what the generation request needs:

- bounded recent terminal text;
- current display title or note where relevant;
- optional safe shell/process metadata; and
- explicit length and truncation metadata.

Context excludes:

- other terminals and projects;
- settings and secrets;
- hidden connection credentials;
- recording files;
- arbitrary filesystem content; and
- unbounded scrollback.

ANSI/control sequences are stripped or normalized before provider submission.
The size limit is enforced before the adapter runs.

## Output rules

A generated title:

- is plain text;
- is one concise line;
- has surrounding quotes, labels, Markdown, and terminal control sequences
  removed;
- is bounded to the configured title length; and
- is rejected if empty after normalization.

A generated note:

- is concise plain text;
- can contain line breaks within the configured note limit;
- has terminal control sequences and provider wrapper text removed; and
- is rejected if empty after normalization.

The server applies the result with the expected panel/metadata revision.
Concurrent manual edits produce a conflict instead of being overwritten. The
client can retry against the new revision.

## Privacy and disclosure

- Settings identify the selected provider and explain that bounded terminal
  context is sent to it.
- Generation occurs only after the user invokes the command.
- Provider input and output are not written to normal logs or analytics.
- Server diagnostics record only bounded status metadata needed for support.
- Disabling a provider prevents later generation but preserves manually applied
  titles and notes.
- Full terminal scrollback is never sent merely because it is available.

## Failure behaviour

- Missing provider CLI, authentication failure, unavailable model, timeout,
  oversized response, malformed result, exited terminal, revision conflict,
  and revoked client authorization are distinct errors.
- A failed request leaves the existing title or note unchanged.
- Disconnect does not cause the result to target another client or terminal.
- Cancelling a request terminates or detaches provider work according to the
  adapter's bounded cancellation policy and prevents mutation.
- Provider failure does not affect terminal or server availability.

## Non-goals

- No automatic background renaming.
- No provider installation or login flow inside Terminay.
- No arbitrary prompt editor in this feature.
- No filesystem or Git context.
- No client-side spawning of provider CLIs.
- No requirement that title and note use the same provider or model.

## Acceptance outcomes

- Title and note commands operate only on the exact active terminal captured at
  invocation.
- Local and remote clients see the same server-confirmed metadata update.
- A concurrent manual edit is not overwritten by a stale generation result.
- Provider discovery and generation are bounded, cancellable, and sanitized.
- Another terminal's context, server secrets, and provider credentials never
  enter the request or response.
- Disabled, unavailable, invalid, and successful provider states are clear in
  Settings and the Command Bar.
