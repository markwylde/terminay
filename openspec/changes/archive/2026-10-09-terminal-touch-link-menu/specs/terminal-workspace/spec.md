## MODIFIED Requirements

### Requirement: Terminal link and input safety

Terminal content SHALL be treated as untrusted text. Modifier-clicking a detected or OSC-8 HTTP or HTTPS link SHALL open that credential-free URL in the system browser; other schemes and URLs with credentials SHALL be rejected. A touch tap on a link SHALL NOT open it; it SHALL show a link menu with **Copy Text**, which copies the link's visible text, **Copy Link**, which copies its URL, and **Open Link**, which opens it as a modifier-click does. On iOS and Android the menu SHALL also offer **Open in Browser**, which hands a credential-free HTTP or HTTPS URL to the platform browser app through its URL scheme so it opens outside an installed web app. A tap on a link SHALL NOT focus the terminal. Paste and external drop behaviour SHALL remain user initiated. Screen-reader and reduced-motion settings SHALL be honoured. Secrets typed in a terminal SHALL NOT be collected by default; recording has its own explicit policy.

#### Scenario: Modifier-clicking a link

- **WHEN** a user modifier-clicks a detected `http://` or `https://` terminal link, including an OSC-8 hyperlink
- **THEN** that credential-free URL opens in the system browser

#### Scenario: Tapping a link on touch

- **WHEN** a user taps a terminal link on a touch device
- **THEN** the link is not opened and the terminal is not focused
- **AND** a menu offers Copy Text, Copy Link, and Open Link

#### Scenario: Copying an OSC-8 hyperlink's text

- **WHEN** a user taps an OSC-8 hyperlink and chooses Copy Text
- **THEN** the clipboard receives the text shown in the terminal, not the URL

#### Scenario: Opening in the platform browser

- **WHEN** a user on iOS or Android taps an `https://` link and chooses Open in Browser
- **THEN** the URL is opened through the platform browser's URL scheme rather than an in-app sheet

#### Scenario: Unsafe link

- **WHEN** a terminal link uses another scheme or contains credentials
- **THEN** opening it is rejected
