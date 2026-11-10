## MODIFIED Requirements

### Requirement: Individual bot views expose recovery
The bot header, Chat, Environment and Sessions SHALL expose shared engine status and relevant recovery actions. Unreachable engines SHALL offer Check again and instructions to start the engine. Changed identities SHALL offer Use this engine with confirmation. Missing images SHALL offer Build image; missing or outdated containers SHALL offer the relevant create or recreate action. No action SHALL implicitly accept a different engine identity. After explicit adoption, session preparation SHALL build a missing image and create missing owned environment resources with visible progress.

An environment that is not created, failed, or made from an out-of-date image SHALL be shown as an alert that names the bot and the condition, says what the action does, and carries that action as its primary button. The alert SHALL be a warning for not created and out of date, and an error for failed. When the action fails, its reason SHALL appear inside the same alert, and the alert SHALL stay until the environment's state changes. An engine name conflict SHALL be reported as a conflict with an existing container, with the way to resolve it.

#### Scenario: Engine reset at the saved address
- **WHEN** the saved address answers with a missing or different identity marker
- **THEN** the bot shows the identity-change reason and confirmed reselection action without mutating engine resources before confirmation

#### Scenario: Fresh bot after adoption
- **WHEN** a user starts a bot on an explicitly adopted empty engine
- **THEN** image build and environment creation are visible and the session can start without navigating away from the bot

#### Scenario: Environment not created
- **WHEN** a user opens a bot whose environment is not created on an available engine with a built image
- **THEN** a warning alert names the bot, says its environment is not created, and offers Create environment as its primary action

#### Scenario: Create fails
- **WHEN** a user chooses Create environment and the engine refuses
- **THEN** the alert stays, shows the refusal's reason inside itself, and still offers the action
