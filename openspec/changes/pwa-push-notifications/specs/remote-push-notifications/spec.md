## ADDED Requirements

### Requirement: Push notification model and vocabulary

The installed PWA at `app.terminay.com` SHALL receive Terminay's notifications by Web Push for servers it is not showing. A **notification** SHALL mean a notification that the server's notification manager has published, which is what the header Notifications list shows. A **banner** SHALL mean an operating-system notification the manager's service worker shows. An **enrolment** SHALL mean one device's standing arrangement with one server to receive pushes, consisting of a routing id, a push key, and a push token. The **hosted push service** SHALL mean the `terminay.com` service that holds the Web Push signing key and forwards pushes to browser vendors' push services. The manager origin SHALL hold the device's only push subscription. A first-party session document opened outside the PWA SHALL NOT enrol for push.

#### Scenario: A notification on a server the PWA is not showing

- **WHEN** an agent finishes unviewed on a server the device is enrolled with while the PWA is closed
- **THEN** the device shows a banner for it

#### Scenario: A session tab outside the PWA

- **WHEN** a session origin is opened as a first-party browser tab
- **THEN** it creates no push subscription and no enrolment

### Requirement: Enabling push on a device

The manager SHALL request notification permission only as the result of a user gesture in the manager, and SHALL create the push subscription only while permission is allowed. The manager SHALL offer notifications for each saved server individually, on by default once permission is granted, and SHALL create an enrolment only for a server whose notifications are on and which advertises push support in its protocol hello. Where the platform cannot deliver push to the manager, the Notifications control SHALL say so and the manager SHALL NOT request permission. Turning a server's notifications off SHALL withdraw that server's enrolment and SHALL leave other servers' enrolments unchanged.

#### Scenario: Permission follows a gesture

- **WHEN** the manager is opened and the user has not asked for notifications
- **THEN** no permission prompt appears

#### Scenario: Enabling notifications

- **WHEN** the user turns notifications on in the manager and grants permission
- **THEN** each saved server with notifications on is enrolled the next time its session connects

#### Scenario: A server without push support

- **WHEN** a saved server's protocol hello does not advertise push support
- **THEN** no enrolment is created for it and its row states that notifications are unavailable for that server

#### Scenario: One server turned off

- **WHEN** the user turns notifications off for one of two enrolled servers
- **THEN** that server stops sending this device pushes and the other server's banners and count continue

#### Scenario: Push is not available on the platform

- **WHEN** the manager runs where Web Push cannot be delivered to it, such as iOS Safari outside an installed PWA
- **THEN** the manager states that notifications need the installed app and requests no permission

### Requirement: Notification permission can always be recovered

The manager SHALL show a Notifications control at all times, and that control SHALL always state which of these the device is in and offer the way forward from it: not yet asked, on, blocked, needs the installed app, or not supported. No state SHALL leave the user without a next step.

Before the browser's own permission prompt, the manager SHALL show its own explanation with **Turn on** and **Not now**. The browser's prompt SHALL be requested only after **Turn on**. Choosing **Not now**, or dismissing the browser's prompt without answering, SHALL leave the device not yet asked, and the user SHALL be able to ask again from the control as many times as they wish. The manager SHALL NOT raise its explanation or the browser's prompt on its own.

When permission is blocked, whether by the user's answer or by the browser after repeated dismissals, the manager SHALL say that notifications are blocked for Terminay on this device, SHALL state that only the device's settings can change that, and SHALL give the steps for the platform it is running on. The manager SHALL re-read the permission whenever it starts, whenever it returns to the foreground, and when the browser reports a change. When a blocked permission becomes allowed, the manager SHALL create the subscription and enrol every saved server whose notifications are on, with no further step from the user.

When permission is allowed but the subscription cannot be created or registered, the control SHALL say that notifications could not be set up, and SHALL offer **Try again**; it SHALL NOT show notifications as on. The control SHALL offer **Send test notification** whenever notifications are on, which SHALL show a banner on this device, so that a user can tell whether the device itself is silencing them.

