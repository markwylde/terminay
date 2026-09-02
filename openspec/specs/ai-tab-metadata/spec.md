# ai-tab-metadata Specification

## Purpose

AI tab metadata generates a concise terminal tab title or note from bounded recent terminal context using a configured Codex or Claude Code provider. Terminay Server owns provider discovery and execution, bounded context, settings, and the resulting server-state mutation.

## Requirements

### Requirement: AI metadata commands

The Command Bar SHALL contain two Terminal actions: **Set tab title with AI** and **Set tab note with AI**. Each action SHALL target the exact active terminal and panel revision, report a clear error when no live terminal is active, report when its provider is disabled or unavailable, remain searchable without requiring a default shortcut, generate one value and apply it only after the original target is revalidated, and never silently retarget after focus, title, project, view, or connection changes.

#### Scenario: Invoking a generation command

- **WHEN** a user invokes **Set tab title with AI** or **Set tab note with AI**
- **THEN** the action targets the exact active terminal and panel revision captured at invocation

#### Scenario: No live terminal

- **WHEN** no live terminal is active
- **THEN** the command reports a clear error

#### Scenario: Provider disabled or unavailable

- **WHEN** the command's configured provider is disabled or unavailable
- **THEN** the command reports that state

#### Scenario: Focus changes before the result arrives

- **WHEN** focus, title, project, view, or connection changes while generation is in flight
- **THEN** the result is applied only after the original target is revalidated and is never silently retargeted

#### Scenario: Command discoverability

- **WHEN** a user searches the Command Bar
- **THEN** both actions are findable without a default shortcut being assigned

### Requirement: Canonical metadata mutation

The title command SHALL replace the terminal's display title. The note command SHALL replace or fill the terminal note. Both updates SHALL be canonical server mutations and SHALL reach every authorized connected client.

#### Scenario: Title applied

- **WHEN** a generated title is applied
- **THEN** the terminal's display title is replaced through a canonical server mutation

#### Scenario: Note applied

- **WHEN** a generated note is applied
- **THEN** the terminal note is replaced or filled through a canonical server mutation

#### Scenario: Multiple connected clients

- **WHEN** a metadata update is confirmed by the server
- **THEN** every authorized connected client sees the same update

### Requirement: Independent title and note settings

Title and note generation SHALL be configured independently through `aiTabMetadata.title.provider`, `aiTabMetadata.title.model`, `aiTabMetadata.note.provider`, and `aiTabMetadata.note.model`. Provider values SHALL be `disabled`, `codex`, or `claude-code`. Both providers SHALL default to `disabled`. A model field SHALL be visible and enabled only when its provider is enabled. Title and note SHALL NOT be required to use the same provider or model.

#### Scenario: Default configuration

- **WHEN** a server has no AI tab metadata configuration
- **THEN** both the title and note providers are `disabled`

#### Scenario: Model field gating

- **WHEN** a provider setting is `disabled`
- **THEN** its corresponding model field is hidden or disabled

#### Scenario: Different providers for title and note

- **WHEN** a user selects `codex` for the title and `claude-code` for the note
- **THEN** both settings are accepted and used independently

### Requirement: Settings model-list presentation

The settings UI SHALL request the model list from Terminay Server. It SHALL show loading, unavailable, empty, and error states, and SHALL preserve a saved model that is temporarily absent, marking it as unavailable. Changing provider SHALL clear an incompatible model selection.

#### Scenario: Model list states

- **WHEN** the settings UI requests the model list
- **THEN** it shows loading, unavailable, empty, or error state as appropriate

#### Scenario: Saved model temporarily absent

- **WHEN** a saved model is not present in the returned catalogue
- **THEN** the saved model is preserved and marked as unavailable

#### Scenario: Provider changed

- **WHEN** a user changes the provider to one incompatible with the saved model
- **THEN** the model selection is cleared

### Requirement: Provider adapter interface

Provider adapters SHALL expose a common server interface to list available models, generate a title, and generate a note. Codex and Claude Code SHALL execute on the server machine using that machine's configured CLI and provider environment. Provider-specific commands, model-list formats, response envelopes, stderr, and exit codes SHALL remain inside the adapter.

#### Scenario: Common adapter surface

- **WHEN** the server uses a configured provider
- **THEN** it lists models, generates a title, and generates a note through the same adapter interface

#### Scenario: Provider specifics contained

- **WHEN** a provider returns its own envelope, stderr, or exit code
- **THEN** those details stay inside the adapter and do not cross its boundary

### Requirement: Provider execution stays on the server machine

Provider execution location SHALL NOT change when the target terminal is SSH- or Puzed-backed. Bounded context SHALL come from the server-owned terminal stream, and the adapter SHALL NOT be given a remote project path as a local filesystem path.

