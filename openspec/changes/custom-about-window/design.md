## Context

About was `{ role: 'about' }` backed by `app.setAboutPanelOptions`. That panel
cannot be styled, and the role only exists on macOS.

## Goals / Non-Goals

**Goals:** a branded About window on every desktop platform that states
authorship, licence, and where the project lives.

**Non-Goals:** no update controls, changelog, or credits list in the window.
Help › Check for Updates… already owns updates.

## Decisions

- **A generated, script-free `data:` document**, the same pattern as the
  startup loading document. The CSP is `default-src 'none'` with inline styles
  only, so the window has no script, no network, and no preload. The artwork is
  inline SVG animated with CSS.
- **The window is sandboxed and denies everything.** No preload, context
  isolation, sandbox, no permissions. `will-navigate` is always prevented, and
  both navigation and `window.open` hand the URL to `shell.openExternal` only
  when it exactly matches one of the three links the document renders. Any other
  URL is dropped.
- **Artwork: five soft wave lines**, one per spinner colour (`#db5757`,
  `#c1db57`, `#57db8c`, `#578cdb`, `#c157db`), drifting at slightly different
  speeds behind the logo and fading out at the edges. Motion stops under
  `prefers-reduced-motion`.
- **One window.** A second About request focuses the open window.
- **The version comes from `app.getVersion()`** and is HTML-escaped before
  being inserted.

## Risks / Trade-offs

- It is no longer the native panel. That is the point of the change. The window
  keeps the native traffic lights on macOS, so it still closes the way people
  expect.
