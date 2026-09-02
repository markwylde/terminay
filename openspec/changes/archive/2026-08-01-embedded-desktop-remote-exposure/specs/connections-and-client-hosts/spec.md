## ADDED Requirements

### Requirement: Exposure surface labels the secret separately

An exposure surface SHALL present the non-secret address as the server or
session origin and the consumable secret as the pairing link. Copy and QR
actions SHALL always carry the complete short-lived fragment credential and its
expiry.

#### Scenario: Copy carries the whole link

- **WHEN** the user copies the pairing link or scans its QR code
- **THEN** the complete fragment-bearing URL and its expiry are conveyed

#### Scenario: Origin is not offered as a credential

- **WHEN** the exposure surface shows the server or session origin
- **THEN** it is labelled as the non-secret address, distinct from the pairing
  link

### Requirement: Desktop accepts a pasted pairing link

A Desktop host SHALL expose an explicit add-connection action that accepts a
complete pairing URL produced by another exposing host, and SHALL boot the
exact verified workspace bundle of that server without requiring a
navigation-time authorization header.

#### Scenario: Second Desktop pairs from the link

- **WHEN** a pairing link from an exposing host is pasted into the
  add-connection action of another Desktop
- **THEN** that Desktop pairs and renders the exposing server's workspace

#### Scenario: Browser pairing needs no header

- **WHEN** a pairing link is opened in a browser
- **THEN** the verified workspace bundle boots from the fragment credential
  alone
