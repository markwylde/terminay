import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'

export type MobileViewportProbeEvent = {
  activeClass: string
  activeTag: string
  event: string
  innerHeight: number
  layoutHeight: number
  source: string
  terminalBottom: number | null
  terminalTop: number | null
  typed: string
  visualHeight: number
  visualOffsetTop: number
}

export type WebClientHostFixture = {
  close: () => Promise<void>
  attackerOrigin: string
  getMobileViewportProbeEvents: () => readonly MobileViewportProbeEvent[]
  parentOrigin: string
  sessionAOrigin: string
  sessionBOrigin: string
}

export async function startWebClientHostFixture(): Promise<WebClientHostFixture> {
  let port = 0
  const mobileViewportProbeEvents: MobileViewportProbeEvent[] = []
  const server = createServer((request, response) => {
    const hostname = (request.headers.host ?? '').split(':')[0]
    const origin = `http://${hostname}:${port}`
    const parentOrigin = `http://web.localhost:${port}`
    const sessionAOrigin = `http://session-a.localhost:${port}`
    const sessionBOrigin = `http://session-b.localhost:${port}`
    const requestUrl = new URL(request.url ?? '/', origin)
    const pathname = requestUrl.pathname

    if (pathname === '/mobile-viewport-probe-events') {
      if (request.method === 'POST') {
        collectMobileViewportProbeEvent(
          request,
          response,
          mobileViewportProbeEvents,
        )
        return
      }
      sendJson(response, mobileViewportProbeEvents)
      return
    }
    if (pathname === '/xterm.js') {
      sendJavaScript(
        response,
        readFileSync(
          new URL('../../node_modules/@xterm/xterm/lib/xterm.js', import.meta.url),
          'utf8',
        ),
      )
      return
    }
    if (pathname === '/xterm.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end(
        readFileSync(
          new URL('../../node_modules/@xterm/xterm/css/xterm.css', import.meta.url),
          'utf8',
        ),
      )
      return
    }
    if (pathname === '/mobile-viewport-probe-parent.js') {
      sendJavaScript(response, mobileViewportProbeParentScript())
      return
    }
    if (pathname === '/mobile-viewport-probe-session.js') {
      sendJavaScript(response, mobileViewportProbeSessionScript())
      return
    }

    if (pathname === '/parent.js') {
      sendJavaScript(response, parentScript())
      return
    }
    if (pathname === '/session.js') {
      sendJavaScript(response, sessionScript())
      return
    }

    if (hostname === 'web.localhost') {
      response.writeHead(200, {
        'content-security-policy': [
          "default-src 'self'",
          "base-uri 'none'",
          "object-src 'none'",
          `frame-src ${sessionAOrigin} ${sessionBOrigin}`,
          "script-src 'self'",
          "style-src 'unsafe-inline'",
        ].join('; '),
        'content-type': 'text/html; charset=utf-8',
        'permissions-policy':
          `clipboard-read=(self "${sessionAOrigin}" "${sessionBOrigin}"), ` +
          `clipboard-write=(self "${sessionAOrigin}" "${sessionBOrigin}")`,
      })
      response.end(
        pathname === '/mobile-viewport-probe'
          ? mobileViewportProbeParentHtml(sessionAOrigin)
          : parentHtml(sessionAOrigin, sessionBOrigin),
      )
      return
    }

    if (hostname === 'session-a.localhost' || hostname === 'session-b.localhost') {
      const sessionId = hostname === 'session-a.localhost' ? 'session-a' : 'session-b'
      response.writeHead(200, {
        'content-security-policy': [
          "default-src 'self'",
          "base-uri 'none'",
          "connect-src 'self'",
          "object-src 'none'",
          `frame-ancestors ${parentOrigin}`,
          "script-src 'self'",
          "style-src 'unsafe-inline'",
        ].join('; '),
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': `terminay_session_cookie=${sessionId}-cookie; Path=/; SameSite=None; Secure; Partitioned`,
      })
      response.end(
        requestUrl.searchParams.has('mobile-viewport-probe')
          ? mobileViewportProbeSessionHtml(sessionId)
          : sessionHtml(sessionId, parentOrigin),
      )
      return
    }

    response.writeHead(200, {
      'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'",
      'content-type': 'text/html; charset=utf-8',
    })
    response.end(attackerHtml(sessionAOrigin))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate the web client-host fixture port.'))
        return
      }
      port = address.port
      resolve()
    })
  })

  return {
    close: () => closeServer(server),
    attackerOrigin: `http://attacker.localhost:${port}`,
    getMobileViewportProbeEvents: () =>
      structuredClone(mobileViewportProbeEvents),
    parentOrigin: `http://web.localhost:${port}`,
    sessionAOrigin: `http://session-a.localhost:${port}`,
    sessionBOrigin: `http://session-b.localhost:${port}`,
  }
}

