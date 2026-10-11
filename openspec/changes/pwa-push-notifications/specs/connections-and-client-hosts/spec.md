## MODIFIED Requirements

### Requirement: Web host storage split

The web host SHALL store bookmark metadata in `localStorage` or an equivalent browser store, and framed-session device credentials in manager-origin IndexedDB. The non-extractable browser device key for a framed PWA session SHALL live in that manager vault, while a first-party session document SHALL store its key in IndexedDB and WebCrypto on the exact server session origin. The connection host SHALL NOT read terminal output, project names, paths, PINs, or workspace data, and MAY clone a vaulted device key only into the session iframe whose origin matches the vault slot.

The one exception is a push banner. The manager's service worker MAY decrypt the text carried by a verified push, which is the terminal title, the project title, and the title and body of a notification a process sent, in order to display it in that banner. It SHALL NOT store that text, SHALL NOT send it to any party, and SHALL NOT make it available to the manager page or to any session origin. The manager page SHALL hold, per saved server, only a notification count and that server's push enrolment, and SHALL learn nothing about what is counted.

#### Scenario: Vault clone is origin-matched

- **WHEN** a session iframe requests its device key
- **THEN** the manager clones it only when the iframe origin matches the vault slot

#### Scenario: Host cannot read workspace content

- **WHEN** the connection host mediates a session
- **THEN** it reads no terminal output, project names, paths, PINs, or workspace data

#### Scenario: Banner titles are displayed and not kept

- **WHEN** the manager's service worker shows a banner for a verified push
- **THEN** the banner's text appears in the banner's body and in no manager storage, no request, and no message to the manager page

#### Scenario: The manager page sees a number

- **WHEN** a saved server has two notifications
- **THEN** the manager page can read the count 2 for it and cannot read which terminals or projects they concern
