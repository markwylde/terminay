## 1. Colour selection

- [x] 1.1 Add a hue helper in `src/workspace/projectTabModel.ts` that reads a hue
      (0–360) back from a `#rrggbb` string and returns `null` for anything it
      cannot parse. Verified by unit tests asserting palette entries round-trip
      to their generating hue within 1° and that `''`, `'red'`, and `'#zzz'`
      return `null`.
- [x] 1.2 Add a circular hue-distance helper (shortest arc, 0–180). Verified by
      unit tests covering `dist(350, 10) === 20`, `dist(0, 180) === 180`, and
      symmetry.
- [x] 1.3 Rewrite `getDeterministicProjectTabColor(identity, usedColors)` to
      score every palette entry by its minimum hue distance to the parsed hues of
      `usedColors`, keep the entries with the highest score, and index into that
      tie set with the existing FNV-1a identity hash. Drop the sequential scan and
      the off-palette `hueToProjectTabColor(hash % 360)` fallback. Verified by
      unit tests in 2.x and by `npx biome lint src/workspace/projectTabModel.ts`.
- [x] 1.4 Confirm `getRandomProjectTabColor` and `createProjectTab` still compile
      against the unchanged signature and that `src/workspace/useProjectCollection.ts`
      and `src/App.tsx` need no edits. Verified by `npx tsc --noEmit -p tsconfig.json`.

## 2. Tests

- [x] 2.1 Establish how `src/workspace/projectTabModel.test.ts` is executed and
      record the command in the task notes. Runner: `node --test src/workspace/projectTabModel.test.ts`.
      It needed explicit `.ts` extensions on the value imports in its graph
      (`projectTabModel.ts` → `../terminalSettings`, `terminalSettings.ts` →
      `./keyboardShortcuts` and `./types/settings`); type-only imports are erased
      by Node's type stripping and were left alone. Verified by the existing
      `sidebar visibility is device-local per server and project` test passing.
- [x] 2.2 Test: one red in use → the assigned colour's hue is at least 150° from
      it. Verified by the test passing.
- [x] 2.3 Test: assign colours for six successive identities, feeding each result
      back into `usedColors`; assert the minimum pairwise hue distance across the
      six is at least 36° — the widest separation twenty 18° palette hues allow
      for six projects, and twice the 18° the old sequential scan would leave —
      with 1° of slack for 8-bit hex rounding. Verified by the test passing.
- [x] 2.4 Test: with all 20 palette colours in use, a further call still returns a
      palette colour and does not throw. Verified by the test passing.
- [x] 2.5 Test: determinism — the same `(identity, usedColors)` returns the same
      colour across calls, and an empty `usedColors` set yields different colours
      for two different identities. Verified by the test passing.
- [x] 2.6 Test: a user-chosen colour that is not a palette entry (e.g. `#ff3366`)
      still repels the next assignment. Verified by the test passing.

## 3. Verification in the app

- [x] 3.1 Run `npm run lint` and `npm run typecheck:workspaces`. Verified by both
      exiting zero.
- [x] 3.2 Open the app, create four projects in one view, and confirm the tab
      colours read as clearly different families rather than neighbouring shades.
      Verified by a screenshot of the project bar attached to the change.
- [x] 3.3 Confirm creating several projects in rapid succession still commits
      distinct colours (the reserved-colour path in `useProjectCollection.ts`).
      Verified by clicking `+` four times quickly and observing four distinct tab
      colours.

## 4. Change hygiene

- [x] 4.1 Run `openspec validate --changes distinct-project-tab-colors --strict`.
      Verified by it reporting the change as valid.