function mobileViewportProbeParentHtml(sessionOrigin: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Terminay mobile viewport probe</title>
    <style>
      :root { --visual-height: 100dvh; }
      html, body { height: 100%; margin: 0; overflow: hidden; }
      #shell { height: var(--visual-height); min-height: 0; overflow: hidden; }
      iframe { border: 0; display: block; height: 100%; width: 100%; }
    </style>
  </head>
  <body>
    <main id="shell">
      <iframe
        id="session-a"
        title="Session A mobile viewport probe"
        sandbox="allow-scripts allow-same-origin"
        src="${sessionOrigin}/session?mobile-viewport-probe"
      ></iframe>
    </main>
    <script src="/mobile-viewport-probe-parent.js"></script>
  </body>
</html>`
}

function mobileViewportProbeSessionHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en" data-session-id="${sessionId}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${sessionId} xterm mobile viewport probe</title>
    <link rel="stylesheet" href="/xterm.css">
    <style>
      html, body { height: 100%; margin: 0; min-height: 0; overflow: hidden; }
      body {
        background: #080b0d;
        box-sizing: border-box;
        color: #e9edf5;
        display: grid;
        font: 13px ui-monospace, monospace;
        grid-template-rows: auto minmax(0, 1fr);
        padding: max(6px, env(safe-area-inset-top)) 6px max(6px, env(safe-area-inset-bottom));
      }
      #probe-status {
        background: #18212a;
        border-radius: 4px;
        color: #dce8f5;
        min-height: 34px;
        overflow-wrap: anywhere;
        padding: 4px 6px;
      }
      #terminal { min-height: 0; overflow: hidden; padding-top: 4px; }
      #terminal .xterm { height: 100%; }
      #terminal .xterm-viewport { overflow-y: auto; }
    </style>
  </head>
  <body>
    <output id="probe-status" aria-live="polite">Starting mobile viewport probe</output>
    <main id="terminal" aria-label="Terminay xterm terminal"></main>
    <script src="/xterm.js"></script>
    <script src="/mobile-viewport-probe-session.js"></script>
  </body>
</html>`
}

function parentHtml(sessionAOrigin: string, sessionBOrigin: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Terminay Web host proof</title>
    <style>
      html, body { height: 100%; margin: 0; }
      #shell { display: grid; grid-template-columns: 1fr 1fr; height: 100%; min-width: 0; }
      .session-slot { min-width: 0; overflow: hidden; }
      iframe { border: 0; display: block; height: 100%; width: 100%; }
      @media (max-width: 600px) {
        #shell { display: block; }
        .session-slot { height: 50%; }
      }
    </style>
  </head>
  <body>
    <main id="shell">
      <section class="session-slot"><iframe id="session-a" title="Session A" sandbox="allow-scripts allow-same-origin" allow="clipboard-read; clipboard-write" src="${sessionAOrigin}/session"></iframe></section>
      <section class="session-slot"><iframe id="session-b" title="Session B" sandbox="allow-scripts allow-same-origin" allow="clipboard-read; clipboard-write" src="${sessionBOrigin}/session"></iframe></section>
    </main>
    <script src="/parent.js"></script>
  </body>
</html>`
}

function sessionHtml(sessionId: string, parentOrigin: string): string {
  return `<!doctype html>
<html lang="en" data-session-id="${sessionId}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${sessionId}</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body { display: grid; grid-template-rows: auto 1fr; }
      #workspace { min-width: 0; overflow: hidden; }
      #terminal-input { box-sizing: border-box; width: 100%; }
      @media (max-width: 600px) {
        body { font-size: 18px; }
        #workspace::before { content: "mobile"; }
      }
    </style>
  </head>
  <body data-parent-origin="${parentOrigin}">
    <input id="terminal-input" aria-label="Terminal input">
    <section id="workspace" data-workspace-secret="${sessionId}-workspace">Workspace ${sessionId}</section>
    <button id="copy" type="button">Copy sentinel</button>
    <output id="copy-result"></output>
    <button id="navigate-top" type="button">Navigate parent</button>
    <output id="navigation-result"></output>
    <script src="/session.js"></script>
  </body>
</html>`
}

function attackerHtml(sessionAOrigin: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Attacker host</title></head>
  <body><iframe id="forbidden-session" src="${sessionAOrigin}/session"></iframe></body>
</html>`
}

