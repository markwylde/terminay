## Context

The accessory row keeps its modifier state in `TerminalPanel` as a ref (read
synchronously by xterm's `onData` handler) mirrored into React state (for
rendering). Today each modifier is a boolean, and every input path clears all
of them: `onData`, the accessory keys, and Paste.

No security or architectural boundary is crossed. The state is renderer-local
presentation of input the panel already sends through its normal input
boundary (ADR-0011).

## Goals / Non-Goals

**Goals:**

- Tap once for one key, twice to lock, three times to release, per modifier.
- A locked modifier is visibly distinct from a one-shot one.

**Non-Goals:**

- Double-tap timing. iOS locks Shift only when the second tap comes quickly;
  here the second tap locks whenever it comes. The key shows which state it
  is in, so no timing needs to be learned.
- Persisting a locked modifier across keyboard dismissal or panel remounts.

## Decisions

- **Three-state latch instead of a boolean.** Each modifier is `off`, `once`,
  or `locked`, and a tap advances `off → once → locked → off`. Encoding
  (`applyTerminalMobileModifiers`) treats both `once` and `locked` as held,
  so the byte encoding is unchanged.
- **Spend, don't clear.** After each input the panel replaces the state with
  `consumeTerminalMobileModifiers`, which turns `once` into `off` and leaves
  `locked` alone. Terminal-generated reports still pass through without
  spending anything (`isTerminalMobileModifierTarget`).
- **Dismissal still clears everything.** Hiding the keyboard from the
  accessory resets all modifiers, so a locked modifier cannot quietly apply to
  input made after the row has gone.
- **Distinct locked style.** A locked key is filled solid and underlined, and
  sets `aria-description="Locked"`. Both the one-shot and locked keys keep
  `aria-pressed="true"`.

## Risks / Trade-offs

- A locked modifier applies to every key until released, so a user who
  forgets it is locked will send modified input. The solid key is the
  reminder, and dismissing the keyboard releases it. Enter and other keys
  with no Control form are sent unchanged under a locked Control.
