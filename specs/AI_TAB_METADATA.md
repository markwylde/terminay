# AI Tab Metadata Specification

## Summary

Terminay should let the user generate terminal tab metadata from the Command bar. Pressing `Cmd/Ctrl+L` opens the existing Command bar, where the user can choose:

- Set tab title with AI
- Set tab note with AI

Both actions are controlled by Settings. Each action has a provider select box that starts disabled by default:

- Set title with AI: `Disable`, `Codex`, `Claude Code`
- Set note with AI: `Disable`, `Codex`, `Claude Code`

When the user chooses `Codex` or `Claude Code`, Settings should ask the provider service for available models and then show a second model dropdown for that action.

## What We Are Trying To Do

The goal is to make terminal tabs easier to understand after work has started. A user should be able to run a command from the Command bar and have Terminay ask the configured AI provider to summarize the active terminal into either:

- a concise tab title, replacing the current Dockview tab title
- a short terminal note, filling the existing note area above the terminal

This feature should feel like a natural extension of Terminay's existing workflow:

- `Cmd/Ctrl+L` already opens the Command bar.
- The Command bar already mixes app commands and macros.
- Terminal titles can already be edited manually.
- Terminal notes already exist on terminal panels.
- Settings already owns command-related preferences and persists them through Electron IPC.

The implementation should not hard-code the product around one provider. Codex and Claude Code are provider implementations behind the same settings and service interfaces so future options can be added without reshaping the UI and persistence model.

## Current Codebase Shape

Terminay is an Electron, React, Vite desktop app.

The main app shell lives in `src/App.tsx`. It owns project tabs, Dockview panels, terminal creation, command execution, the Command bar, and most workspace-level state. Terminal, file, and folder tabs are all Dockview panels with custom tab headers.

The Command bar is opened by the `open-command-bar` app command, which defaults to `CmdOrCtrl+L`. Built-in command metadata and default shortcuts live in `src/keyboardShortcuts.ts`, and the command union lives in `src/types/terminay.ts`. `src/App.tsx` builds the visible Command bar items locally, grouping them into Terminal, Workspace, and Macros.

Terminal tab metadata already exists:

- The tab title is the Dockview panel title and is updated with `panel.api.setTitle(...)`.
- Terminal color, emoji, activity settings, and note state live in Dockview panel params.
- Terminal notes are rendered by `src/components/TerminalPanel.tsx` when `terminalNote` is a string.
- Terminal note edits flow through `onUpdateNote` into `panel.api.updateParameters({ terminalNote })`.
- Manual title and appearance editing is handled through `openTerminalEditWindow(...)`.
- Remote terminal metadata is kept in sync through `window.terminay.updateTerminalRemoteMetadata(...)`.

Settings are modeled as `TerminalSettings` in `src/types/settings.ts`, defaulted and described in `src/terminalSettings.ts`, rendered by `src/components/SettingsWindow.tsx`, and persisted by Electron in `terminal-settings.json`. Settings normalization happens in `normalizeTerminalSettings(...)`, so any new nested settings must be defaulted and sanitized there. Settings changes are broadcast by Electron with `settings:terminal-changed`.

Renderer-to-main APIs are exposed through `electron/preload.ts` as `window.terminay.*`. Electron IPC handlers live primarily in `electron/main.ts`, with file-viewer functionality split into dedicated services under `electron/fileViewer/`. AI provider work should follow that split-service pattern rather than expanding `src/App.tsx` with process execution or model-fetching details.

## Product Decisions

### Command Bar Actions

- Add two built-in Command bar actions:
  - Set tab title with AI
  - Set tab note with AI
- These actions should appear in the Terminal group.
- The actions should only operate on the active terminal panel.
- If no terminal panel is active, show the same style of inline error currently used by other terminal-only commands.
- If the relevant setting is disabled, the command should explain that the user must enable a provider in Settings.
- The actions do not need default keyboard shortcuts in this first version beyond being searchable from the Command bar.

### Settings

- Add a new settings section for AI tab metadata.
- Add provider fields:
  - `aiTabMetadata.title.provider`
  - `aiTabMetadata.note.provider`
- The initial provider options are:
  - `disabled`
  - `codex`
  - `claudeCode`
- `disabled` is the default for both title and note.
- When either provider is `codex`, show a model select box for that action:
  - `aiTabMetadata.title.codexModel`
  - `aiTabMetadata.note.codexModel`
