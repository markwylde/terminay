## Why

The first project in a fresh workspace always gets the same colour. Its default
is hashed from `<colorScope>:project-1`, and `colorScope` is the server id
falling back to the constant `desktop-local` — so every desktop workspace that is
not connected to a server starts on red, on every machine, every time. The
starting hue is the one genuinely free choice in colour selection, and pinning it
to a hash spends that freedom for no benefit: there is nothing yet on screen for
the first colour to stay reproducible against.

## What Changes

- When no colours are in use, a new project takes a random palette entry rather
  than an identity-hashed one, so a fresh workspace starts somewhere different
  each time.
- Once any colour is in use, selection is unchanged: still the furthest palette
  hue, still tie-broken by project identity, so the spread and its
  reproducibility are untouched.
- The selection function takes an injectable random source so tests and any
  caller needing a fixed sequence can pin it.
- `getDeterministicProjectTabColor` is renamed to `getProjectTabColor`, since it
  is no longer deterministic in the empty case.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities
- `workspace-and-project-tabs`: the first project's default colour is chosen at
  random rather than derived from project identity.

## Impact

- `src/workspace/projectTabModel.ts` — the selection function and its name.
- `src/workspace/projectTabModel.test.ts` — tests pin the random source.
- Call sites of the renamed function.
- No server, protocol, or persistence change; no security boundary crossed.
