## ADDED Requirements

### Requirement: Bots provide a complete shared desktop

Each bot SHALL provide one XFCE display shared by human viewers and agent tools, with a window manager, application menu, taskbar, clock, terminal and Chromium. It SHALL start independently of executions, without setup dialogs or screen blanking. Desktop processes SHALL be lifecycle-supervised and critical failures SHALL fail the environment. Chromium SHALL run unprivileged with its sandbox enabled.

#### Scenario: First desktop start

- **WHEN** a bot starts with a new home
- **THEN** its desktop opens Chromium and offers the application menu, taskbar and terminal without a setup dialog

#### Scenario: Execution ends

- **WHEN** an agent execution completes
- **THEN** its desktop and browser remain available to the user

### Requirement: Creative applications are installed and usable

The image SHALL install pinned amd64/arm64 versions of PhotoCraft, VectorCraft, FilmCraft, LightCraft, PDFCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft and GridCraft. Menu launchers and software graphics SHALL make them usable without a GPU. Home documents SHALL survive recreation. Missing downloads or failed installation SHALL fail the build visibly.

#### Scenario: Creative app on a headless engine

- **WHEN** a user launches an installed creative application from the desktop menu on a supported engine without a GPU
- **THEN** its window renders on the shared desktop and it can save a document into the persistent home

### Requirement: Browser profile and downloads are persistent and shared

The desktop launcher, menu and browser tools SHALL use one bot-owned persistent Chromium profile. Downloads SHALL go into the bot's home without a location prompt. Browser automation SHALL attach to the desktop's running browser rather than creating a separate hidden browser/profile. Restart recovery SHALL clear only stale browser locks for that bot's profile.

#### Scenario: Restart after downloading

- **WHEN** a bot downloads a file and its container is recreated
- **THEN** the file and browser profile remain in that bot's home

#### Scenario: Menu browser and agent browser

- **WHEN** a user opens a browser window from the application menu
- **THEN** the agent's browser tools can observe that window in the same profile

### Requirement: Desktop tools are scoped to an execution and shared-work ownership

Active executions owning shared work SHALL receive screenshot/crop/window, focus, mouse/keyboard/scroll, app-launch and browser save/automation tools on the shared desktop. Dispatch SHALL refuse revoked, expired, wrong-bot or non-owning capabilities. Posted screenshots SHALL use durable attachments. Tools SHALL grant no Terminay workspace or host-filesystem authority. Same-bot processes SHALL remain one trust domain.

#### Scenario: Agent edits a desktop document

- **WHEN** an execution owns shared work and performs a screenshot and input actions in a creative application
- **THEN** the tools operate on the desktop the user sees and any posted screenshot is captured as a durable attachment

#### Scenario: Execution lacks work ownership

- **WHEN** a coordination execution without the work lease requests browser or desktop access
- **THEN** the request is refused until it obtains ownership

### Requirement: Desktop services retain Terminay access boundaries

The desktop SHALL require its bootstrap-delivered VNC credential and listen only on container loopback, with no published container ports. Desktop-control/CDP services SHALL also be private to the bot container. Human access SHALL use the authenticated Terminay relay and enforce view-only input suppression. Bootstrap failure SHALL leave desktop/control services unavailable. Browser/desktop service addresses SHALL NOT be accepted from untrusted clients as arbitrary proxy targets.

#### Scenario: View-only client sends input

- **WHEN** a view-only desktop client sends keyboard, pointer or clipboard traffic
- **THEN** the server discards it before it reaches the bot desktop

### Requirement: Public installations build a self-contained runtime locally

Terminay SHALL ship every runtime input and build `terminay-bot:local` from public sources with pinned CLI/application versions and required notices. No Atlas source, package, service or private registry credential SHALL be required. Fingerprints SHALL cover all inputs and generated layers. Failed builds SHALL retain the previous image; recreation SHALL preserve homes. Existing engine identity, labels, limits and proxy contracts SHALL continue.

#### Scenario: Independent public checkout

- **WHEN** a user builds from a fresh public Terminay checkout with a supported engine, public network access and no Atlas checkout or private registry credentials
- **THEN** the complete bot image builds and runs from Terminay-owned inputs

#### Scenario: Build fails during app installation

- **WHEN** an application's pinned download or installation fails
- **THEN** the build fails with its failing step identified and the previous successful image remains usable
