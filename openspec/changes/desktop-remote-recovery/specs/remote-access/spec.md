## MODIFIED Requirements

### Requirement: Recovery scope and revocation

Automatic recovery and **Retry connection** SHALL use the same reconnect operation. An expired or revoked device identity SHALL stop recovery and request pairing. Closing one browser tab or Desktop window SHALL affect only that client connection. Device revocation SHALL affect live and future connections.

A server SHALL answer an opted-in reconnect from a revoked device with a signed refusal after validating the saved device key proof. Desktop SHALL verify the refusal using its pinned server key and the current join's server session, device and client nonce before requesting pairing. Silence or an invalid signature SHALL leave the attempt subject to the ordinary connection deadline.

#### Scenario: Revoked device proves its identity on reconnect

- **WHEN** an opted-in Desktop device proves its saved key after the server revoked it
- **THEN** Desktop verifies the server's signed refusal, stops recovery, and offers Pair again

#### Scenario: Refusal does not verify for this reconnect

- **WHEN** a refusal has an invalid signature or was signed for a different join
- **THEN** Desktop does not treat the device as revoked

#### Scenario: Revoked device stops recovering

- **WHEN** the device identity is expired or revoked
- **THEN** recovery stops and pairing is requested

#### Scenario: Revoking one device leaves others alone

- **WHEN** one device is revoked
- **THEN** that device's connection closes and other devices, Local Desktop, and server-owned PTYs are unaffected