#### Scenario: Not now, then later

- **WHEN** the user chooses **Not now** on the manager's explanation and later opens the Notifications control
- **THEN** the control offers to turn notifications on and the browser's prompt can still be shown

#### Scenario: The browser's prompt is dismissed

- **WHEN** the user dismisses the browser's permission prompt without choosing
- **THEN** the control shows notifications as not yet on and offers to ask again

#### Scenario: Blocked by accident

- **WHEN** the user chooses to block in the browser's prompt
- **THEN** the control states that notifications are blocked for Terminay on this device and lists the steps to allow them in that platform's settings

#### Scenario: Unblocked in settings

- **WHEN** the user allows notifications for Terminay in the device's settings and returns to the PWA
- **THEN** the control shows notifications as on and every saved server with notifications on is enrolled, without the user turning anything on again

#### Scenario: Blocked later

- **WHEN** notifications were on and the user blocks them in the device's settings
- **THEN** the next time the manager starts or returns to the foreground the control shows them as blocked with the steps to allow them, and every enrolment on the device is ended

#### Scenario: Setting up fails

- **WHEN** permission is allowed and creating or registering the subscription fails
- **THEN** the control says notifications could not be set up and offers **Try again**

#### Scenario: Test notification

- **WHEN** notifications are on and the user chooses **Send test notification**
- **THEN** a banner titled as a Terminay test appears on this device

#### Scenario: No prompt without a gesture

- **WHEN** the manager starts on a device that has not been asked
- **THEN** neither the manager's explanation nor the browser's prompt appears until the user opens the Notifications control and chooses to turn notifications on

### Requirement: Enrolment is bound to the device and travels the authenticated channel

The manager SHALL generate, for each saved server, a random routing id, a random 256-bit push key, and a random push token, and SHALL store them keyed only by that server's session origin. The manager SHALL hand an enrolment only to the framed session whose origin matches that key, resolving the slot from `event.origin` alone, through the closed framed-host notification messages. The session SHALL deliver the enrolment to its server only on the authenticated application channel of a peer that has consumed a connection ticket. The server SHALL store the enrolment on that authenticated device's record and SHALL accept an enrolment, a replacement, or a withdrawal only for the device that sent it. The server SHALL never receive the push subscription's endpoint or keys. The server SHALL post pushes only to the hosted push origin it is configured with and SHALL never take a destination from a client.

#### Scenario: Enrolment reaches only its own server

- **WHEN** the framed session of server A asks the manager for its enrolment
- **THEN** the manager returns server A's routing id, push key, and push token and nothing belonging to another saved server

#### Scenario: A session cannot name another origin's enrolment

- **WHEN** a framed session requests an enrolment while naming an origin other than its own
- **THEN** the manager resolves the slot from `event.origin` and returns only that origin's enrolment

#### Scenario: Enrolment before authentication

- **WHEN** a peer that has not consumed a connection ticket sends an enrolment
- **THEN** the server rejects it and stores nothing

#### Scenario: The server holds no subscription

- **WHEN** a device is enrolled
- **THEN** the server's record for it contains the routing id, push key, and push token, and no push endpoint or subscription key

### Requirement: A server pushes the notifications its list shows

A server SHALL push to an enrolled device when the notification manager's published set changes and that device is not watching it. Push SHALL read only the published set and SHALL NOT derive, delay, or decide notifications itself: a notification the manager never published SHALL never be pushed, and no clear SHALL be sent for it. Working terminals SHALL NOT cause a push. The kinds SHALL be exactly those the notification manager publishes: an agent finished, an agent is waiting, an agent is blocked, a command finished, a terminal needs attention, and a notification a process sent. A burst of changes SHALL be coalesced so that a device receives the latest state. A server SHALL keep no queue of past notifications for push; when a push cannot be delivered it SHALL retry with bounded backoff and then send only the current state. Failure to deliver a push SHALL NOT affect any terminal, agent, connected client, or the notification manager.

