# Real shared-shell acceptance gate

Status: **implemented and executed, not satisfied**.

This document does not claim Desktop/web shell parity. It defines the
executable gate required before that claim is valid and records the current
baseline mismatch.

## Current production launch paths

Electron launches:

```text
src/main.tsx
  -> src/rendererApp.tsx
  -> src/rendererRuntime.tsx
  -> src/shared/ResponsiveWorkspaceEntry.tsx
  -> src/App.tsx
  -> ProjectWorkspace
  -> DockviewReact
```

The canonical identity is the real `App` / `ProjectWorkspace` / Dockview tree.
`ResponsiveWorkspaceEntry` currently adds route metadata around that tree but
is not itself the canonical shell.

The web manager launches:

```text
web.html
  -> src/web/main.tsx
  -> src/web/ConnectedWebRendererWorkspace.tsx
  -> src/shared/ConnectedRendererWorkspace.tsx
  -> src/App.tsx
  -> ProjectWorkspace
  -> DockviewReact
```

The static production graph now reaches the same canonical component and no
longer reaches `ServerWorkspaceSurface` or `ResponsiveWorkspaceShell`.
Runtime acceptance remains blocking because the connected web launch currently
loses the canonical App root and renders a blank viewport.

## Executable acceptance test

A dedicated Playwright capture project named `shared-app-acceptance` lives
outside the default E2E suite until it passes. The complete gate runs with:

```sh
npm run build:app
npm run build:web
npm run acceptance:app-parity
```

The parity command first runs the identity graph audit, then launches the real
Electron and browser entry points and invokes the screenshot comparator in the
same test.

1. Start two isolated local Terminay Servers from the same immutable seed:
   fixed server/project/view/panel IDs, one selected project, one selected
   terminal panel, identical terminal dimensions, and deterministic replay
   bytes. Each host consumes its own one-time credential; no hosted service is
   involved.
2. Launch the production Electron entry through the normal Electron fixture and
   connect it to the first server through the real connection menu.
3. Launch the built `web.html` entry and connect it to the second server through
   the real browser enrollment/connection path.
4. Set both content viewports to exactly `1280x800`, wait for the same workspace
   revision and selected project/view/panel IDs, disable animation/caret
   painting, and use the same colour scheme and device scale factor.
5. Locate the canonical `App` root by a component-owned identity attribute,
   capture only that root, and compare the two PNG buffers directly in the same
   test using `pixelmatch`. The allowed differing-pixel ratio must initially be
   zero; any later tolerance requires a documented reason and must remain below
   `0.001`.
6. Assert semantic state before comparing pixels: component identity, workspace
   revision, selected IDs, route registry, route, panel kind, and rendered
   terminal session ID must be identical.

The canonical component module exports:

```ts
export const TERMINAY_APP_COMPONENT_ID =
  'src/App.tsx#App/ProjectWorkspace/Dockview@1';
```

`App` itself writes that exact value to
`data-terminay-app-component`. The acceptance test must read the attribute from
both production launches. Test code must not be allowed to add or rewrite the
attribute. A copied component with matching markup therefore cannot satisfy
the gate.

## Duplicate-shell import gate

The dedicated command must first run a static module-graph audit that fails
unless all of the following are true:

- both production entry graphs resolve the root to the exact canonical
  `src/App.tsx` file;
- there is exactly one production export carrying
  `TERMINAY_APP_COMPONENT_ID`;
- the connected web graph contains neither
  `src/shared/ResponsiveWorkspaceShell.tsx` nor
  `src/shared/ServerWorkspaceSurface.tsx`;
- `src/web/**` contains no shell/workspace component implementation or shell
  stylesheet;
- no alias, barrel, generated copy, fixture, or web-only wrapper can provide
  the component identity attribute; and
- Electron does not satisfy the audit merely by importing route metadata from
  `ResponsiveWorkspaceEntry`.

Use the TypeScript compiler API to resolve imports from `src/main.tsx` and
`src/web/main.tsx`; substring checks alone are not sufficient. Report both
resolved paths and the first divergent module when the graphs differ.

## Post-cutover execution evidence (2026-07-28)

Fresh `build:app` and `build:web` production bundles completed successfully.
The identity stage passed with the canonical identity
`src/App.tsx#App/ProjectWorkspace/Dockview@1` present in both resolved graphs
and an empty `errors` array.

The real production capture then failed at the semantic comparator. At the same
`1280x800`, DPR 1, dark viewport, Electron reported:

```json
{
  "componentIdentity": "src/App.tsx#App/ProjectWorkspace/Dockview@1",
  "workspaceRevision": "5",
  "projectId": "project-1",
  "terminalSessionId": "shared-app-acceptance:session:1"
}
```

The connected web launch reported all four fields as `null`. Its captured
viewport was blank, while Electron rendered Project 1 and Terminal 1. The
artifacts are emitted as `electron-app.png`, `web-app.png`,
`electron-state.json`, and `web-state.json` under the Playwright test-results
directory.

Trace inspection identifies the first failing runtime boundary immediately
after the browser's real Connect action:

```text
TypeError: Cannot read properties of undefined (reading 'getStatus')
  at useRemoteAccessController
```

