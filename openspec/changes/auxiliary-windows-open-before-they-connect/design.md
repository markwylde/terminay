## Context

Each Desktop window on a remote server holds its own authenticated connection
(ADR-0048). `presentCanonicalAuxiliaryRoute` awaited
`openDesktopRemoteLanes` (a WebRTC or HTTP handshake, queued one at a time per
server) and `prepareCanonicalRemoteLaunch` before calling `createWindow`, and
the window was created hidden and shown on `ready-to-show` of the server UI.
Native auxiliary windows are Settings and Performance Log (ADR-0075's
allow-list); editors are in-page dialogs and are not affected.

## Goals / Non-Goals

- Goal: the window is on screen, animating, before any connection work for it
  starts.
- Non-goal: a faster handshake, or one connection shared between windows.

## Decisions

- **`createWindow` takes a `remoteProfile` and connects inside its launch.**
  The window exists first, so its window id and profile binding are set before
  the connection starts, rather than adopted after. The launch first loads
  the loading document and waits for its first `ready-to-show` before
  opening the connection. Retries reuse that resolved readiness gate.
- **Reuse the startup loading document.** It is script-free and already
  carries the dots.
- **Each launch attempt carries an abort signal, aborted when the window
  closes.** The signal reaches `openDesktopRemoteLanes`, so an attempt still
  queued behind another window's handshake, or mid-handshake, stops. A result
  that arrives after the window closed is discarded and its transport closed.
- **The latest route wins while loading.** The window keeps its requested
  route in main. A repeated request for a window still on its loading
  document replaces that route and focuses the window, without navigating the
  loading document; the launch reads the route when it mounts. Once mounted,
  a repeated request navigates as before. Requests during an unfinished
  workspace navigation are held too, then applied before mounting completes,
  so they neither get lost before commit nor interrupt the initial load.
- **Transport failures show recovery; bundle failures close the window.** A
  failed or dropped handshake, or a mount that fails, shows the launch
  recovery document with Retry, and Retry re-runs the whole launch, including
  a fresh connection for the same window id. A failure to prepare the packaged
  workspace bundle closes the window and records a diagnostic, which keeps
  the existing rule that an unsafe bundle leaves the window unopened.
  Diagnostic-write failure cannot prevent closing that window. A failed mount
  retires its document endpoint before showing recovery, so it cannot reconnect
  behind Retry. Server identity discovery is connection work, so its network
  failures offer Retry and its fetch receives the window-close abort signal;
  only packaged-bundle preparation failures use the close-window path.

## Boundaries

- **Electron privilege:** unchanged. The loading document is a script-free
  `data:` document under a `default-src 'none'` CSP, and the connection is
  still opened in main; the renderer gets the same document endpoint as before.
- **Chromium storage:** the shell selects a persistent partition from the
  remembered remote server identity and profile before launch metadata exists,
  using origin and profile when server identity is not remembered. It never
  defaults to Local's partition for a remote window. With a remembered server
  identity, it selects the same partition as a prepared remote launch.
- **Window boundary (ADR-0048):** each auxiliary window still owns its own
  connection and window id; the id is bound to the window before the
  handshake rather than adopted after it, so it never names another window.
  The project window that asked is untouched by the auxiliary window's
  connection or its failure.

## Risks / Trade-offs

- Connection failures now surface in the auxiliary window's recovery screen,
  not as an error returned to the project window. That is where the person is
  looking.
- The E2E suite has no way to hold a remote handshake open, so the test proves
  the order on Local: the window is visible on the loading document before the
  workspace document starts loading, and a repeat request during that time
  opens no second window and moves the route. The test holds loading completion
  to make that repeat deterministic, and two more cases hold workspace navigation
  before and after commit. Focused Node tests control remote handshake, close,
  bundle preparation, mount failure, queue cancellation and retry timing.
