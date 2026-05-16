import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { RemoteServerMessage, RemoteSessionSummary } from './protocol'
import { authenticateDevice, pairDevice, revokeCurrentDevice } from './services/auth'
import {
  generateDeviceKeyPair,
  loadReconnectGrant,
  loadPairing,
  removeReconnectGrant,
  removePairing,
  saveReconnectGrant,
  savePairing,
} from './services/deviceKeys'
import { parsePairingBootstrap } from './services/pairing'
import type { RemoteMessageSocket } from './services/socket'
import { createRemoteTransportRuntime } from './services/transport'
import '@xterm/xterm/css/xterm.css'
import './index.css'

type SessionState = RemoteSessionSummary & {
  buffer: string
}

type RemoteSettings = {
  fontSize: number
  lineHeight: number
  fontFamily: string
  cursorBlink: boolean
  theme: 'dark' | 'light' | 'vscode'
}

type ProjectState = {
  id: string
  title: string
  emoji: string
  color: string
  sessionIds: string[]
}

type ReconnectGrantUiState = {
  expiresAt: string | null
  issuedAt: string
  sessionId: string
  status: 'valid' | 'expired' | 'until-revoked'
}

const DEFAULT_SETTINGS: RemoteSettings = {
  fontSize: 13,
  lineHeight: 1,
  fontFamily: '"SF Mono", "Cascadia Code", Menlo, Monaco, monospace',
  cursorBlink: true,
  theme: 'dark'
}

const THEMES = {
  dark: { background: '#000000', foreground: '#ffffff', cursor: '#ffffff' },
  light: { background: '#ffffff', foreground: '#000000', cursor: '#000000' },
  vscode: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#ffffff' }
}

const PAIRING_QUERY_KEYS = ['pairingSessionId', 'pairingToken', 'pairingExpiresAt'] as const
const PAIRING_PIN_COOKIE_NAME = '__Host-terminay_pin'
const PAIRING_PIN_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const UNPAIRED_AUTH_ERROR_MESSAGES = new Set([
  'This device is not paired with this host.',
  'This device is paired with a different origin.',
])
const PIN_AUTH_ERROR_MESSAGES = new Set([
  'Remote PIN was missing or incorrect.',
  'Pairing failed. Check the PIN and try a fresh QR code.',
])

function getInitialPairingInput(): string {
  return PAIRING_QUERY_KEYS.some((key) => window.location.href.includes(`${key}=`))
    ? window.location.href
    : ''
}

function hasPairingBootstrapInput(input: string): boolean {
  if (!input.trim()) return false

  try {
    parsePairingBootstrap(input)
    return true
  } catch {
    return false
  }
}

function scrubPairingQueryFromUrl(): void {
  const currentUrl = new URL(window.location.href)
  const hadPairingQuery = PAIRING_QUERY_KEYS.some((key) => currentUrl.searchParams.has(key))

  if (!hadPairingQuery) {
    return
  }

  PAIRING_QUERY_KEYS.forEach((key) => {
    currentUrl.searchParams.delete(key)
  })
  const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
  window.history.replaceState({}, document.title, nextUrl || window.location.pathname)
}

function getInitialManagerAction(): 'revoke' | null {
  const bridgeAction = (window.__TERMINAY_REMOTE_WEBRTC__ as { managerAction?: string } | undefined)?.managerAction
  if (bridgeAction === 'revoke') return 'revoke'

  const currentUrl = new URL(window.location.href)
  return currentUrl.searchParams.get('terminayManagerAction') === 'revoke' ? 'revoke' : null
}

function scrubManagerActionFromUrl(): void {
  const currentUrl = new URL(window.location.href)
  if (!currentUrl.searchParams.has('terminayManagerAction')) return

  currentUrl.searchParams.delete('terminayManagerAction')
  window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
}

function getReconnectGrantStatus(expiresAt: string | null): ReconnectGrantUiState['status'] {
  if (expiresAt === null) return 'until-revoked'
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) && parsed > Date.now() ? 'valid' : 'expired'
}

function formatReconnectExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Reconnect valid until revoked'
  const parsed = Date.parse(expiresAt)
  if (!Number.isFinite(parsed)) return 'Reconnect expiry unknown'
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed))
  return parsed > Date.now() ? `Reconnect until ${formatted}` : `Reconnect expired ${formatted}`
}

function isUnpairedAuthError(error: unknown): boolean {
  return error instanceof Error && UNPAIRED_AUTH_ERROR_MESSAGES.has(error.message)
}

function isPinAuthError(error: unknown): boolean {
  return error instanceof Error && PIN_AUTH_ERROR_MESSAGES.has(error.message)
}

function isSixDigitPin(value: string): boolean {
  return /^\d{6}$/.test(value)
}

function readPairingPinCookie(): string {
  const prefix = `${PAIRING_PIN_COOKIE_NAME}=`
  const encoded = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
  if (!encoded) return ''

  try {
    const value = decodeURIComponent(encoded)
    return isSixDigitPin(value) ? value : ''
  } catch {
    return ''
  }
}

