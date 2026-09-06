# ADR-0014: Make agent providers declare their observable capabilities and prove them against real CLIs

Status: accepted
Date: 2026-09-06

## Context

Terminay observes third-party coding-agent CLIs without modifying, configuring,
hooking, or wrapping them. Every fact it shows about an agent — that a session
exists, its title, whether it is idle, working, waiting, blocked, or done — must
be derived from artifacts the provider already writes for its own purposes.

That boundary means capability is not uniform and not under our control. One
provider records permission requests in its journal; another prompts for the
same approval entirely in its TUI and writes nothing. One holds its journal open
for writing; another appends and closes. A provider can change any of this in a
patch release without telling anyone.

Until now this variation was implicit. Each provider extension was tested
against fixtures written from the same author's reading of that provider's
format, and those fixtures were free to assert evidence the real CLI never
produces. Claude Code shipped bound only to open-writable-handle evidence — a
form of evidence the Claude Code CLI does not present, since it appends and
closes — and its entire unit suite passed, because every fixture synthesised
the handle. The result was a provider that never bound, never showed a status
indicator, and was covered by green tests.

Fixtures cannot detect this class of defect. A fixture encodes what we believe
about a provider; when the belief is wrong the fixture is wrong in the same
direction as the code, and the test proves the two agree with each other rather
than with reality.

## Decision

Provider capability is a declared, published, per-provider contract, and every
declaration is verified against the provider's real CLI.

1. **Declared capabilities.** Each provider claiming conformance declares a
   verdict for each observable capability — detection, title, and each canonical
   lifecycle state. A capability is either read from an explicit provider
   record, derived from that provider's session journal by a named inference
   rule, or declared unsupported with the reason stated. The declaration says
   which, so a reader can tell an explicit fact from a derived one.

2. **Journal-derived inference, never terminal-derived.** Where a provider
   records no explicit fact, the state is derived from its session journal
   rather than declared unavailable — including from the recorded absence of
   records between two explicitly recorded boundaries. Terminal text, terminal
   titles, spinner frames, process names, escape-sequence bodies, file
   modification times, and filename proximity are never evidence for a canonical
   state. Process observation may suppress an inference that would otherwise
   fire; it never creates a state on its own. An explicit record always
   overrides an inference. Every inference names its rule and its window, and
   every window is justified by a recorded measurement of that provider's
   ordinary behaviour.

3. **Real-CLI verification.** Every claimed capability is backed by an
   executable check that drives the provider's real, authenticated CLI through a
   representative session and asserts the capability against the surfaces a user
   reads. Declared-unsupported capabilities are asserted as unsupported by the
   same check, so a provider that gains a capability fails until its declaration
   is updated.

4. **Fixture parity.** A provider's fixtures reproduce the discovery evidence
   its real CLI actually presents, and the timing at which it presents it. No
   fixture may supply evidence the provider does not produce in normal
   operation, nor present a record earlier than the provider writes it, and no
   provider's binding may be proven only by such a fixture.

5. **CI placement.** Real-CLI verification is opt-in and credential-gated. It is
   skipped without a provisioned, authenticated CLI, and it does not run on the
   pull-request merge gate that ADR-0010 defines.

## Consequences

Provider capability becomes reviewable. "Does Claude Code show a red indicator
when it needs input?" has a written answer with a reason, rather than an
assumption that every provider does everything.

Adding a provider costs more. It requires a real CLI, credentials, and a
conformance run, not just a fixture. This is the intended price: a provider that
cannot be proven against its own CLI has not been shown to work.

Provider silence stops being our limit. A provider that writes no permission
record can still be reported as waiting, derived from its own journal, without
touching its configuration. What the declaration preserves is the distinction: a
reader can see which states rest on an explicit record and which on a derived
one, and an inference that proves unreliable is visible as the thing to fix.

Inference carries a false-positive cost, bounded deliberately. A rule fires only
inside explicitly recorded boundaries, is suppressed by contradicting process
evidence, and is cleared by the next record the provider writes. A wrong state
therefore costs one indicator that corrects itself, not a persistent lie.

Verification is slow, costs model tokens, and depends on third-party
availability. Keeping it off the merge gate preserves ADR-0010's confidence
gate; a skipped run is a pass, so the suite never blocks work when credentials
are absent.

Fixture parity is enforced by review rather than by tooling. A reviewer must ask
whether claimed evidence is evidence the CLI actually produces, and whether it
is available as early as the fixture presents it — the questions that would have
caught this defect, and the mistimed wait signal beside it, at the point they
were introduced.