function parentScript(): string {
  return `(() => {
  const peers = new Map([
    [document.querySelector('#session-a').contentWindow, { origin: new URL(document.querySelector('#session-a').src).origin, sessionId: 'session-a' }],
    [document.querySelector('#session-b').contentWindow, { origin: new URL(document.querySelector('#session-b').src).origin, sessionId: 'session-b' }],
  ])
  const state = {
    accepted: [],
    rejected: [],
    viewports: {},
  }
  const exactKeys = (value, keys) =>
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|')
  const valid = (message, sessionId) => {
    if (exactKeys(message, ['type', 'version', 'sessionId']) &&
        message.type === 'terminay-session-ready' &&
        message.version === 1 &&
        message.sessionId === sessionId) return true
    return exactKeys(message, ['type', 'version', 'sessionId', 'width', 'height']) &&
      message.type === 'terminay-session-viewport' &&
      message.version === 1 &&
      message.sessionId === sessionId &&
      Number.isFinite(message.width) &&
      Number.isFinite(message.height)
  }
  window.addEventListener('message', (event) => {
    const peer = peers.get(event.source)
    if (!peer || event.origin !== peer.origin || !valid(event.data, peer.sessionId)) {
      state.rejected.push({ origin: event.origin, type: event.data?.type ?? null })
      return
    }
    state.accepted.push({ origin: event.origin, sessionId: peer.sessionId, type: event.data.type })
    if (event.data.type === 'terminay-session-ready') {
      event.source.postMessage({
        type: 'terminay-host-context',
        version: 1,
        sessionId: peer.sessionId,
        profile: { label: peer.sessionId === 'session-a' ? 'Local lab' : 'Remote lab' },
      }, peer.origin)
    } else {
      state.viewports[peer.sessionId] = { width: event.data.width, height: event.data.height }
    }
  })
  window.hostProof = {
    state,
    sendInvalidTo(sessionId) {
      const frame = document.querySelector('#' + sessionId)
      frame.contentWindow.postMessage({
        type: 'terminay-host-context',
        version: 1,
        sessionId,
        profile: { label: 'valid-looking' },
        secret: 'schema-smuggling-attempt',
      }, new URL(frame.src).origin)
    },
  }
})()`
}

