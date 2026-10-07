## ADDED Requirements

### Requirement: HTML preview kind

The server SHALL classify files with the extensions `.html`, `.htm`, and `.xhtml` as text with the preview kind `html`, and SHALL publish that kind only when the file is within the preview size limit. The file viewer SHALL offer both Text and Preview for such a file. A client SHALL NOT treat a file as an HTML preview on the strength of its extension when the server has published a different classification.

#### Scenario: HTML file classification

- **WHEN** the server classifies a file named `index.html`, `page.htm`, or `doc.xhtml` whose content is valid text within the preview size limit
- **THEN** it publishes the preview kind `html`, reports the file as text, and reports Preview as safe

#### Scenario: Tabs offered for an HTML file

- **WHEN** a user opens an HTML file
- **THEN** the view switcher offers both Text and Preview

#### Scenario: HTML file over the preview limit

- **WHEN** an HTML file exceeds the preview size limit
- **THEN** the server does not publish the preview kind `html`
- **AND** the file opens in Text

### Requirement: HTML files open in Preview

A file whose server-published preview kind is `html` SHALL open in Preview, unless the open request names a view or a custom extension default applies.

#### Scenario: Opening an HTML file from the sidebar

- **WHEN** a user opens `index.html` from the file explorer
- **THEN** Preview is the selected view
- **AND** Text is available in the view switcher

#### Scenario: Open request names a view

- **WHEN** an open request for an HTML file names Text
- **THEN** Text is the selected view

### Requirement: HTML preview renders in a sandboxed webview

Preview SHALL render a file of preview kind `html` as a web page inside a frame with an opaque origin, nested in the Terminay sandbox proxy document. The frame SHALL be the same on Terminay Desktop and in a remote browser client. The page, including its script, SHALL have no preload, no host IPC, no application protocol access, no Terminay storage, and no access to the workspace document. A page SHALL NOT replace the document in its frame by navigating; a frame that loads a second document SHALL be removed. A host on which the proxy cannot be framed SHALL report the HTML Preview unavailable with the reason and SHALL NOT render the page by any other means.

#### Scenario: Page renders

- **WHEN** a user selects Preview on an HTML file
- **THEN** the page is rendered as a web page rather than as source text

#### Scenario: Page script runs without authority

- **WHEN** the previewed page contains script
- **THEN** the script runs inside the opaque-origin frame
- **AND** it cannot reach the workspace document, the preload API, the application protocol, or Terminay storage

#### Scenario: Remote browser client

- **WHEN** a remote browser client selects Preview on an HTML file
- **THEN** the page renders in the same sandboxed frame as on Terminay Desktop

#### Scenario: Page navigates itself

- **WHEN** the previewed page navigates its own frame to another document
- **THEN** the frame is removed and the foreign document is not shown as the preview

#### Scenario: Proxy cannot be framed

- **WHEN** the host cannot frame the sandbox proxy
- **THEN** Preview is reported unavailable for the HTML file with the reason
- **AND** the file opens in Text

### Requirement: HTML preview resources stay within the project

An HTML preview SHALL load a resource the page references by relative path — a stylesheet, script, image, font, or media file named in its markup, or a resource named by a `url()` or `@import` in such a stylesheet — when that path resolves, relative to the file's folder, to a file within the server-authorized project scope. Each resource SHALL be obtained through bounded server file reads, and the number and total size of resources for one preview SHALL be bounded. A reference that resolves outside the authorized scope, that exceeds a bound, or that cannot be read SHALL NOT load, and the rest of the page SHALL still render. The page SHALL have no network access: its content security policy SHALL allow no external origin, so a resource addressed to an external origin SHALL NOT load, a fetch, XMLHttpRequest, WebSocket, EventSource, or beacon from page script SHALL be refused, a form SHALL NOT submit, and the policy SHALL ask for WebRTC to be blocked.

#### Scenario: Relative stylesheet and image

- **WHEN** a previewed page references `./style.css` and `img/logo.png` beside it in the project
- **THEN** the stylesheet is applied and the image is shown

#### Scenario: Resource named inside a stylesheet

- **WHEN** a stylesheet loaded by the previewed page names a project font or image with `url()`
- **THEN** that resource loads

#### Scenario: Reference outside the project scope

- **WHEN** a previewed page references `../../outside/secret.css` resolving outside the server-authorized project scope
- **THEN** the resource does not load
- **AND** the rest of the page renders

#### Scenario: External resource

