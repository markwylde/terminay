## MODIFIED Requirements

### Requirement: Extensions section content

The Extensions section SHALL name the selected Terminay Server as the authority. It SHALL show:

- the built-in agents and TypeScript language cards
- installed and disabled states
- available explicit updates
- compatibility and failure details
- permissions
- dependants
- **Install from npm…**

A session source extension's card SHALL show its harness switches. A language server extension's card SHALL show the languages it serves and an enable toggle for that extension.

#### Scenario: Viewing extension state

- **WHEN** the user opens Extensions
- **THEN** the selected server is named as the authority and built-in cards,
  installed and disabled state, available explicit updates, compatibility and
  failure detail, permissions, dependants, and **Install from npm…** are shown

#### Scenario: Viewing the built-in agents extension

- **WHEN** the user views the built-in agents extension's card
- **THEN** it shows switches for Claude Code, Codex, Grok, oh-my-pi, and Antigravity

#### Scenario: Viewing a language server extension

- **WHEN** the user views a language server extension's card
- **THEN** it shows the languages that extension serves and a per-extension enable
  toggle