function sessionScript(): string {
  return `(() => {
  const sessionId = document.documentElement.dataset.sessionId
  const parentOrigin = document.body.dataset.parentOrigin
  const state = { accepted: [], rejected: [], typed: '' }
  const exactKeys = (value, keys) =>
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|')
  const validHostContext = (message) =>
    exactKeys(message, ['type', 'version', 'sessionId', 'profile']) &&
    message.type === 'terminay-host-context' &&
    message.version === 1 &&
    message.sessionId === sessionId &&
    exactKeys(message.profile, ['label']) &&
    typeof message.profile.label === 'string'

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('terminay-session-credentials', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('credentials')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }
  async function seed() {
    const database = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('credentials', 'readwrite')
      const store = transaction.objectStore('credentials')
      store.put(sessionId + '-device-key', 'device-key')
      store.put(sessionId + '-reconnect-grant', 'reconnect-grant')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    localStorage.setItem('workspace-data', sessionId + '-workspace-state')
    const cache = await caches.open('terminay-session-assets')
    await cache.put('/workspace-snapshot', new Response(sessionId + '-cached-workspace'))
  }
  async function readStorage() {
    const database = await openDatabase()
    const read = (key) => new Promise((resolve, reject) => {
      const request = database.transaction('credentials').objectStore('credentials').get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
    const cache = await caches.open('terminay-session-assets')
    const cached = await cache.match('/workspace-snapshot')
    const result = {
      cookie: document.cookie,
      deviceKey: await read('device-key'),
      reconnectGrant: await read('reconnect-grant'),
      workspace: localStorage.getItem('workspace-data'),
      cache: cached ? await cached.text() : null,
    }
    database.close()
    return result
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== parentOrigin || !validHostContext(event.data)) {
      state.rejected.push({ origin: event.origin, type: event.data?.type ?? null })
      return
    }
    state.accepted.push(event.data)
  })
  document.querySelector('#terminal-input').addEventListener('input', (event) => {
    state.typed = event.target.value
  })
  document.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(sessionId + '-clipboard')
      document.querySelector('#copy-result').textContent = 'copied'
    } catch (error) {
      document.querySelector('#copy-result').textContent = error.name
    }
  })
  document.querySelector('#navigate-top').addEventListener('click', () => {
    try {
      top.location.href = 'http://attacker.localhost/'
      document.querySelector('#navigation-result').textContent = 'attempted'
    } catch (error) {
      document.querySelector('#navigation-result').textContent = error.name
    }
  })
  new ResizeObserver(() => {
    parent.postMessage({
      type: 'terminay-session-viewport',
      version: 1,
      sessionId,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }, parentOrigin)
  }).observe(document.documentElement)

  window.sessionProof = {
    readStorage,
    state,
    attackParentAs(otherSessionId) {
      parent.postMessage({
        type: 'terminay-session-ready',
        version: 1,
        sessionId: otherSessionId,
      }, parentOrigin)
    },
    readSibling(index) {
      try {
        return parent.frames[index].document.body.textContent
      } catch (error) {
        return error.name
      }
    },
  }
  seed().then(() => {
    parent.postMessage({ type: 'terminay-session-ready', version: 1, sessionId }, parentOrigin)
  })
})()`
}

function mobileViewportProbeParentScript(): string {
  return `(() => {
  const visualViewport = window.visualViewport
  const report = (event) => {
    const height = visualViewport?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--visual-height', height + 'px')
    fetch('/mobile-viewport-probe-events', {
      body: JSON.stringify({
        activeClass: document.activeElement?.className ?? '',
        activeTag: document.activeElement?.tagName ?? '',
        event,
        innerHeight: window.innerHeight,
        layoutHeight: document.documentElement.clientHeight,
        source: 'parent',
        terminalBottom: null,
        terminalTop: null,
        typed: '',
        visualHeight: height,
        visualOffsetTop: visualViewport?.offsetTop ?? 0,
      }),
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      method: 'POST',
    })
  }
  visualViewport?.addEventListener('resize', () => report('visual-resize'))
  visualViewport?.addEventListener('scroll', () => report('visual-scroll'))
  window.addEventListener('resize', () => report('window-resize'))
  report('ready')
})()`
}