The network trace shows that browser enrollment succeeded far enough to start
the authenticated
`GET /protocol/events/subscribe?afterRevision=1` request with its bearer
credential and web client ID. `App` then calls
`useRemoteAccessController(window.terminayRemotePairingPinHost,
window.terminayRemoteAccessStatusHost, ...)`; the browser correctly has no
Electron preload `terminayRemoteAccessStatusHost`, so the hook dereferences an
undefined status client and React unmounts the connected tree. This is a
production host-capability boundary bug, not a fixture pairing or static-server
failure. The harness continues to use the real production connection dialog
and is not weakened with a fabricated preload host.

This is a runtime semantic and visual mismatch, so pixel parity is not accepted
and the checklist remains open.

### Capability-fix rerun

After making remote-access presentation capabilities optional/fail-closed,
fresh `build:app` and `build:web` production bundles completed successfully and
the complete acceptance command advanced past the prior crash. The browser
runtime diagnostics attachment contained an empty `diagnostics` array.

Both production hosts reported exactly:

```json
{
  "componentIdentity": "src/App.tsx#App/ProjectWorkspace/Dockview@1",
  "workspaceRevision": "3",
  "projectId": "project-1",
  "viewId": "workspace",
  "panelId": null,
  "panelKind": "terminal",
  "terminalSessionId": "shared-app-acceptance:session:1",
  "viewportWidth": 1280,
  "viewportHeight": 800,
  "deviceScaleFactor": 1
}
```

The first remaining failing boundary is the unrelaxed pixel comparator:

```text
App-owned screenshot pixels differ: 977514/1024000
differing ratio: 0.954603515625
required ratio: 0
```

The Electron artifact visibly renders the Terminal 1 Dockview panel and shell
prompt. The web artifact renders the shared project/header chrome but its
workspace body is empty. The connection labels and project accent colours also
differ. Therefore canonical identity and semantic state parity now pass, but
real presentation parity does not; the checklist remains open.

### Web host-height fix rerun

Computed-box capture localized the empty body to the browser host wrapper, not
shared App/Dockview CSS: Electron's root/App/Dockview chain was 800/800/760px
high, while browser `#web-root`, `.connected-web-renderer-workspace`, and
`.app-shell` were only 40px high. `src/index.css` sizes `#root`, but the browser
mount ID is `#web-root`, so percentage height did not resolve. After the
browser-owned wrapper was changed to `height: 100dvh`, fresh production builds
showed both App roots at 800px and both terminal panels at 724px.

The next strict pixel result remains failing:

```text
App-owned screenshot pixels differ: 1022381/1024000
differing ratio: 0.9984189453125
required ratio: 0
```

The structures and terminal contents now align, but two production state
sources remain divergent:

- `createProjectTab()` calls `getRandomProjectTabColor()`, which selects with
  `Math.random()`. Electron and browser independently construct Project 1, so
  their project/terminal surface colours differ across every run.
- Desktop `rendererRuntime.tsx` merges the selected connection's
  `message.label` into `connectionLabel`. Browser retains `ActiveTerminalConnection.label`
  separately but passes only `connection.context` into
  `ConnectedWebRendererWorkspace`, so App falls back to
  `Remote · shared-app-acceptance` instead of the selected endpoint label.

The acceptance harness does not seed `Math.random`, rewrite CSS variables, or
fabricate connection labels. These are production state-ownership mismatches
and must be resolved before zero-pixel parity can pass.

### Colour/label convergence rerun

After the production colour/label convergence changes, fresh Electron and web
builds again passed and the strict semantic comparison remained exact. The two
captures now have the same project/terminal colour family, terminal content,
geometry, and endpoint-style label. The byte-level comparator still reports:

```text
App-owned screenshot pixels differ: 1022374/1024000
differing ratio: 0.998412109375
required ratio: 0
```

The remaining differences are concrete:

- Electron and Playwright browser rasterization produce different RGB bytes
  across flat CSS colour-mixed surfaces. For example the same terminal surface
  at `(500, 500)` is `[18, 41, 15, 255]` in Electron and
  `[9, 42, 12, 255]` in the browser; the tab surface at `(100, 20)` is
  `[19, 21, 22, 255]` versus `[18, 20, 23, 255]`. The acceptance environments
  use Electron 42.7.1 and Playwright 1.62.0's Chromium (identified as Chromium
  151 in the trace), so these are genuinely different raster engines.
- The required isolated servers bind different ephemeral ports. The converged
  endpoint labels therefore render `127.0.0.1:54220` and
  `127.0.0.1:54222`, which cannot produce identical text pixels.

No comparator tolerance, colour rewrite, screenshot mask, or production-state
mutation was added. A zero-byte-difference requirement needs identical
rasterization engines and identical displayed seed data, including the
connection label.

## Implemented baseline probes

`node scripts/shared-app-component-identity-gate.mjs` resolves the production
TypeScript import graphs and now passes after the connected web cutover.

`node scripts/shared-app-screenshot-compare.mjs` consumes Electron/web PNG and
semantic-state artifacts, requires the canonical App identity and exact
workspace/project/view/panel/session/viewport equality, then requires zero
differing RGBA pixels. The production capture driver generates these artifacts
from the two real production launch paths described above; fixture components
are not accepted.

## Acceptance

Parity is accepted only when the dedicated command exits zero, both launch
paths report the same canonical component identity and semantic state, the
pixel comparison passes, and the duplicate-shell graph audit passes. Fixture
screenshots, route-count assertions, or independent “no overflow” checks cannot
substitute for this gate.