#### Scenario: An agent stops to ask a question

- **WHEN** the notification manager publishes an agent-waiting notification
- **THEN** each enrolled device that is not watching the server is sent a push for it

#### Scenario: A working terminal

- **WHEN** a terminal starts working and nothing needs attention or has finished unviewed
- **THEN** no push is sent

#### Scenario: Removed within the settle period

- **WHEN** a terminal raises a notification and the user acknowledges it before the notification manager publishes it
- **THEN** no push for it, and no clear for it, is sent to any device

#### Scenario: Push and the in-app list agree

- **WHEN** a server has published notifications
- **THEN** the notifications and count it pushes are the same ones a connected client's Notifications list shows

#### Scenario: An agent sends a notification

- **WHEN** an agent's sent notification is published
- **THEN** each enrolled device that is not watching the server is sent a push carrying its title and body

#### Scenario: The hosted push service is unreachable

- **WHEN** a notification is published while the server cannot reach the hosted push service
- **THEN** terminals, connected clients, and the notification manager are unaffected, and when reachability returns the device is sent the server's current state

### Requirement: A device that is watching a server is not pushed

A device SHALL be **watching** a server while it holds a live connection to that server whose window last reported itself visible. The session SHALL report its window's visibility to the server on the authenticated channel when it changes. The server SHALL send no push to a device that is watching it. When a device stops watching, by reporting hidden or by its connection being declared dead, the server SHALL send that device its current state if that differs from the last state the device was sent. A visibility report SHALL affect only the reporting device's own pushes and SHALL grant no authority.

#### Scenario: The PWA is open on that server

- **WHEN** a terminal finishes unviewed while the device's PWA is visible and showing that server
- **THEN** no push is sent to that device and the workspace shows its in-app indicators

#### Scenario: The PWA is open on a different server

- **WHEN** a notification arises on server B while the device's PWA is visible and showing server A
- **THEN** server B pushes to that device and a banner for server B appears

#### Scenario: A phone is locked moments after a notification

- **WHEN** a notification arises while a device is watching, and the device then reports hidden or its connection is declared dead with that notification still unacknowledged
- **THEN** the server sends that device its current state, including that notification

#### Scenario: One device's visibility leaves others alone

- **WHEN** one device reports that it is watching
- **THEN** pushes to every other enrolled device are unaffected

### Requirement: A push is sealed for one pairing

Every push SHALL be sealed by the server with authenticated encryption under that enrolment's push key, with the routing id and the format version bound as associated data. Every push SHALL be padded to one fixed length before sealing, so that its size reveals neither its kind nor the length of any name. Every push SHALL carry a sequence number that only increases for its enrolment. A push SHALL state the server's current notification count and the bounded set of identifiers of its outstanding notifications, and MAY carry one notification to display: its kind, terminal title, project title, time, the project and session identifiers, and, for a notification a process sent, that notification's title and body. A push SHALL NOT carry terminal output, a path, a command, or the message body of an OSC notification.

#### Scenario: Two pushes of different kinds

- **WHEN** a server sends a push for an agent finishing in a terminal with a short title and another for a blocked agent in a terminal with a long title
- **THEN** both sealed payloads have the same length

#### Scenario: An OSC notification with a message

- **WHEN** a terminal emits `OSC 9` with a message body and so needs attention
- **THEN** the push states that the terminal needs attention and carries none of the message body

### Requirement: A push is verified before it has any effect

The manager's service worker SHALL select the push key by the routing id a push names and SHALL verify the push under that key before acting on it. A push that names an unknown routing id, fails verification, or carries a sequence number at or below the last accepted for that enrolment SHALL NOT change any count, SHALL NOT show or close any banner attributed to a server, and SHALL NOT be reported as coming from any server. Where the platform requires every push to show a banner, the service worker SHALL show one fixed line that names no server and uses nothing from the payload. A verified push SHALL affect only the server whose key verified it.