function mobileViewportProbeSessionScript(): string {
  return `(() => {
  const terminalContainer = document.querySelector('#terminal')
  const status = document.querySelector('#probe-status')
  const visualViewport = window.visualViewport
  const terminal = new Terminal({
    cols: 40,
    cursorBlink: true,
    rows: 24,
    scrollback: 100,
    theme: { background: '#080b0d', foreground: '#e9edf5' },
  })
  let typed = ''
  let lastSize = ''
  terminal.open(terminalContainer)
  terminal.textarea?.setAttribute('aria-label', 'Terminay xterm input')

  const resizeTerminal = () => {
    const rect = terminalContainer.getBoundingClientRect()
    const cols = Math.max(10, Math.floor(rect.width / 9))
    const rows = Math.max(2, Math.floor(rect.height / 18))
    const size = cols + 'x' + rows
    if (size !== lastSize) {
      terminal.resize(cols, rows)
      lastSize = size
    }
  }
  resizeTerminal()
  terminal.write('Terminay iOS xterm probe\\r\\n$ ')
  const report = (event) => {
    resizeTerminal()
    const terminalRect = terminalContainer.getBoundingClientRect()
    const height = visualViewport?.height ?? window.innerHeight
    const offsetTop = visualViewport?.offsetTop ?? 0
    const active = document.activeElement
    const payload = {
      activeClass: typeof active?.className === 'string' ? active.className : '',
      activeTag: active?.tagName ?? '',
      event,
      innerHeight: window.innerHeight,
      layoutHeight: document.documentElement.clientHeight,
      source: document.documentElement.dataset.sessionId,
      terminalBottom: terminalRect.bottom,
      terminalTop: terminalRect.top,
      typed,
      visualHeight: height,
      visualOffsetTop: offsetTop,
    }
    status.textContent =
      event + ' · typed=' + typed + ' · vv=' + Math.round(height) +
      '@' + Math.round(offsetTop) + ' · term=' +
      Math.round(terminalRect.top) + '–' + Math.round(terminalRect.bottom) +
      ' · ' + lastSize
    fetch('/mobile-viewport-probe-events', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      method: 'POST',
    })
  }

  terminal.onData((data) => {
    typed += data
    terminal.write(data === '\\r' ? '\\r\\n$ ' : data)
    report('xterm-data')
  })
  terminal.textarea?.addEventListener('focus', () => report('xterm-focus'))
  terminal.textarea?.addEventListener('blur', () => report('xterm-blur'))
  terminalContainer.addEventListener('click', () => {
    terminal.focus()
    report('terminal-click')
  })
  visualViewport?.addEventListener('resize', () => report('visual-resize'))
  visualViewport?.addEventListener('scroll', () => report('visual-scroll'))
  window.addEventListener('resize', () => report('window-resize'))
  new ResizeObserver(() => report('terminal-resize')).observe(terminalContainer)
  requestAnimationFrame(() => report('ready'))
})()`
}

function collectMobileViewportProbeEvent(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  events: MobileViewportProbeEvent[],
): void {
  const chunks: Buffer[] = []
  let byteLength = 0
  request.on('data', (chunk: Buffer) => {
    byteLength += chunk.byteLength
    if (byteLength <= 16 * 1024) chunks.push(chunk)
  })
  request.on('end', () => {
    if (byteLength > 16 * 1024) {
      response.writeHead(413).end()
      return
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (isMobileViewportProbeEvent(value)) {
        events.push(value)
        if (events.length > 500) events.shift()
        response.writeHead(204).end()
        return
      }
    } catch {
      // The probe reports a bad request without weakening the main host fixture.
    }
    response.writeHead(400).end()
  })
}

function isMobileViewportProbeEvent(
  value: unknown,
): value is MobileViewportProbeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    typeof event.activeClass === 'string' &&
    typeof event.activeTag === 'string' &&
    typeof event.event === 'string' &&
    typeof event.innerHeight === 'number' &&
    typeof event.layoutHeight === 'number' &&
    typeof event.source === 'string' &&
    (event.terminalBottom === null ||
      typeof event.terminalBottom === 'number') &&
    (event.terminalTop === null || typeof event.terminalTop === 'number') &&
    typeof event.typed === 'string' &&
    typeof event.visualHeight === 'number' &&
    typeof event.visualOffsetTop === 'number'
  )
}

function sendJson(
  response: import('node:http').ServerResponse,
  value: unknown,
): void {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

function sendJavaScript(response: import('node:http').ServerResponse, source: string): void {
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
  })
  response.end(source)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