#### Scenario: Remote-backed terminal

- **WHEN** the target terminal is backed by an SSH or Puzed project environment
- **THEN** the provider still executes on the server machine using context from the server-owned terminal stream
- **AND** no remote project path is passed to the adapter as a local filesystem path

### Requirement: Bounded provider process execution

The server implementation SHALL build Codex and Claude Code adapters through `createServerAiProviderAdapters` in `packages/server-core`, owning the bounded child-process environment, model-catalog cache, CLI output cap, timeout, and credential callback. A credential callback MAY inject a vault secret into the short-lived provider environment, but the secret SHALL NOT be part of an adapter model or status snapshot or any client payload. Provider output SHALL be bounded and credential-redacted before it crosses the adapter boundary. A cancelled or timed-out child SHALL be terminated and, if necessary, force-killed, with a typed server error.

#### Scenario: Secret injection

- **WHEN** a credential callback injects a vault secret into the provider environment
- **THEN** the secret appears in no adapter model snapshot, status snapshot, or client payload

#### Scenario: Output bounding and redaction

- **WHEN** a provider writes output
- **THEN** the output is bounded and credential-redacted before crossing the adapter boundary

#### Scenario: Cancellation or timeout

- **WHEN** a provider request is cancelled or times out
- **THEN** the child process is terminated, force-killed if necessary, and a typed server error is returned

### Requirement: Provider-specific discovery and generation paths

Codex model discovery SHALL use its JSON catalog command by default. Claude Code generation SHALL use its non-interactive stream output mode, and its model catalog SHALL be provided by a bounded server configuration or an injected host command because the CLI exposes no stable non-interactive catalog command. Both paths SHALL normalize model IDs and labels and keep provider-specific envelopes inside the adapter.

#### Scenario: Codex model discovery

- **WHEN** the server discovers Codex models
- **THEN** it uses the Codex JSON catalog command by default

#### Scenario: Claude Code catalog

- **WHEN** the server discovers Claude Code models
- **THEN** the catalog comes from a bounded server configuration or an injected host command

#### Scenario: Claude Code generation

- **WHEN** the server generates a title or note with Claude Code
- **THEN** it uses the CLI's non-interactive stream output mode

### Requirement: Model discovery bounds

Model discovery SHALL be bounded by time and output size, SHALL normalize provider results into a stable model id and display label, MAY use a short server-side cache, SHALL NOT invent a model when discovery fails, and SHALL report actionable sanitized errors.

#### Scenario: Discovery within bounds

- **WHEN** model discovery runs
- **THEN** it is bounded by time and output size and returns normalized model ids and display labels

#### Scenario: Discovery fails

- **WHEN** model discovery fails
- **THEN** no model is invented and an actionable sanitized error is reported

### Requirement: Client isolation from provider internals

Remote clients SHALL NOT receive provider credentials, provider configuration files, raw process environment, or unbounded provider output.

#### Scenario: Remote client inspects responses

- **WHEN** a remote client receives any AI tab metadata response
- **THEN** it contains no provider credential, provider configuration file, raw process environment, or unbounded provider output

### Requirement: Bounded generation context

The server SHALL collect recent context from its bounded terminal replay buffer; a client xterm instance SHALL NOT be the source of truth. Context SHALL contain only bounded recent terminal text, the current display title or note where relevant, optional safe shell or process metadata, and explicit length and truncation metadata. Context SHALL exclude other terminals and projects, settings and secrets, hidden connection credentials, recording files, arbitrary filesystem content, and unbounded scrollback. ANSI and control sequences SHALL be stripped or normalized before provider submission, and the size limit SHALL be enforced before the adapter runs. Full terminal scrollback SHALL NOT be sent merely because it is available.

#### Scenario: Context source

- **WHEN** the server builds generation context
- **THEN** it reads the server-owned bounded terminal replay buffer rather than a client xterm instance

#### Scenario: Context exclusions

- **WHEN** generation context is assembled
- **THEN** it contains no other terminal's or project's content, no settings or secrets, no hidden connection credentials, no recording files, no arbitrary filesystem content, and no unbounded scrollback

#### Scenario: Sanitization and size

- **WHEN** context is submitted to a provider
- **THEN** ANSI and control sequences are stripped or normalized and the size limit is enforced before the adapter runs

### Requirement: Generated title output rules

A generated title SHALL be plain text, SHALL be one concise line, SHALL have surrounding quotes, labels, Markdown, and terminal control sequences removed, SHALL be bounded to the configured title length, and SHALL be rejected if empty after normalization.

#### Scenario: Title normalization

- **WHEN** a provider returns a title
- **THEN** surrounding quotes, labels, Markdown, and terminal control sequences are removed and the result is one concise plain-text line bounded to the configured title length