- When either provider is `claudeCode`, show a model select box for that action:
  - `aiTabMetadata.title.claudeCodeModel`
  - `aiTabMetadata.note.claudeCodeModel`
- The model dropdown should be populated from the selected provider's available model list.
- If model loading fails, keep the provider selected but show an actionable error near the model dropdown.
- If no model has been selected yet, choose a sensible first available model only after the list loads successfully.

### Provider Shape

The settings and runtime code should treat Codex and Claude Code as provider implementations behind a provider interface.

Suggested settings shape:

```ts
type AiTabMetadataProvider = 'disabled' | 'codex' | 'claudeCode'

type AiTabMetadataTargetSettings = {
  provider: AiTabMetadataProvider
  claudeCodeModel: string
  codexModel: string
}

type AiTabMetadataSettings = {
  title: AiTabMetadataTargetSettings
  note: AiTabMetadataTargetSettings
}
```

This shape intentionally keeps title and note configuration separate. A user might want fast or cheap title generation and a more capable note model later.

### Model Discovery

- Electron main should expose an IPC API for listing models for a provider.
- The renderer should call that API from Settings when a Codex or Claude Code provider is selected.
- Model discovery should be cached for the lifetime of the app process, with a refresh path available later.
- The API should return normalized display data, not raw CLI output.
- The UI should not assume a single provider.

Suggested renderer API:

```ts
listAiTabMetadataModels(provider: 'codex' | 'claudeCode'): Promise<Array<{ id: string; label: string }>>
```

### Generation Behavior

- The active terminal's recent visible or buffered output should be used as context.
- The title prompt should request a short, specific title suitable for a terminal tab.
- The note prompt should request a compact note that helps the user understand what is happening in the terminal.
- Generated titles should be trimmed and limited to a reasonable tab length.
- Generated notes should be plain text and should not include Markdown fences.
- Applying a generated note should create/show the existing note area if it is not already present.
- Applying a generated title should also update remote terminal metadata for that session, matching the manual edit flow.

## Non-Goals

- This spec does not require chat UI.
- This spec does not require streaming output.
- This spec does not require user prompt customization.
- This spec does not require providers beyond Codex in the first implementation.
- This spec does not require adding default keyboard shortcuts for the new actions.
- This spec does not require AI generation for file or folder tabs.

## UX Requirements

- The Command bar should close after the user chooses either AI action.
- While generation is running, the app should show a clear in-progress state and avoid starting duplicate generation for the same target.
- Success should update the tab title or note without opening the manual edit window.
- Failure should leave the current title/note unchanged.
- Settings should reveal model dropdowns only when the provider selection needs them.
- Disabled settings should be explicit; users should not need an API key or Codex installation just to keep using Terminay.

## Architecture

### 1. Settings Model

Extend `TerminalSettings` with an `aiTabMetadata` object. Update default settings, normalization, field definitions, and settings rendering support.

The existing generic `getValueAtPath(...)` can read deeper paths, but `setValueAtPath(...)` currently only handles one nested level under a small allowlist. It will need to support deeper settings paths or a more general immutable path setter for known settings objects.

### 2. Settings UI

Add a settings section, likely under the existing Shortcuts/Interaction area or a new AI category if the product wants it separated. The UI needs conditional fields because the model select boxes only appear when the corresponding provider is `codex`.

The existing `SettingsFieldDefinition` supports static select options. Model selects are dynamic, so Settings will need either:

- a specialized render path for AI model fields, or
- a small extension to field definitions for dynamic options.

### 3. AI Provider Service

Create an Electron-side service that knows how to:

- list models for Codex
- generate tab titles
- generate tab notes
- normalize provider errors
- enforce output length and plain-text constraints

The service should sit outside React and be reached through preload IPC. `src/App.tsx` should ask for generation through `window.terminay`, not spawn Codex or parse model output directly.

### 4. Terminal Context Collection

Add a renderer-side way to gather recent context from the active terminal. Prefer a focused, minimal API that can be implemented from existing terminal/session state:

- session id
- current title
- project title/root
- recent terminal output or buffer excerpt
- existing terminal note, if any

Avoid sending unbounded scrollback to the provider.

### 5. Command Bar Integration

Add the two Command bar entries to `src/App.tsx` near the other Terminal actions. They should call helper functions that:

