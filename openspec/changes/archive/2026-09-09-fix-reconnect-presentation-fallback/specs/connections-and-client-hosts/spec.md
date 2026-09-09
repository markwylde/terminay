## MODIFIED Requirements

### Requirement: Framed session liveness

A framed `app.terminay.com` session that has painted workspace chrome SHALL NOT be treated as connected unless live application events still arrive; later PTY, new projects, and new terminals are those events. Resume from background SHALL use the session origin's reconnect operation rather than a second unmanaged signaling join, and SHALL prove liveness when the document becomes visible rather than waiting for the next scheduled liveness probe. While recovery runs, connection chrome SHALL show reconnecting and input SHALL stay disabled. Browser recovery SHALL restore ordered terminal input without duplicate PTYs or workspace mutations.

The session origin's reconnect operation SHALL only ever yield a transport that is open. A generation whose application transport is closed or failed SHALL NOT satisfy a reconnect request, whichever side observed the loss first: the reconnect operation SHALL replace that generation and yield the replacement's transport. A client that asks to reconnect because it observed its own transport die SHALL NOT be given that same transport back.

Browser recovery SHALL continue until it reconnects or the session is left. A recovery attempt that fails or times out SHALL schedule a further attempt with bounded backoff, and SHALL keep the reconnecting state visible while it does. A failed attempt SHALL NOT leave the session idle awaiting a manual action; an explicit retry action SHALL remain available and SHALL start the next attempt immediately.

Recovery SHALL be presented as one steady reconnecting surface. Whether a session is recovering SHALL be decided by whether it has ever been connected, not by whether a connection currently exists, so no attempt after the first is presented as a cold connect. The most recent attempt's error SHALL stay visible until an attempt succeeds, and a single attempt SHALL NOT change the presented phase on its own.

#### Scenario: Painted chrome is not proof of connection

- **WHEN** workspace chrome is painted but no live application events arrive
- **THEN** the session is not treated as connected

#### Scenario: Returning to a framed session resolves visibly

- **WHEN** the user returns to a framed PWA session
- **THEN** it reconnects or fails visibly and does not remain on the session loading mark with no in-flight generation

#### Scenario: Recovery does not duplicate state

- **WHEN** browser recovery completes
- **THEN** ordered terminal input is restored with no duplicate PTYs or workspace mutations

#### Scenario: Reconnect never yields a dead transport

- **WHEN** a client asks the session origin to reconnect while the current generation's application transport is already closed or failed
- **THEN** that generation is replaced and the client receives the replacement generation's open transport

#### Scenario: A failed recovery attempt keeps trying

- **WHEN** a recovery attempt fails or times out
- **THEN** a further attempt is scheduled with bounded backoff, the reconnecting state stays visible, and the session does not wait for a manual action to try again

#### Scenario: Recovery survives a relay that is briefly unreachable

- **WHEN** the signaling relay does not answer for the duration of several recovery attempts and then answers again
- **THEN** a later attempt establishes a new generation and the workspace reconnects with its document and installed bundle intact

#### Scenario: A frozen document reconnects when it is shown again

- **WHEN** a backgrounded session is frozen, its transport dies while it sleeps, and the document is shown again
- **THEN** liveness is proven immediately, recovery runs against the session origin's reconnect operation, and the workspace reconnects without reloading the document or reinstalling the bundle

#### Scenario: Repeated failures keep one reconnecting surface

- **WHEN** several recovery attempts fail in a row after the session has been connected once
- **THEN** every attempt is presented as reconnecting, none as a cold connect, and the most recent error stays visible until an attempt succeeds
