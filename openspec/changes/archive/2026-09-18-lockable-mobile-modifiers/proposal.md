## Why

On a phone, Control, Shift, and Alt on the terminal's keyboard accessory row
apply to a single key and then release. Anything longer, such as a run of
Control-key chords or several capital letters, means tapping the modifier
again before every key. The iOS keyboard solves the same problem for Shift:
tap once for one capital, tap twice for Caps Lock. People expect the terminal
modifiers to work the same way.

## What Changes

- Each accessory modifier cycles through three states: off, one-shot, and
  locked. One tap applies it to the next input only, as before. A second tap
  locks it for every input until a third tap turns it off.
- A locked key looks different from a one-shot key, so the state is clear at
  a glance.
- Typing, an accessory key, or Paste spends a one-shot modifier and leaves a
  locked one on.
- Dismissing the keyboard from the accessory row still releases every
  modifier, so a locked Control does not survive out of sight.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: the "Touch input and software keyboard accessory"
  requirement replaces "one-shot" modifiers with modifiers that can be locked.

## Impact

- `src/components/terminalMobileKeyboardInteraction.ts` — a three-state latch
  per modifier (`advanceTerminalMobileModifier`,
  `consumeTerminalMobileModifiers`).
- `src/components/TerminalPanel.tsx` — spends modifiers after each input
  instead of clearing them, and renders the locked state.
- `src/App.css` — the locked key style.
- `scripts/terminal-mobile-keyboard-interaction.test.mjs` — covers the cycle
  and what an input spends.
- No protocol, server, or privileged surface is touched.