- **WHEN** a previewed page references a script, stylesheet, or image on an external HTTP or HTTPS origin
- **THEN** the resource does not load

#### Scenario: Script attempts a network request

- **WHEN** script in the previewed page attempts a network request
- **THEN** the request is refused

#### Scenario: Resource bounds exceeded

- **WHEN** a previewed page references more resources, or more resource bytes, than the preview bound allows
- **THEN** resources beyond the bound do not load
- **AND** the panel states that some resources were not loaded

### Requirement: HTML preview follows the draft

An HTML preview SHALL render the file's current draft. When the draft changes, the preview SHALL re-render after a short debounce, without a save. A watched change to a referenced project resource is not required to re-render the preview.

#### Scenario: Unsaved edit

- **WHEN** a user edits an HTML file in Text and switches to Preview without saving
- **THEN** Preview renders the edited content

#### Scenario: Edit while Preview is visible

- **WHEN** the draft of an HTML file changes while its Preview is visible
- **THEN** the preview re-renders with the new content after a short debounce

### Requirement: External links in an HTML preview

A link in an HTML preview that the user activates SHALL open through the normal external-link policy when it is a credential-free HTTP or HTTPS link, and SHALL be honoured only on a user gesture recorded in the page. A link to another project file SHALL NOT replace the previewed document.

#### Scenario: User activates an external link

- **WHEN** a user clicks a credential-free HTTPS link in an HTML preview
- **THEN** it opens through the normal external-link policy

#### Scenario: Script opens a link without a gesture

- **WHEN** script in the previewed page requests that a link be opened and there has been no user gesture in the page
- **THEN** the request is refused

## MODIFIED Requirements

### Requirement: Preview mode content types

Preview SHALL support Markdown, images, PDF, and HTML. Markdown links and relative assets SHALL resolve relative to the file's folder but SHALL remain within the server-authorized content path. Credential-free HTTP and HTTPS links SHALL open through the normal external-link policy. Raw HTML and active content in Markdown SHALL be sanitized. Images SHALL use bounded decoded dimensions and fit controls, and PDF pages SHALL render lazily. HTML SHALL render as a web page in a sandboxed webview.

#### Scenario: Relative Markdown asset

- **WHEN** a Markdown preview references a relative asset
- **THEN** it resolves relative to the file's folder and stays within the server-authorized content path

#### Scenario: Raw HTML in Markdown

- **WHEN** previewed Markdown contains raw HTML or active content
- **THEN** the content is sanitized before rendering

#### Scenario: External link in Markdown

- **WHEN** a user activates a credential-free HTTP or HTTPS link in a preview
- **THEN** it opens through the normal external-link policy

#### Scenario: Content too large for full preview

- **WHEN** content is too large or unsafe for a full preview
- **THEN** the panel uses an incremental path or falls back explicitly

#### Scenario: HTML file in Preview

- **WHEN** a user selects Preview on an HTML file
- **THEN** the page renders in a sandboxed webview

### Requirement: File security boundaries

Filesystem operations SHALL use canonical server-side path validation at the final operation boundary. Symlinks, worktrees, case rules, deleted roots, and replacements SHALL be revalidated rather than trusted from an earlier client response. Preview rendering SHALL be sandboxed. Markdown, image, PDF, and text previews SHALL NOT execute file-provided script. An HTML preview SHALL execute file-provided script only inside an opaque-origin frame that has no Terminay authority and no network access. File contents and paths SHALL never pass through the hosted signaling service. Protocol responses SHALL be bounded and SHALL reveal no data outside the authorized project scope. Save, reload, delete-related, and conflict actions SHALL reject stale or cross-server identities.

#### Scenario: Revalidation at the operation boundary

- **WHEN** a client submits a path validated by an earlier response
- **THEN** the server revalidates symlinks, worktrees, case rules, deleted roots, and replacements at the final operation boundary

#### Scenario: Script in previewed content

- **WHEN** a Markdown, image, PDF, or text preview contains script
- **THEN** the sandboxed preview does not execute it

#### Scenario: Script in an HTML preview

- **WHEN** an HTML preview contains script
- **THEN** the script runs only inside the opaque-origin frame
- **AND** it has no Terminay authority and no network access

#### Scenario: Remote client file transfer

- **WHEN** a remote client reads or writes file content
- **THEN** the contents and paths do not pass through the hosted signaling service

#### Scenario: Stale or cross-server action

- **WHEN** a save, reload, delete-related, or conflict action names a stale or cross-server identity
- **THEN** it is rejected