#### Scenario: A server forges another server's routing id

- **WHEN** server A sends a push naming server B's routing id, sealed under server A's key
- **THEN** verification fails, server B's count and banners are unchanged, and no banner names server B

#### Scenario: A replayed push

- **WHEN** a push that was already accepted is delivered again
- **THEN** it changes nothing

#### Scenario: A push for a forgotten server

- **WHEN** a push arrives naming the routing id of a server the user has forgotten
- **THEN** it changes nothing and no banner names that server

#### Scenario: The hosted service alters a push

- **WHEN** the hosted push service or a push vendor modifies a sealed payload in transit
- **THEN** verification fails and nothing is attributed to any server

### Requirement: The device names the server

A banner's title SHALL be the label this device holds for the saved server whose key verified the push. No field of a push SHALL set, replace, or add to that title. For a notification from terminal activity, the banner's body SHALL be a headline chosen by the push's kind from a fixed table held by the manager, followed by the terminal's title and its project's title as plain text within a documented bound, and the push SHALL NOT supply headline wording. For a notification a process sent, the body SHALL be that notification's title and body as plain text, followed by the terminal's title and its project's title. A push SHALL NOT supply an icon, an image, an action, or a link. A notification that a framed session asks the manager to show SHALL likewise be titled with the device's label for that session's origin, with the session's text confined to the body.

#### Scenario: A banner for a finished agent

- **WHEN** a verified push from the server saved as `Mac Studio` reports an agent finished in terminal `Terminal 1` of project `Project 2`
- **THEN** the banner is titled `Mac Studio` and its body reads `Agent finished`, `Terminal 1`, and `Project 2`

#### Scenario: A banner for a sent notification

- **WHEN** a verified push from the server saved as `Mac Studio` carries a notification an agent sent from `Terminal 1` of `Project 2`, titled `Review ready` with the body `Three files changed`
- **THEN** the banner is titled `Mac Studio` and its body reads `Review ready`, `Three files changed`, `Terminal 1`, and `Project 2`

#### Scenario: A terminal titled to look like another server

- **WHEN** a server pushes a notification for a terminal whose title is the name of another saved server
- **THEN** the banner's title is still the sending server's own label and that text appears only in the body

#### Scenario: The user renames a server

- **WHEN** the user renames a saved server in the manager
- **THEN** later banners from it carry the new label

#### Scenario: A framed session asks for a notification

- **WHEN** the framed session of the server saved as `Mac Studio` asks the manager to show a notification with a title of its own choosing
- **THEN** the notification is titled `Mac Studio` and the session's text appears only in the body

### Requirement: Opening a banner selects its terminal

Activating a banner SHALL open or focus the PWA, show the server that sent it, and select the terminal it names, as activating that notification's row in the Notifications list does, including acknowledging it. A banner SHALL hold the session origin and the opaque project and session identifiers from its verified push and SHALL NOT hold titles. The manager SHALL hand those identifiers only to the framed session of the origin whose key verified the push, and SHALL NOT interpret them. A banner whose terminal no longer exists SHALL open that server and select nothing.

#### Scenario: Opening a banner while another server is shown

- **WHEN** the PWA is showing server A and the user activates a banner from server B
- **THEN** the PWA shows server B with that terminal selected, and the notification is acknowledged

#### Scenario: Opening a banner for a closed terminal

- **WHEN** the user activates a banner whose terminal has since been closed
- **THEN** the PWA shows that server with its current selection unchanged

#### Scenario: Identifiers stay with their server

- **WHEN** a banner from server B is activated
- **THEN** its identifiers are delivered to server B's session and to no other origin

### Requirement: Clearing follows the server