#### Scenario: Empty title

- **WHEN** a generated title is empty after normalization
- **THEN** it is rejected and the existing title is unchanged

### Requirement: Generated note output rules

A generated note SHALL be concise plain text, MAY contain line breaks within the configured note limit, SHALL have terminal control sequences and provider wrapper text removed, and SHALL be rejected if empty after normalization.

#### Scenario: Note normalization

- **WHEN** a provider returns a note
- **THEN** terminal control sequences and provider wrapper text are removed and the note stays within the configured note limit

#### Scenario: Empty note

- **WHEN** a generated note is empty after normalization
- **THEN** it is rejected and the existing note is unchanged

### Requirement: Revision-checked application

The server SHALL apply the result with the expected panel and metadata revision. A concurrent manual edit SHALL produce a conflict instead of being overwritten, and the client SHALL be able to retry against the new revision.

#### Scenario: Concurrent manual edit

- **WHEN** a user manually edits the title or note while generation is in flight
- **THEN** applying the generated result produces a conflict and the manual edit is preserved

#### Scenario: Retry after conflict

- **WHEN** a client receives a revision conflict
- **THEN** it can retry the generation against the new revision

### Requirement: Privacy and disclosure

Settings SHALL identify the selected provider and explain that bounded terminal context is sent to it. Generation SHALL occur only after the user invokes the command. Provider input and output SHALL NOT be written to normal logs or analytics. Server diagnostics SHALL record only bounded status metadata needed for support. Disabling a provider SHALL prevent later generation while preserving manually applied titles and notes.

#### Scenario: Disclosure in Settings

- **WHEN** a user views AI tab metadata settings
- **THEN** the selected provider is identified and the settings explain that bounded terminal context is sent to it

#### Scenario: No background generation

- **WHEN** the user has not invoked a generation command
- **THEN** no generation occurs

#### Scenario: Provider disabled after use

- **WHEN** a provider is disabled
- **THEN** later generation is prevented and previously applied titles and notes are preserved

#### Scenario: Logging boundaries

- **WHEN** a generation request runs
- **THEN** provider input and output do not appear in normal logs or analytics and diagnostics record only bounded status metadata

### Requirement: Failure behaviour

Missing provider CLI, authentication failure, unavailable model, timeout, oversized response, malformed result, exited terminal, revision conflict, and revoked client authorization SHALL be distinct errors. A failed request SHALL leave the existing title or note unchanged. Disconnect SHALL NOT cause the result to target another client or terminal. Cancelling a request SHALL terminate or detach provider work according to the adapter's bounded cancellation policy and SHALL prevent mutation. Provider failure SHALL NOT affect terminal or server availability.

#### Scenario: Distinct error reporting

- **WHEN** a generation request fails
- **THEN** the reported error distinguishes missing provider CLI, authentication failure, unavailable model, timeout, oversized response, malformed result, exited terminal, revision conflict, and revoked client authorization

#### Scenario: Failure leaves metadata unchanged

- **WHEN** a generation request fails
- **THEN** the existing title or note is unchanged and terminal and server availability are unaffected

#### Scenario: Client disconnects mid-request

- **WHEN** the requesting client disconnects
- **THEN** the result does not target another client or terminal

#### Scenario: Request cancelled

- **WHEN** a user cancels a generation request
- **THEN** provider work is terminated or detached per the adapter's bounded cancellation policy and no mutation occurs

### Requirement: AI tab metadata non-goals

Terminay SHALL NOT perform automatic background renaming, provide a provider installation or login flow, offer an arbitrary prompt editor in this feature, include filesystem or Git context, or spawn provider CLIs on the client.

#### Scenario: No client-side CLI execution

- **WHEN** a generation command runs on any client
- **THEN** no provider CLI is spawned on that client

#### Scenario: No filesystem or Git context

- **WHEN** generation context is built
- **THEN** it contains no filesystem or Git context

### Requirement: AI tab metadata acceptance outcomes

Title and note commands SHALL operate only on the exact active terminal captured at invocation. Local and remote clients SHALL see the same server-confirmed metadata update. A concurrent manual edit SHALL NOT be overwritten by a stale generation result. Provider discovery and generation SHALL be bounded, cancellable, and sanitized. Another terminal's context, server secrets, and provider credentials SHALL NOT enter the request or response. Disabled, unavailable, invalid, and successful provider states SHALL be clear in Settings and the Command Bar.

#### Scenario: Local and remote parity

- **WHEN** a local client and a remote client observe the same terminal after a generation
- **THEN** both see the same server-confirmed metadata update

#### Scenario: Provider state clarity

- **WHEN** a provider is disabled, unavailable, invalid, or working
- **THEN** Settings and the Command Bar each present that state clearly