function writePairingPinCookie(pin: string): void {
  if (!isSixDigitPin(pin)) return
  // biome-ignore lint/suspicious/noDocumentCookie: the spec requires a host-only cookie for session-subdomain PIN reuse.
  document.cookie = `${PAIRING_PIN_COOKIE_NAME}=${encodeURIComponent(pin)}; Max-Age=${PAIRING_PIN_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Strict; Secure`
}

function clearPairingPinCookie(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: the spec requires clearing the host-only PIN cookie when auth rejects it.
  document.cookie = `${PAIRING_PIN_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict; Secure`
}

function getManagerListUrl(managerUrl: string): string {
  if (managerUrl) {
    try {
      const url = new URL(managerUrl)
      url.pathname = '/'
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return managerUrl
    }
  }

  if (window.location.hostname.toLowerCase().endsWith('.terminay.com')) {
    const url = new URL(window.location.href)
    url.hostname = 'app.terminay.com'
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  return ''
}

type AccessoryAction =
  | { id: string; kind: 'toggle-modifier'; label: string; modifier: 'ctrl' | 'alt' }
  | { id: string; kind: 'scrollback'; label: string; mode: 'page-up' | 'page-down' | 'top' | 'bottom' }
  | { id: string; kind: 'send'; label: string; payload: string; useModifiers?: boolean }

function getSessionProjectId(session: Pick<RemoteSessionSummary, 'projectId'>): string {
  return session.projectId || 'default'
}

const ACCESSORY_ACTIONS: AccessoryAction[] = [
  { id: 'history-up', kind: 'scrollback', label: 'Hist↑', mode: 'page-up' },
  { id: 'history-down', kind: 'scrollback', label: 'Hist↓', mode: 'page-down' },
  { id: 'history-live', kind: 'scrollback', label: 'Live', mode: 'bottom' },
  { id: 'ctrl', kind: 'toggle-modifier', label: 'Ctrl', modifier: 'ctrl' },
  { id: 'alt', kind: 'toggle-modifier', label: 'Alt', modifier: 'alt' },
  { id: 'esc', kind: 'send', label: 'Esc', payload: '\x1b' },
  { id: 'tab', kind: 'send', label: 'Tab', payload: '\t' },
  { id: 'up', kind: 'send', label: '↑', payload: '\x1b[A' },
  { id: 'down', kind: 'send', label: '↓', payload: '\x1b[B' },
  { id: 'left', kind: 'send', label: '←', payload: '\x1b[D' },
  { id: 'right', kind: 'send', label: '→', payload: '\x1b[C' },
  { id: 'home', kind: 'send', label: 'Home', payload: '\x1b[H' },
  { id: 'end', kind: 'send', label: 'End', payload: '\x1b[F' },
  { id: 'pgup', kind: 'send', label: 'PgUp', payload: '\x1b[5~' },
  { id: 'pgdn', kind: 'send', label: 'PgDn', payload: '\x1b[6~' },
  { id: 'ctrl-c', kind: 'send', label: '^C', payload: 'c', useModifiers: true },
  { id: 'ctrl-d', kind: 'send', label: '^D', payload: 'd', useModifiers: true },
  { id: 'ctrl-l', kind: 'send', label: '^L', payload: 'l', useModifiers: true },
]

function applyCtrlModifier(payload: string): string {
  if (payload.length !== 1) {
    return payload
  }

  const char = payload
  const lower = char.toLowerCase()

  if (lower >= 'a' && lower <= 'z') {
    return String.fromCharCode(lower.charCodeAt(0) - 96)
  }

  switch (char) {
    case ' ':
      return '\x00'
    case '[':
      return '\x1b'
    case '\\':
      return '\x1c'
    case ']':
      return '\x1d'
    case '^':
      return '\x1e'
    case '_':
    case '/':
      return '\x1f'
    default:
      return payload
  }
}

function getDefaultDeviceName(): string {
  const platform = navigator.userAgent
  if (platform.includes('iPhone')) return 'iPhone Safari'
  if (platform.includes('iPad')) return 'iPad Safari'
  if (platform.includes('Mac')) return 'Mac Browser'
  return 'Terminay Remote Browser'
}

export function RemoteApp() {
  const [transportRuntime] = useState(() => createRemoteTransportRuntime())

  // --- UI State ---
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<RemoteSettings>(() => {
    const saved = localStorage.getItem('terminay-remote-settings')
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
  })

  // --- Connection State ---
  const [pairingInput] = useState(() => getInitialPairingInput())
  const [managerAction, setManagerAction] = useState<'revoke' | null>(() => getInitialManagerAction())
  const [pairingPin, setPairingPin] = useState('')
  const [deviceName, setDeviceName] = useState(getDefaultDeviceName())
  const [pairingState, setPairingState] = useState<'checking' | 'needs-pairing' | 'paired'>('checking')
  const [hasStoredPairing, setHasStoredPairing] = useState(false)
  const [statusText, setStatusText] = useState('Checking this browser…')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [reconnectGrant, setReconnectGrant] = useState<ReconnectGrantUiState | null>(null)
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'live'>('idle')
  const [connectionCount, setConnectionCount] = useState(0)
  const [sessions, setSessions] = useState<Record<string, SessionState>>({})
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [hasTouchAccessory, setHasTouchAccessory] = useState(false)
  const [pendingCtrl, setPendingCtrl] = useState(false)
  const [pendingAlt, setPendingAlt] = useState(false)
  const [terminalZoom, setTerminalZoom] = useState(1)

  // --- Refs ---
  const socketRef = useRef<RemoteMessageSocket | null>(null)
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const xtermContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const pendingAuthPinRef = useRef('')
  const selectedSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<Record<string, SessionState>>({})
  const pendingCtrlRef = useRef(false)
  const pendingAltRef = useRef(false)
  const pointerPanStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)
  const remoteResizeFrameRef = useRef<number | null>(null)
  const lastSentRemoteSizeRef = useRef<{ cols: number; rows: number; sessionId: string } | null>(null)

  const setCtrlPending = useCallback((value: boolean) => {
    pendingCtrlRef.current = value
    setPendingCtrl(value)
  }, [])

  const setAltPending = useCallback((value: boolean) => {
    pendingAltRef.current = value
    setPendingAlt(value)
  }, [])

  const clearPendingModifiers = useCallback(() => {
    setCtrlPending(false)
    setAltPending(false)
  }, [setAltPending, setCtrlPending])

  const scheduleRemoteFitAndResize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const container = xtermContainerRef.current
    const sessionId = selectedSessionIdRef.current
    if (!terminal || !fitAddon || !container || !sessionId) return

    if (remoteResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteResizeFrameRef.current)
    }

    remoteResizeFrameRef.current = window.requestAnimationFrame(() => {
      remoteResizeFrameRef.current = null
      if (!container.clientWidth || !container.clientHeight) {
        return
      }

      try {
        fitAddon.fit()
      } catch {
        return
      }

      const cols = Math.max(2, Math.floor(terminal.cols))
      const rows = Math.max(1, Math.floor(terminal.rows))
      const lastSent = lastSentRemoteSizeRef.current
      if (lastSent?.sessionId === sessionId && lastSent.cols === cols && lastSent.rows === rows) {
        return
      }

      try {
        socketRef.current?.send({ cols, rows, sessionId, type: 'resize' })
        lastSentRemoteSizeRef.current = { cols, rows, sessionId }
      } catch {
        // The socket may still be handshaking or closing; the next layout or
        // session event will retry the active remote size.
      }
    })
  }, [])

  const renderSessionBuffer = useCallback((sessionId: string | null) => {
    const terminal = terminalRef.current
    if (!terminal || !sessionId) return

    const session = sessionsRef.current[sessionId]
    if (!session) return

    const MAX_INITIAL_BUFFER = 50000
    const buffer = session.buffer.length > MAX_INITIAL_BUFFER
      ? session.buffer.slice(-MAX_INITIAL_BUFFER)
      : session.buffer

    terminal.reset()
    scheduleRemoteFitAndResize()
    terminal.write(buffer, () => {
      scheduleRemoteFitAndResize()
    })
  }, [scheduleRemoteFitAndResize])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    scrubPairingQueryFromUrl()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)')
    const updateTouchAccessory = () => {
      setHasTouchAccessory(media.matches || navigator.maxTouchPoints > 0)
    }

    updateTouchAccessory()
    media.addEventListener?.('change', updateTouchAccessory)

    return () => {
      media.removeEventListener?.('change', updateTouchAccessory)
    }
  }, [])

  useEffect(() => {
    const handleViewportChange = () => {
      scheduleRemoteFitAndResize()
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)
    window.visualViewport?.addEventListener('resize', handleViewportChange)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
      window.visualViewport?.removeEventListener('resize', handleViewportChange)
    }
  }, [scheduleRemoteFitAndResize])

  // Save settings
  useEffect(() => {
    localStorage.setItem('terminay-remote-settings', JSON.stringify(settings))
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = settings.fontSize * terminalZoom
      terminalRef.current.options.lineHeight = settings.lineHeight
      terminalRef.current.options.fontFamily = settings.fontFamily
      terminalRef.current.options.cursorBlink = settings.cursorBlink
      terminalRef.current.options.theme = THEMES[settings.theme]
      scheduleRemoteFitAndResize()
    }
  }, [settings, scheduleRemoteFitAndResize, terminalZoom])

  const sendAttachForSession = useCallback((sessionId: string) => {
    const socket = socketRef.current
    if (!socket) return
    socket.send({ sessionId, type: 'attach-session' })
  }, [])

  const sendDetachForSession = useCallback((sessionId: string) => {
    const socket = socketRef.current
    if (!socket) return
    socket.send({ sessionId, type: 'detach-session' })
  }, [])

  useEffect(() => {
    const previousSessionId = selectedSessionIdRef.current
    if (previousSessionId === selectedSessionId) {
      return
    }

    selectedSessionIdRef.current = selectedSessionId
    lastSentRemoteSizeRef.current = null

    try {
      if (previousSessionId) {
        sendDetachForSession(previousSessionId)
      }
      if (selectedSessionId) {
        sendAttachForSession(selectedSessionId)
      }
    } catch {
      // A reconnecting socket may not be ready yet. The session-list handler
      // attaches the selected session again once the socket handshakes.
    }

    scheduleRemoteFitAndResize()
  }, [scheduleRemoteFitAndResize, selectedSessionId, sendAttachForSession, sendDetachForSession])

  const sendTerminalPayload = useCallback((payload: string, usePendingModifiers = true) => {
    const socket = socketRef.current
    const sessionId = selectedSessionIdRef.current
    if (!socket || !sessionId || payload.length === 0) {
      return
    }

    let nextPayload = payload

    if (usePendingModifiers) {
      if (pendingCtrlRef.current) {
        nextPayload = applyCtrlModifier(nextPayload)
      }
      if (pendingAltRef.current) {
        nextPayload = `\x1b${nextPayload}`
      }
      clearPendingModifiers()
    }

    socket.send({ payload: nextPayload, sessionId, type: 'write' })
  }, [clearPendingModifiers])

  // --- Terminal Initialization ---
  useEffect(() => {
    const container = xtermContainerRef.current
    if (!container || pairingState !== 'paired') return

    const terminal = new Terminal({
      cursorBlink: settings.cursorBlink,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize * terminalZoom,
      lineHeight: settings.lineHeight,
      theme: THEMES[settings.theme],
      allowTransparency: true,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    renderSessionBuffer(selectedSessionIdRef.current)
    scheduleRemoteFitAndResize()

    const dataDisposer = terminal.onData((data) => {
      sendTerminalPayload(data)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return
      scheduleRemoteFitAndResize()
    })
    resizeObserver.observe(container)

    return () => {
      if (remoteResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(remoteResizeFrameRef.current)
        remoteResizeFrameRef.current = null
      }
      dataDisposer.dispose()
      resizeObserver.disconnect()
      fitAddonRef.current = null
      terminal.dispose()
      terminalRef.current = null
    }
  }, [pairingState, renderSessionBuffer, scheduleRemoteFitAndResize, sendTerminalPayload, settings, terminalZoom])

  // Sync terminal content on session change
  useEffect(() => {
    renderSessionBuffer(selectedSessionId)
    scheduleRemoteFitAndResize()
  }, [renderSessionBuffer, scheduleRemoteFitAndResize, selectedSessionId])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer()
    reconnectTimerRef.current = window.setTimeout(() => setReconnectNonce(n => n + 1), 1500)
  }, [clearReconnectTimer])

  // --- Auth Lifecycle ---
  useEffect(() => {
    void (async () => {
      try {
        if (hasPairingBootstrapInput(pairingInput)) {
          setReconnectGrant(null)
          setHasStoredPairing(false)
          setPairingState('needs-pairing')
          setStatusText('Enter the PIN shown in Terminay to pair this browser.')
          return
        }

        const pairing = await loadPairing(transportRuntime.pairingOrigin)
        if (!pairing) {
          setReconnectGrant(null)
          setHasStoredPairing(false)
          setPairingState('needs-pairing')
          setStatusText('Pair this browser to your Terminay host.')
          return
        }
        const grant = await loadReconnectGrant(transportRuntime.pairingOrigin)
        setReconnectGrant(grant ? {
          expiresAt: grant.expiresAt,
          issuedAt: grant.issuedAt,
          sessionId: grant.sessionId,
          status: getReconnectGrantStatus(grant.expiresAt),
        } : null)
        setHasStoredPairing(true)
        setDeviceName(pairing.deviceName)
        setPairingState('paired')
        setStatusText(`Paired as ${pairing.deviceName}.`)
      } catch (error) {
        setReconnectGrant(null)
        setHasStoredPairing(false)
        setPairingState('needs-pairing')
        setErrorText(error instanceof Error ? error.message : 'Unable to initialize.')
      }
    })()
  }, [pairingInput, transportRuntime.pairingOrigin])

  const handleServerMessage = useCallback((message: RemoteServerMessage): void => {
    switch (message.type) {
      case 'session-list': {
        const currentSelectedSessionId = selectedSessionIdRef.current
        const nextId = (currentSelectedSessionId && message.sessions.some(s => s.id === currentSelectedSessionId))
          ? currentSelectedSessionId
          : (message.sessions[0]?.id ?? null)

        const nextSessions = Object.fromEntries(
          message.sessions.map((s) => [s.id, { ...s, buffer: sessionsRef.current[s.id]?.buffer ?? '' }]),
        )
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        setConnectionCount(message.connectionCount)
        setSelectedSessionId(nextId)
        if (nextId && nextId === currentSelectedSessionId) sendAttachForSession(nextId)
        scheduleRemoteFitAndResize()
        return
      }
      case 'session-opened': {
        const nextSession = {
          ...message.session,
          buffer: message.session.buffer,
        }
        sessionsRef.current = { ...sessionsRef.current, [message.session.id]: nextSession }
        setSessions(current => ({ ...current, [message.session.id]: nextSession }))
        setSelectedSessionId(message.session.id)
        renderSessionBuffer(message.session.id)
        return
      }
      case 'session-updated': {
        sessionsRef.current = {
          ...sessionsRef.current,
          [message.session.id]: {
            ...sessionsRef.current[message.session.id],
            ...message.session,
            buffer: sessionsRef.current[message.session.id]?.buffer ?? '',
          },
        }
        if (message.session.id === selectedSessionIdRef.current) scheduleRemoteFitAndResize()
        setSessions(current => ({ ...current, [message.session.id]: { ...current[message.session.id], ...message.session, buffer: current[message.session.id]?.buffer ?? '' } }))
        return
      }
      case 'session-closed':
        setSessions(current => { const n = { ...current }; delete n[message.id]; return n })
        setSelectedSessionId(curr => curr === message.id ? null : curr)
        return
      case 'output':
        if (message.sessionId === selectedSessionIdRef.current) terminalRef.current?.write(message.payload)
        setSessions(current => {
          const s = current[message.sessionId]; if (!s) return current
          return { ...current, [message.sessionId]: { ...s, buffer: s.buffer + message.payload } }
        })
        return
      case 'exit':
        if (message.sessionId === selectedSessionIdRef.current) terminalRef.current?.write(`\r\n\x1b[31m[process exited with code ${message.exitCode}]\x1b[0m\r\n`)
        setSessions(current => ({ ...current, [message.sessionId]: { ...current[message.sessionId], exitCode: message.exitCode } }))
        return
      case 'error': setErrorText(message.message); return
    }
  }, [renderSessionBuffer, scheduleRemoteFitAndResize, sendAttachForSession])

  useEffect(() => {
    if (pairingState !== 'paired') return
    void reconnectNonce
    let cancelled = false
    clearReconnectTimer()
    void (async () => {
      try {
        const pairing = await loadPairing(transportRuntime.pairingOrigin)
        if (!pairing) {
          setPairingState('needs-pairing')
          setStatusText('Pair this browser to your Terminay host.')
          return
        }
        if (cancelled) return
        setConnectionState('connecting')
        setErrorText(null)
        const authenticated = await authenticateDevice({
          api: transportRuntime.api,
          deviceId: pairing.deviceId,
          pairingPin: pendingAuthPinRef.current || readPairingPinCookie() || undefined,
          privateKey: pairing.privateKey,
        })
        if (cancelled) return
        if (pendingAuthPinRef.current) {
          writePairingPinCookie(pendingAuthPinRef.current)
          pendingAuthPinRef.current = ''
          setPairingPin('')
        }
        if (managerAction === 'revoke') {
          setStatusText('Revoking this browser in Terminay...')
          try {
            await revokeCurrentDevice({
              api: transportRuntime.api,
              deviceId: pairing.deviceId,
            })
            await Promise.all([
              removePairing(transportRuntime.pairingOrigin),
              removeReconnectGrant(transportRuntime.pairingOrigin),
              'caches' in window ? window.caches.delete('terminay-remote-app') : Promise.resolve(false),
            ])
            clearPairingPinCookie()
            pendingAuthPinRef.current = ''
            if (cancelled) return
            setSessions({})
            setSelectedSessionId(null)
            setActiveProjectId(null)
            setReconnectGrant(null)
            setHasStoredPairing(false)
            setPairingState('needs-pairing')
            setConnectionState('idle')
            setStatusText('This browser was revoked. Scan a fresh QR code to pair again.')
            setManagerAction(null)
            scrubManagerActionFromUrl()
          } catch (error) {
            if (cancelled) return
            setConnectionState('idle')
            setErrorText(error instanceof Error
              ? `Terminay could not revoke this browser: ${error.message}`
              : 'Terminay could not revoke this browser.')
            setStatusText('Revocation needs Terminay to be reachable.')
          }
          return
        }
        const socket = transportRuntime.terminal.createSocket(authenticated.ticket, handleServerMessage, state => {
          setConnectionState(state === 'closed' ? 'idle' : state)
          if (state === 'closed') { socketRef.current = null; if (!cancelled) scheduleReconnect() }
        }, authenticated.websocketUrl)
        socketRef.current = socket
        await socket.connect()
      } catch (error) {
        setConnectionState('idle')
        if (isUnpairedAuthError(error)) {
          await removePairing(transportRuntime.pairingOrigin).catch(() => undefined)
          clearPairingPinCookie()
          pendingAuthPinRef.current = ''
          if (cancelled) return
          setSessions({})
          setSelectedSessionId(null)
          setActiveProjectId(null)
          setReconnectGrant(null)
          setHasStoredPairing(false)
          setPairingState('needs-pairing')
          setStatusText('Pair this browser to your Terminay host.')
          setErrorText('This browser is no longer paired with this Terminay host. Enter the PIN to pair it again.')
          return
        }
        if (isPinAuthError(error)) {
          pendingAuthPinRef.current = ''
          clearPairingPinCookie()
          if (cancelled) return
          setPairingPin('')
          setPairingState('needs-pairing')
          setStatusText('Enter the PIN shown in Terminay to reconnect this saved session.')
          setErrorText('Enter the Terminay PIN to reconnect this saved session.')
          return
        }

        setErrorText(error instanceof Error ? error.message : 'Auth failed.')
        if (!cancelled) scheduleReconnect()
      }
    })()
    return () => { cancelled = true; clearReconnectTimer(); socketRef.current?.close() }
  }, [pairingState, reconnectNonce, handleServerMessage, clearReconnectTimer, managerAction, scheduleReconnect, transportRuntime])

  // --- Grouping Logic ---
  const projects = useMemo(() => {
    const map = new Map<string, ProjectState>()
    Object.values(sessions).forEach((s: SessionState) => {
      const pid = getSessionProjectId(s)
      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          title: s.projectTitle || 'Default',
          emoji: s.projectEmoji || '',
          color: s.projectColor || '#4db5ff',
          sessionIds: []
        })
      }
      map.get(pid)!.sessionIds.push(s.id)
    })
    return Array.from(map.values())
  }, [sessions])

  // Keep activeProjectId and selectedSessionId in sync
  useEffect(() => {
    if (projects.length > 0 && !activeProjectId) {
      setActiveProjectId(projects[0].id)
    }
  }, [projects, activeProjectId])

  useEffect(() => {
    if (selectedSessionId) {
      const session = sessions[selectedSessionId]
      const sessionProjectId = session ? getSessionProjectId(session) : null
      if (sessionProjectId && sessionProjectId !== activeProjectId) {
        setActiveProjectId(sessionProjectId)
      }
    } else if (activeProjectId) {
       const project = projects.find((projectState) => projectState.id === activeProjectId)
       if (project && project.sessionIds.length > 0) {
         setSelectedSessionId(project.sessionIds[0])
       }
    }
  }, [selectedSessionId, activeProjectId, sessions, projects])

  // --- Handlers ---
  async function handlePair(e: FormEvent) {
    e.preventDefault(); setErrorText(null)
    try {
      if (!isSixDigitPin(pairingPin)) {
        throw new Error('Enter the six-digit PIN shown in Terminay.')
      }

      if (!hasPairingBootstrapInput(pairingInput)) {
        const existingPairing = await loadPairing(transportRuntime.pairingOrigin)
        if (!existingPairing) {
          throw new Error('Scan a fresh QR code to pair this browser.')
        }
        pendingAuthPinRef.current = pairingPin
        setHasStoredPairing(true)
        setPairingState('paired')
        setConnectionState('connecting')
        setStatusText(`Paired as ${existingPairing.deviceName}.`)
        setReconnectNonce(n => n + 1)
        return
      }

      const bootstrap = parsePairingBootstrap(pairingInput)
      const keyPair = await generateDeviceKeyPair()
      const paired = await pairDevice({
        api: transportRuntime.api,
        bootstrap,
        deviceName,
        pairingPin,
        publicKeyPem: keyPair.publicKeyPem,
      })
      writePairingPinCookie(pairingPin)
      await savePairing({
        deviceId: paired.deviceId,
        deviceName: paired.deviceName,
        origin: transportRuntime.pairingOrigin,
        privateKey: keyPair.privateKey,
        publicKeyPem: keyPair.publicKeyPem,
      })
      if (paired.reconnectGrant) {
        await saveReconnectGrant(paired.reconnectGrant)
        setReconnectGrant({
          expiresAt: paired.reconnectGrant.expiresAt,
          issuedAt: paired.reconnectGrant.issuedAt,
          sessionId: paired.reconnectGrant.sessionId,
          status: getReconnectGrantStatus(paired.reconnectGrant.expiresAt),
        })
      } else {
        setReconnectGrant(null)
      }
      setHasStoredPairing(true)
      setPairingPin('')
      setPairingState('paired'); window.history.replaceState({}, document.title, window.location.pathname)
    } catch (err) { setErrorText(err instanceof Error ? err.message : 'Pairing failed.') }
  }

  async function handleDisconnect() {
    clearReconnectTimer(); socketRef.current?.close()
    const listUrl = getManagerListUrl(managerUrl)
    if (listUrl) {
      window.location.assign(listUrl)
      return
    }

    setSessions({})
    setSelectedSessionId(null)
    setActiveProjectId(null)
    setConnectionState('idle')
  }

  const handleClear = () => { terminalRef.current?.clear(); terminalRef.current?.focus() }
  const handleReset = () => { terminalRef.current?.reset(); terminalRef.current?.focus() }
  const showAccessoryBar = pairingState === 'paired' && hasTouchAccessory && Boolean(selectedSessionId)
  const stepTerminalZoom = useCallback((delta: number) => {
    setTerminalZoom((current) => {
      const next = Math.round((current + delta) * 10) / 10
      return Math.min(2, Math.max(0.5, next))
    })
    terminalRef.current?.focus()
  }, [])

  useEffect(() => {
    void showAccessoryBar
    scheduleRemoteFitAndResize()
  }, [scheduleRemoteFitAndResize, showAccessoryBar])

  const handleAccessoryAction = useCallback((action: AccessoryAction) => {
    terminalRef.current?.focus()

    if (action.kind === 'scrollback') {
      const terminal = terminalRef.current
      if (!terminal) {
        return
      }

      switch (action.mode) {
        case 'page-up':
          terminal.scrollPages(-1)
          return
        case 'page-down':
          terminal.scrollPages(1)
          return
        case 'top':
          terminal.scrollToTop()
          return
        case 'bottom':
          terminal.scrollToBottom()
          return
      }
    }

    if (action.kind === 'toggle-modifier') {
      if (action.modifier === 'ctrl') {
        setCtrlPending(!pendingCtrlRef.current)
        return
      }

      setAltPending(!pendingAltRef.current)
      return
    }

    if (action.useModifiers) {
      const ctrlWasPending = pendingCtrlRef.current
      setCtrlPending(true)
      sendTerminalPayload(action.payload, true)
      if (ctrlWasPending) {
        setCtrlPending(true)
      }
      return
    }

    sendTerminalPayload(action.payload, false)
  }, [sendTerminalPayload, setAltPending, setCtrlPending])

  const currentProjectSessions = useMemo(() => {
    if (!activeProjectId) return []
    const project = projects.find((projectState) => projectState.id === activeProjectId)
    if (!project) return []
    return project.sessionIds.map((id: string) => sessions[id]).filter(Boolean) as SessionState[]
  }, [activeProjectId, projects, sessions])

  const handleProjectSelect = useCallback((project: ProjectState) => {
    setActiveProjectId(project.id)
    setSelectedSessionId((currentSessionId) => {
      if (currentSessionId) {
        const currentSession = sessionsRef.current[currentSessionId]
        if (currentSession && getSessionProjectId(currentSession) === project.id) {
          return currentSessionId
        }
      }

      return project.sessionIds[0] ?? null
    })
  }, [])

  const terminalSurfaceStyle = useMemo(() => {
    const visibility = Object.keys(sessions).length > 0 ? ('visible' as const) : ('hidden' as const)

    return {
      height: '100%',
      visibility,
      width: '100%',
    }
  }, [sessions])

  const terminalZoomShellStyle = useMemo(() => {
    const visibility = Object.keys(sessions).length > 0 ? ('visible' as const) : ('hidden' as const)

    return {
      height: '100%',
      visibility,
      width: '100%',
    }
  }, [sessions])

  const terminalScrollRegionStyle = useMemo(() => {
    if (!showAccessoryBar) {
      return undefined
    }

    return {
      bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
    }
  }, [showAccessoryBar])
  const managerUrl = typeof window.__TERMINAY_REMOTE_WEBRTC__?.managerUrl === 'string'
    ? window.__TERMINAY_REMOTE_WEBRTC__.managerUrl
    : ''
  const saveManagerUrl = useMemo(() => {
    if (!managerUrl) return ''
    if (!reconnectGrant) return managerUrl
    try {
      const url = new URL(managerUrl)
      url.searchParams.set('expiry', reconnectGrant.expiresAt ?? 'until-revoked')
      url.searchParams.set('status', reconnectGrant.status === 'expired' ? 'stale' : 'known')
      return url.toString()
    } catch {
      return managerUrl
    }
  }, [managerUrl, reconnectGrant])
  const reconnectGrantLabel = reconnectGrant ? formatReconnectExpiry(reconnectGrant.expiresAt) : 'Reconnect not saved'
  const canSubmitPairingPin = pairingPin.length === 6 && (hasPairingBootstrapInput(pairingInput) || hasStoredPairing)

  const clearPointerPan = useCallback(() => {
    pointerPanStateRef.current = null
  }, [])

  const handleTerminalPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    terminalRef.current?.focus()

    if (!hasTouchAccessory || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) {
      return
    }

    const scrollRegion = scrollRegionRef.current
    if (!scrollRegion) {
      return
    }

    pointerPanStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollRegion.scrollLeft,
      startScrollTop: scrollRegion.scrollTop,
    }

    scrollRegion.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [hasTouchAccessory])

  const handleTerminalPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const panState = pointerPanStateRef.current
    const scrollRegion = scrollRegionRef.current
    if (!panState || !scrollRegion || panState.pointerId !== event.pointerId) {
      return
    }

    scrollRegion.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startX)
    scrollRegion.scrollTop = panState.startScrollTop - (event.clientY - panState.startY)
    event.preventDefault()
  }, [])

  const handleTerminalPointerUpCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scrollRegion = scrollRegionRef.current
    const panState = pointerPanStateRef.current
    if (scrollRegion && panState && panState.pointerId === event.pointerId && scrollRegion.hasPointerCapture(event.pointerId)) {
      scrollRegion.releasePointerCapture(event.pointerId)
    }

    clearPointerPan()
  }, [clearPointerPan])

  return (
    <>
      {errorText && (
        <div className="error-banner">
          <span>{errorText}</span>
          <button className="button-ghost" style={{ color: 'white' }} onClick={() => setErrorText(null)}>✕</button>
        </div>
      )}
      {pairingState !== 'paired' ? (
        <div className="pairing-screen">
          <div className="pairing-box">
            <img className="pairing-mark" src="/terminay.svg" alt="" aria-hidden="true" />
            <p className="pairing-kicker">Terminay Remote</p>
            <h1>Enter PIN</h1>
            <p className="status">{statusText}</p>
            <form className="pairing-form" onSubmit={handlePair}>
              <div className="pin-field">
                <input
                  id="pairing-pin"
                  aria-label="Pairing PIN"
                  autoComplete="one-time-code"
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  type="text"
                  value={pairingPin}
                  onChange={e => setPairingPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <button type="submit" className="pair-button" disabled={!canSubmitPairingPin}>Pair Device</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="app-container">
          <div className="app-menu-bar">
            <div className="status-indicator">
              <div className={`status-dot ${connectionState === 'live' ? 'live' : connectionState === 'connecting' ? 'connecting' : ''}`} />
              <span>{connectionState === 'live' ? `${connectionCount} active` : connectionState}</span>
            </div>
            <div className={`reconnect-expiry reconnect-expiry--${reconnectGrant?.status ?? 'none'}`} title={reconnectGrantLabel}>
              {reconnectGrantLabel}
            </div>
            <div className="app-menu">
              <div className="menu-item" onClick={() => terminalRef.current?.focus()}>Focus</div>
              <div className="menu-item" onClick={handleClear}>Clear</div>
              <div className="menu-item" onClick={handleReset}>Reset</div>
              <div className="menu-item" onClick={() => setShowSettings(true)}>Settings</div>
              {saveManagerUrl ? (
                <a className="menu-item" href={saveManagerUrl}>Save to Manager</a>
              ) : null}
              <div className="menu-item" onClick={handleDisconnect}>Disconnect</div>
            </div>
          </div>

          <div className="app-project-bar">
             <div className="project-tabs">
               {projects.map((project) => (
                 <div
                   key={project.id}
                   className={`project-tab ${project.id === activeProjectId ? 'active' : ''}`}
                   onClick={() => handleProjectSelect(project)}
                   style={{ '--tab-color': project.color } as React.CSSProperties}
                 >
                    <span className="tab-icon">{project.emoji}</span>
                    <span className="tab-title">{project.title}</span>
                 </div>
               ))}
             </div>
          </div>

          <div className="app-terminal-bar">
            <div className="tabs-container">
              {currentProjectSessions.map((s: SessionState) => (
                <div key={s.id} className={`tab ${s.id === selectedSessionId ? 'active' : ''}`} onClick={() => setSelectedSessionId(s.id)}>
                  <span className="tab-icon">{s.emoji}</span>
                  <span className="tab-title">{s.title}</span>
                  {s.exitCode !== null && <span className="tab-status">Exited</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="terminal-area">
            {Object.keys(sessions).length === 0 && <div className="empty-state">No active sessions</div>}
            <div
              className="terminal-scroll-region"
              ref={scrollRegionRef}
              style={terminalScrollRegionStyle}
              onPointerCancelCapture={handleTerminalPointerUpCapture}
              onPointerDownCapture={handleTerminalPointerDownCapture}
              onPointerMoveCapture={handleTerminalPointerMoveCapture}
              onPointerUpCapture={handleTerminalPointerUpCapture}
            >
              <div className="terminal-zoom-shell" style={terminalZoomShellStyle}>
                <div
                  className="terminal-xterm-container"
                  ref={xtermContainerRef}
                  style={terminalSurfaceStyle}
                />
              </div>
            </div>
          </div>

          {showAccessoryBar ? (
            <div className="terminal-accessory-shell">
              <div className="terminal-accessory-bar">
                <button
                  type="button"
                  className="terminal-accessory-button terminal-accessory-button--zoom"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => stepTerminalZoom(-0.1)}
                >
                  -
                </button>
                <button
                  type="button"
                  className="terminal-accessory-button terminal-accessory-button--zoom"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => stepTerminalZoom(0.1)}
                >
                  +
                </button>
                {ACCESSORY_ACTIONS.map((action) => {
                  const isActive =
                    action.kind === 'toggle-modifier'
                      ? (action.modifier === 'ctrl' ? pendingCtrl : pendingAlt)
                      : false

                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={`terminal-accessory-button ${isActive ? 'active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleAccessoryAction(action)}
                    >
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {showSettings && (
            <div className="overlay-container" onClick={() => setShowSettings(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Terminal Settings</h2>
                  <button className="button-ghost" onClick={() => setShowSettings(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="settings-list">
                    <div className="setting-item">
                      <label htmlFor="remote-font-size">Font Size</label>
                      <input id="remote-font-size" type="number" value={settings.fontSize} onChange={e => setSettings(s => ({ ...s, fontSize: Number(e.target.value) }))} />
                    </div>
                    <div className="setting-item">
                      <label htmlFor="remote-line-height">Line Height</label>
                      <input id="remote-line-height" type="number" step="0.05" value={settings.lineHeight} onChange={e => setSettings(s => ({ ...s, lineHeight: Number(e.target.value) }))} />
                    </div>
                    <div className="setting-item">
                      <label htmlFor="remote-theme">Theme</label>
                      <select
                        id="remote-theme"
                        value={settings.theme}
                        onChange={e => setSettings(s => ({ ...s, theme: e.target.value as RemoteSettings['theme'] }))}
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="vscode">VS Code</option>
                      </select>
                    </div>
                    <div className="setting-item">
                      <label htmlFor="remote-cursor-blink">Cursor Blink</label>
                      <select id="remote-cursor-blink" value={settings.cursorBlink ? 'on' : 'off'} onChange={e => setSettings(s => ({ ...s, cursorBlink: e.target.value === 'on' }))}>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="button-primary" onClick={() => setShowSettings(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </>
  )
}