When a notification is acknowledged on any client, the server SHALL push its new state to every enrolled device that is not watching it. The service worker SHALL close each displayed banner of that server whose identifier is no longer outstanding and SHALL update that server's count. Opening a server in the PWA SHALL always reconcile that server's banners and count with the server. On an installation that does not accept a push which shows no banner, the server SHALL send state only together with a banner, and that installation's banners and count SHALL be reconciled at the next banner from that server or when the app is opened, whichever comes first. The manager SHALL tell the server at enrolment which of the two an installation is.

#### Scenario: Acknowledged on Desktop

- **WHEN** a phone shows a banner for a finished agent and the user views that terminal in Terminay Desktop
- **THEN** on a phone that accepts silent pushes the banner is removed and the icon count drops, without the app being opened

#### Scenario: Clear all

- **WHEN** the user chooses **Clear all** in the Notifications list on any client
- **THEN** every enrolled device's banners for that server are cleared as above, and other servers' banners remain

#### Scenario: An installation that does not accept silent pushes

- **WHEN** a notification is acknowledged elsewhere and the phone's installation does not accept a push that shows nothing
- **THEN** no push is sent for the clear, and the banner and count are corrected at the next banner from that server or when the app is opened

#### Scenario: Opening the app reconciles

- **WHEN** the user opens a server in the PWA while a stale banner for it is displayed
- **THEN** banners for notifications that are no longer outstanding are removed and that server's count matches the workspace

### Requirement: Icon badge and per-server counts

The manager SHALL keep one notification count per saved server. A server's count SHALL be written only by a verified push from that server or by a count report from that server's own framed session, which SHALL carry a non-negative integer within a documented bound and no terminal, project, or server detail. The manager SHALL reject any other value without changing a count. The installed PWA's icon SHALL carry the sum of all saved servers' counts where the platform offers an application badge, and no badge at zero. The manager's profile list SHALL show each saved server's own count beside it and nothing about what is counted. Forgetting a server, or turning its notifications off, SHALL remove its count.

#### Scenario: Three servers with two notifications each

- **WHEN** three saved servers each have two notifications
- **THEN** the icon shows 6 and each server's row in the manager shows 2

#### Scenario: A server reports only its own count

- **WHEN** a framed session reports a count
- **THEN** only the count of the server whose origin sent the report changes

#### Scenario: A count while the server is open

- **WHEN** a notification is dismissed in the workspace while the PWA is showing that server
- **THEN** that server's count and the icon badge drop without a push

#### Scenario: Invalid count report

- **WHEN** a framed session reports a count that is negative, fractional, non-numeric, or above the bound
- **THEN** the report is rejected and no count changes

#### Scenario: A platform without an application badge

- **WHEN** the PWA runs where no application badge is offered
- **THEN** the icon is unbadged, the manager's per-server counts are still shown, and nothing else changes

#### Scenario: Forgetting a server

- **WHEN** the user forgets a saved server that has three notifications
- **THEN** the icon count drops by three and that server's banners are removed

### Requirement: The hosted push service reads nothing

The hosted push service SHALL accept from a server only a push token and a sealed payload of the exact fixed length, and SHALL reject anything else. It SHALL apply Web Push message encryption and the signature and forward the result to the subscription's push service. It SHALL never hold a push key and SHALL never be able to read a notification's kind, count, identifiers, titles, or the server's label. It SHALL NOT store a sealed payload after forwarding it and SHALL NOT write a payload, a push token, or a subscription endpoint to any log, metric, or diagnostic. It SHALL forward only to the push hosts of supported browser vendors and SHALL refuse any other destination. It SHALL limit the rate of registrations and of pushes. The Web Push signing key SHALL exist only in the hosted push service.

#### Scenario: A payload of the wrong length

- **WHEN** a request carries a payload that is not exactly the sealed length
- **THEN** the hosted push service rejects it and forwards nothing

#### Scenario: Logs contain no notification data

