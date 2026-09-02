## ADDED Requirements

### Requirement: Browser gating by declared contracts, not user agent
Direct-browser and manager bootstrap SHALL negotiate explicit capabilities.
Bundle acceptance SHALL be decided by protocol and schema revisions and
required capabilities, never by Chromium or browser-version ranges or runtime
brand strings.

#### Scenario: Spoofed user agent
- **WHEN** a capable browser presents a reduced or spoofed user-agent string
- **THEN** bootstrap proceeds on the negotiated capabilities and the session
  launches

#### Scenario: Genuinely missing capability
- **WHEN** a required capability is genuinely absent
- **THEN** bootstrap fails with a typed requirement naming the missing
  capability

### Requirement: Contract and bootstrap failure reporting
A failed bootstrap step SHALL be reported as a typed, visible failure that
identifies the step or requirement that failed. It MUST NOT surface as a blank
document, an uncaught host-process exception, or a silent no-op.

#### Scenario: Bootstrap step failure is named
- **WHEN** bundle acquisition, verification, or transport bootstrap fails
- **THEN** the failing step is named in a visible typed failure surface