- validate the active panel is a terminal
- read the relevant settings target
- validate provider/model availability
- collect terminal context
- call the AI generation IPC
- apply the result to the active terminal panel

### 6. Tests

Unit-level tests should cover settings normalization for old settings files, disabled defaults, invalid providers, and invalid model values.

E2E tests should cover Settings UI visibility and Command bar behavior with mocked AI IPC. The tests should not require a real Codex installation or network access.

## Open Questions

- What exact Codex command/API should be used for model discovery and generation?
- Should title and note generation use visible terminal output only, or full scrollback up to a capped size?
- Should the generated note replace an existing note, append to it, or ask before replacing? Initial recommendation: replace only after explicit Command bar action.
- Should AI errors be shown as the existing app-level error text, a toast-like status, or an inline Command bar state?

## Implementation Checklist

### Settings Model

- [x] Add `AiTabMetadataProvider`, `AiTabMetadataTargetSettings`, and `AiTabMetadataSettings` types.
- [x] Add `aiTabMetadata` to `TerminalSettings`.
- [x] Add disabled defaults for title and note provider settings.
- [x] Add Claude Code provider and model settings alongside Codex.
- [x] Normalize missing, invalid, or legacy `aiTabMetadata` values in `normalizeTerminalSettings(...)`.
- [x] Update the settings path setter so nested keys like `aiTabMetadata.title.provider` can be saved.

### Settings UI

- [x] Add provider select boxes for title and note generation.
- [x] Add conditional Codex model select boxes for title and note generation.
- [x] Add conditional Claude Code model select boxes for title and note generation.
- [x] Load Codex models when either Codex provider is selected.
- [x] Load Claude Code models when either Claude Code provider is selected.
- [x] Show loading and error states for model dropdowns.
- [x] Keep Settings searchable by AI, Codex, Claude, title, note, and model keywords.

### IPC And Provider Service

- [x] Add preload API methods for listing AI models and generating tab metadata.
- [x] Add Electron IPC handlers for AI model listing and generation.
- [x] Create an Electron-side AI tab metadata service.
- [x] Implement Codex model discovery behind the provider service.
- [x] Implement Codex title generation behind the provider service.
- [x] Implement Codex note generation behind the provider service.
- [x] Implement Claude Code model discovery behind the provider service.
- [x] Provide a small built-in Claude Code model list because the CLI does not expose model discovery.
- [x] Implement Claude Code title generation behind the provider service.
- [x] Implement Claude Code note generation behind the provider service.
- [x] Normalize provider failures into user-readable errors.
- [x] Cache model discovery results for the app process lifetime.

### Command Bar And Workspace

- [x] Add "Set tab title with AI" to the Terminal Command bar group.
- [x] Add "Set tab note with AI" to the Terminal Command bar group.
- [x] Validate that the active Dockview panel is a terminal before generating.
- [x] Collect bounded terminal context for the active terminal.
- [x] Apply generated titles with `panel.api.setTitle(...)`.
- [x] Apply generated notes with `panel.api.updateParameters({ terminalNote })`.
- [x] Sync generated title metadata to remote terminal clients.
- [x] Prevent duplicate in-flight generation for the same active tab target.

### Tests And Documentation

- [x] Add settings normalization tests for the new settings object.
- [x] Add Settings e2e coverage for disabled defaults and Codex model dropdown visibility.
- [x] Add Command bar e2e coverage for both AI actions with mocked generation.
- [x] Add failure-path e2e coverage for disabled provider and provider error states.
- [x] Update docs for Settings and Command bar once the feature ships.

### CI Real Provider Coverage

- [x] Install Codex CLI in CI when `OPENROUTER_API_KEY` is available.
- [x] Configure Codex CLI to use OpenRouter through `CODEX_HOME/config.toml`.
- [x] Allow CI to provide a fixed Codex model for model discovery.
- [x] Add a focused `test:e2e:ai-real` script for the real-provider smoke test.
- [x] Add an opt-in real Codex e2e smoke test for title and note generation.
- [x] Install Claude Code in CI when `OPENROUTER_API_KEY` is available.
- [x] Configure Claude Code through OpenRouter environment variables.
- [x] Add a focused `test:e2e:ai-real-claude` script for the real-provider smoke test.
- [x] Add an opt-in real Claude Code e2e smoke test using `~anthropic/claude-haiku-latest`.
- [x] Keep the default e2e suite mocked so forks and local runs do not require network credentials.