- **WHEN** pushes are delivered and rejected
- **THEN** the hosted push service's logs contain no payload bytes, push token, or subscription endpoint

#### Scenario: A destination that is not a push service

- **WHEN** an enrolment's subscription names a host that is not a supported browser vendor's push host
- **THEN** the hosted push service makes no request to it

#### Scenario: Too many pushes

- **WHEN** one push token exceeds the push rate limit
- **THEN** further pushes for it are refused until the limit allows, and other tokens are unaffected

### Requirement: The hosted push service identifies no one

For each enrolment the hosted push service SHALL store only a hash of the push token, the push subscription sealed under a key derived from that token, and an expiry. The manager SHALL seal the subscription before sending it, so that the service does not receive it in the clear at registration. The service SHALL NOT store a push token, a readable endpoint, a server's session id or host key, a device id, an account, or any value shared between two enrolments. It SHALL open a subscription only in memory, only while forwarding a push that presented its token. The stored rows of two enrolments of one installation SHALL be indistinguishable from those of two installations. When a push service reports a subscription gone, the hosted push service SHALL delete that row and report it to the server, which SHALL drop the enrolment.

#### Scenario: Reading the table

- **WHEN** the hosted push service's stored rows are read without any push token
- **THEN** no subscription endpoint can be recovered and no two rows can be shown to belong to the same installation

#### Scenario: Three servers on one phone

- **WHEN** one installation is enrolled with three servers
- **THEN** the hosted push service stores three rows that share no value

#### Scenario: A subscription that no longer exists

- **WHEN** a browser vendor reports that a subscription is gone
- **THEN** the hosted push service deletes that row and the server drops that enrolment and sends it nothing further

#### Scenario: An unused enrolment

- **WHEN** an enrolment's row passes its expiry without renewal
- **THEN** the row is deleted and pushes that present its token are refused

### Requirement: Enrolment ends with trust

Revoking a device on a server SHALL delete that device's enrolment there, and that server SHALL send it nothing further. Resetting a server's identity SHALL delete every enrolment on that server. Forgetting a saved server in the manager SHALL delete that server's push key, routing id, push token, and count from the device, remove its banners, and delete its row at the hosted push service, and SHALL withdraw the enrolment from the server when that server is reachable. Withdrawing notification permission SHALL end every enrolment on that device. When the browser replaces the push subscription, the manager SHALL replace every enrolment's sealed subscription at the hosted push service itself, without requiring any server to be opened.

#### Scenario: A revoked device

- **WHEN** an administrator revokes a paired device
- **THEN** the server deletes that device's enrolment and sends it no push, and other devices' enrolments are unaffected

#### Scenario: A forgotten server that is offline

- **WHEN** the user forgets a saved server that cannot be reached
- **THEN** the device discards that server's push key and deletes its row at the hosted push service, so a later push from that server is neither delivered nor verifiable

#### Scenario: The subscription is replaced

- **WHEN** the browser issues a new push subscription
- **THEN** the manager updates every enrolment at the hosted push service and each server's next push is delivered without that server having been opened

#### Scenario: Permission is withdrawn

- **WHEN** the user withdraws notification permission for the PWA
- **THEN** the manager ends every enrolment the next time it runs and shows notifications as off

### Requirement: Push notification non-goals

Push notifications SHALL NOT require or create an account, SHALL NOT synchronise the saved-server list between devices, SHALL NOT open a background connection from the PWA to any server, SHALL NOT poll any server, and SHALL NOT deliver a push from a server that cannot reach the hosted push service. Terminay Desktop SHALL NOT raise operating-system banners as part of this capability.

#### Scenario: A server with no route to the hosted push service

- **WHEN** a server exposes itself only by direct self-hosted signaling and cannot reach the hosted push service
- **THEN** it sends no push and its other behaviour is unchanged

#### Scenario: The PWA is closed

- **WHEN** the PWA is not running
- **THEN** it holds no connection to any server, and notifications reach it only as pushes
