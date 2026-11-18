## ADDED Requirements

### Requirement: What's New shows the monthly post from terminay.com

The What's New section SHALL show the embedded What's New page published at `https://terminay.com/whats-new/embed/`, filling the section's tab. The embedded page SHALL load nothing from any origin other than terminay.com. The page SHALL open on the most recent monthly post and SHALL offer its own way to browse earlier posts. Browsing earlier posts SHALL stay inside the section's tab.

#### Scenario: Opening What's New

- **WHEN** a user activates What's New in the Home sidebar while terminay.com is reachable
- **THEN** a What's New tab opens showing the most recent monthly post

#### Scenario: Browsing an earlier month

- **WHEN** a user picks an earlier month on the What's New page
- **THEN** that month's post is shown in the same What's New tab

### Requirement: What's New matches the workspace appearance

The workspace SHALL ask the What's New page for the dark appearance that Home is drawn in, whatever appearance the operating system prefers, so that the post never appears as a light page inside the dark workspace.

#### Scenario: System prefers light

- **WHEN** the operating system prefers a light appearance and the user opens What's New
- **THEN** the page is requested and drawn in its dark appearance, like the rest of Home

### Requirement: What's New is isolated from the workspace

The embedded page SHALL run in a sandboxed frame. It SHALL NOT reach the workspace document, the host bridge, terminals, projects, or settings, and SHALL NOT navigate the workspace. The workspace SHALL send terminay.com nothing but the embedded page's address and the appearance. It SHALL send no referrer, and no project, terminal, server, device, or user identity. The workspace SHALL allow framing and fetching from `https://terminay.com` only, and from no other new origin.

#### Scenario: Request contents

- **WHEN** the workspace loads the What's New page
- **THEN** the request names only the embedded page's address and the appearance, and carries no referrer

#### Scenario: Page tries to navigate the workspace

- **WHEN** the embedded page tries to navigate its top-level window
- **THEN** the workspace stays where it is

#### Scenario: Another origin

- **WHEN** content in the workspace tries to frame or fetch an origin other than the workspace's own origin and `https://terminay.com`
- **THEN** the content security policy refuses it

### Requirement: What's New links open in the user's browser

When the user activates a link on the What's New page, the workspace SHALL open it outside the workspace through the host's external-link route, but only when it is a credential-free `https` URL and the request comes from the `https://terminay.com` frame the section shows. Every other link request SHALL be ignored.

#### Scenario: Following a link

- **WHEN** the user activates a link to `https://terminay.com/docs/bots/` on the What's New page in Desktop
- **THEN** the system browser opens that address and the What's New tab is unchanged

#### Scenario: Unsafe link

- **WHEN** the page asks to open a `file:` URL, or a URL that carries credentials
- **THEN** nothing opens

#### Scenario: Message from elsewhere

- **WHEN** a frame from any other origin posts a request to open a link
- **THEN** nothing opens

### Requirement: What's New when terminay.com cannot be reached

When the What's New page cannot be loaded within 15 seconds, or the network is offline, the section SHALL show a notice saying What's New could not be loaded, with a Retry action and a link that opens the page in the user's browser. Retry SHALL try loading the page again. The section SHALL NOT show a blank or broken frame.

#### Scenario: Offline

- **WHEN** a user opens What's New while terminay.com is unreachable
- **THEN** the section shows the notice with Retry and Open in browser

#### Scenario: Retry after reconnecting

- **WHEN** the user activates Retry once terminay.com is reachable again
- **THEN** the most recent monthly post is shown

### Requirement: Latest-post announcement is read on demand

The workspace SHALL read the latest-post announcement at `https://terminay.com/whats-new/latest.json`, which names the most recent post's identifier, only when the workspace starts and when the user selects Home, and not within an hour of the last announcement it read successfully. It SHALL NOT re-read it on a timer. An announcement that cannot be fetched or parsed SHALL leave the previous state, SHALL report no error, and SHALL NOT delay the next on-demand read.

#### Scenario: Read failed at start

- **WHEN** the announcement could not be read when the workspace started and the user then selects Home
- **THEN** the announcement is read again

#### Scenario: Selecting Home again soon

- **WHEN** the announcement was read ten minutes ago and the user selects Home
- **THEN** it is not read again

#### Scenario: Idle workspace

- **WHEN** the workspace stays open without the user selecting Home
- **THEN** the announcement is not read again

### Requirement: Unread cue for a new monthly post

The What's New sidebar item SHALL show an unread dot when the announced identifier differs from the last identifier this device marked as viewed, including on a device that has never opened What's New. Opening the section SHALL mark the announced identifier as viewed on this device and clear the dot. The viewed identifier SHALL be device presentation state. The dot SHALL be part of the item's accessible name.

#### Scenario: New post published

- **WHEN** the device last viewed `2026-11` and the announcement names `2026-12`
- **THEN** the What's New item shows an unread dot and its accessible name says there is a new post

#### Scenario: Opening clears the dot

- **WHEN** the What's New item shows the dot and the user opens What's New
- **THEN** the dot clears and stays clear until a different post is announced

#### Scenario: Announcement unavailable

- **WHEN** the announcement cannot be fetched or is not valid
- **THEN** the dot is unchanged and no error is shown

#### Scenario: Another device

- **WHEN** the user opens What's New on a laptop
- **THEN** a phone connected to the same server still shows its own dot until What's New is opened there
