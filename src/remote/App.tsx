import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Terminal } from '@xterm/xterm'
import type { RemoteServerMessage, RemoteSessionSummary } from './protocol'
import { authenticateDevice, pairDevice } from './services/auth'
import {
  generateDeviceKeyPair,
  loadPairing,
  removePairing,
  savePairing,
} from './services/deviceKeys'
import { parsePairingBootstrap } from './services/pairing'
import { RemoteSocket } from './services/socket'
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

type BarcodeDetectorResult = {
  rawValue?: string
}

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance

const DEFAULT_SETTINGS: RemoteSettings = {
  fontSize: 13,
  lineHeight: 1.25,
  fontFamily: '"SF Mono", "Cascadia Code", Menlo, Monaco, monospace',
  cursorBlink: true,
  theme: 'dark'
}

const THEMES = {
  dark: { background: '#000000', foreground: '#ffffff', cursor: '#ffffff' },
  light: { background: '#ffffff', foreground: '#000000', cursor: '#000000' },
  vscode: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#ffffff' }
}

const defaultPairingInput = `${window.location.origin}?pairingSessionId=...`
const PAIRING_QUERY_KEYS = ['pairingSessionId', 'pairingToken', 'pairingExpiresAt'] as const

function getInitialPairingInput(): string {
  return window.location.href.includes('pairingToken=') ? window.location.href : ''
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

type TerminalSurfaceSize = {
  width: number
  height: number
}

type AccessoryAction =
  | { id: string; kind: 'toggle-modifier'; label: string; modifier: 'ctrl' | 'alt' }
  | { id: string; kind: 'scrollback'; label: string; mode: 'page-up' | 'page-down' | 'top' | 'bottom' }
  | { id: string; kind: 'send'; label: string; payload: string; useModifiers?: boolean }

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
  return 'Termide Remote Browser'
}

export function RemoteApp() {
  // --- UI State ---
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<RemoteSettings>(() => {
    const saved = localStorage.getItem('termide-remote-settings')
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
  })

  // --- Connection State ---
  const [pairingInput, setPairingInput] = useState(() => getInitialPairingInput())
  const [deviceName, setDeviceName] = useState(getDefaultDeviceName())
  const [pairingState, setPairingState] = useState<'checking' | 'needs-pairing' | 'paired'>('checking')
  const [statusText, setStatusText] = useState('Checking this browser…')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'live'>('idle')
  const [connectionCount, setConnectionCount] = useState(0)
  const [sessions, setSessions] = useState<Record<string, SessionState>>({})
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [terminalSurfaceSize, setTerminalSurfaceSize] = useState<TerminalSurfaceSize | null>(null)
  const [showQrScanner, setShowQrScanner] = useState(false)
  const [hasTouchAccessory, setHasTouchAccessory] = useState(false)
  const [pendingCtrl, setPendingCtrl] = useState(false)
  const [pendingAlt, setPendingAlt] = useState(false)
  const [terminalZoom, setTerminalZoom] = useState(1)

  // --- Refs ---
  const socketRef = useRef<RemoteSocket | null>(null)
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const xtermContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<Record<string, SessionState>>({})
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrScanRef = useRef<{ stream: MediaStream; frame: number } | null>(null)
  const pendingCtrlRef = useRef(false)
  const pendingAltRef = useRef(false)
  const pointerPanStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)

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

  const stopQrScanner = useCallback(() => {
    if (qrScanRef.current) {
      cancelAnimationFrame(qrScanRef.current.frame)
      qrScanRef.current.stream.getTracks().forEach((track) => {
        track.stop()
      })
      qrScanRef.current = null
    }
    setShowQrScanner(false)
  }, [])

  // Start the camera AFTER the overlay is rendered (so qrVideoRef.current is guaranteed non-null)
  useEffect(() => {
    if (!showQrScanner) return

    let cancelled = false

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => {
            track.stop()
          })
          return
        }
        const video = qrVideoRef.current
        if (!video) {
          stream.getTracks().forEach((track) => {
            track.stop()
          })
          return
        }

        video.srcObject = stream
        await video.play()

        const detectorCtor = 'BarcodeDetector' in window
          ? (window as Window & { BarcodeDetector: BarcodeDetectorConstructor }).BarcodeDetector
          : null
        const detector = detectorCtor ? new detectorCtor({ formats: ['qr_code'] }) : null
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        const tick = async () => {
          if (!qrScanRef.current || !video.videoWidth) {
            if (qrScanRef.current) qrScanRef.current = { stream, frame: requestAnimationFrame(tick) }
            return
          }
          let result: string | null = null
          try {
            if (detector) {
              const results = await detector.detect(video)
              if (results.length > 0) result = results[0].rawValue ?? null
            } else {
              canvas.width = video.videoWidth
              canvas.height = video.videoHeight
              ctx?.drawImage(video, 0, 0)
              const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height)
              if (imageData) {
                const code = jsQR(imageData.data, imageData.width, imageData.height)
                if (code) result = code.data
              }
            }
          } catch { /* frame not ready */ }

          if (result) {
            stopQrScanner()
            setPairingInput(result)
            return
          }
          if (qrScanRef.current) qrScanRef.current = { stream, frame: requestAnimationFrame(tick) }
        }
        qrScanRef.current = { stream, frame: requestAnimationFrame(tick) }
      } catch (err) {
        if (!cancelled) {
          console.error('[QR] Camera error:', err)
          stopQrScanner()
          setErrorText('Could not access camera. Please grant camera permission and try again.')
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
    }
  }, [showQrScanner, stopQrScanner])

  const startQrScanner = useCallback(() => {
    setShowQrScanner(true)
  }, [])

  const syncTerminalSurfaceSize = useCallback(() => {
    const container = xtermContainerRef.current
    const terminal = terminalRef.current
    if (!container || !terminal) return

    window.requestAnimationFrame(() => {
      const canvasNodes = terminal.element?.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas') ?? []
      const contentWidth = Array.from(canvasNodes).reduce((maxWidth, canvas) => Math.max(maxWidth, canvas.offsetWidth), 0)
      const contentHeight = Array.from(canvasNodes).reduce((maxHeight, canvas) => Math.max(maxHeight, canvas.offsetHeight), 0)
      // Use measured canvas dimensions directly so the container stays exactly the
      // canvas size. Falling back to the current container size only when the
      // canvas hasn't rendered yet (contentWidth/Height === 0).
      const nextWidth = contentWidth || container.clientWidth
      const nextHeight = contentHeight || container.clientHeight

      setTerminalSurfaceSize((current) => {
        if (current && current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    })
  }, [])

  const syncTerminalToSession = useCallback((sessionId: string | null) => {
    const terminal = terminalRef.current
    if (!terminal || !sessionId) return

    const session = sessionsRef.current[sessionId]
    if (!session) return

    const cols = Math.max(2, Math.floor(session.cols))
    const rows = Math.max(1, Math.floor(session.rows))
    if (terminal.cols !== cols || terminal.rows !== rows) {
      terminal.resize(cols, rows)
    }
    syncTerminalSurfaceSize()
  }, [syncTerminalSurfaceSize])

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
    syncTerminalToSession(sessionId)
    terminal.write(buffer, () => {
      syncTerminalSurfaceSize()
    })
  }, [syncTerminalSurfaceSize, syncTerminalToSession])

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])
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

  // Save settings
  useEffect(() => {
    localStorage.setItem('termide-remote-settings', JSON.stringify(settings))
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = settings.fontSize
      terminalRef.current.options.lineHeight = settings.lineHeight
      terminalRef.current.options.fontFamily = settings.fontFamily
      terminalRef.current.options.cursorBlink = settings.cursorBlink
      terminalRef.current.options.theme = THEMES[settings.theme]
      syncTerminalToSession(selectedSessionIdRef.current)
    }
  }, [settings, syncTerminalToSession])

  const sendAttachForSession = useCallback((sessionId: string) => {
    const socket = socketRef.current
    if (!socket) return
    socket.send({ sessionId, type: 'attach-session' })
  }, [])

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
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      theme: THEMES[settings.theme],
      allowTransparency: true,
      scrollback: 5000,
    })
    terminal.open(container)

    terminalRef.current = terminal
    renderSessionBuffer(selectedSessionIdRef.current)
    syncTerminalSurfaceSize()

    const dataDisposer = terminal.onData((data) => {
      sendTerminalPayload(data)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return
      syncTerminalToSession(selectedSessionIdRef.current)
    })
    resizeObserver.observe(container)

    return () => {
      dataDisposer.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [pairingState, renderSessionBuffer, sendTerminalPayload, settings, syncTerminalSurfaceSize, syncTerminalToSession])

  // Sync terminal content on session change
  useEffect(() => {
    renderSessionBuffer(selectedSessionId)
  }, [renderSessionBuffer, selectedSessionId])

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
        const pairing = await loadPairing(window.location.origin)
        if (!pairing) {
          setPairingState('needs-pairing')
          setStatusText('Pair this browser to your Termide host.')
          return
        }
        setDeviceName(pairing.deviceName)
        setPairingState('paired')
        setStatusText(`Paired as ${pairing.deviceName}.`)
      } catch (error) {
        setPairingState('needs-pairing')
        setErrorText(error instanceof Error ? error.message : 'Unable to initialize.')
      }
    })()
  }, [])

  const handleServerMessage = useCallback((message: RemoteServerMessage): void => {
    switch (message.type) {
      case 'session-list': {
        const nextId = (selectedSessionIdRef.current && message.sessions.some(s => s.id === selectedSessionIdRef.current))
          ? selectedSessionIdRef.current
          : (message.sessions[0]?.id ?? null)

        const nextSessions = Object.fromEntries(
          message.sessions.map((s) => [s.id, { ...s, buffer: sessionsRef.current[s.id]?.buffer ?? '' }]),
        )
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        setConnectionCount(message.connectionCount)
        setSelectedSessionId(nextId)
        if (nextId) sendAttachForSession(nextId)
        syncTerminalToSession(nextId)
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
        if (message.session.id === selectedSessionIdRef.current) {
          syncTerminalToSession(message.session.id)
        }
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
  }, [renderSessionBuffer, sendAttachForSession, syncTerminalToSession])

  useEffect(() => {
    if (pairingState !== 'paired') return
    void reconnectNonce
    let cancelled = false
    clearReconnectTimer()
    void (async () => {
      try {
        const pairing = await loadPairing(window.location.origin)
        if (!pairing || cancelled) return
        setConnectionState('connecting')
        setErrorText(null)
        const authenticated = await authenticateDevice({ deviceId: pairing.deviceId, privateKey: pairing.privateKey })
        if (cancelled) return
        const socket = new RemoteSocket(authenticated.websocketUrl, handleServerMessage, state => {
          setConnectionState(state === 'closed' ? 'idle' : state)
          if (state === 'closed') { socketRef.current = null; if (!cancelled) scheduleReconnect() }
        })
        socketRef.current = socket
        await socket.connect()
      } catch (error) {
        setConnectionState('idle')
        setErrorText(error instanceof Error ? error.message : 'Auth failed.')
        if (!cancelled) scheduleReconnect()
      }
    })()
    return () => { cancelled = true; clearReconnectTimer(); socketRef.current?.close() }
  }, [pairingState, reconnectNonce, handleServerMessage, clearReconnectTimer, scheduleReconnect])

  // --- Grouping Logic ---
  const projects = useMemo(() => {
    const map = new Map<string, ProjectState>()
    Object.values(sessions).forEach((s: SessionState) => {
      const pid = s.projectId || 'default'
      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          title: s.projectTitle || 'Default',
          emoji: s.projectEmoji || '🖥️',
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
      if (session?.projectId && session.projectId !== activeProjectId) {
        setActiveProjectId(session.projectId)
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
      const bootstrap = parsePairingBootstrap(pairingInput)
      const keyPair = await generateDeviceKeyPair()
      const paired = await pairDevice({ bootstrap, deviceName, publicKeyPem: keyPair.publicKeyPem })
      await savePairing({ deviceId: paired.deviceId, deviceName: paired.deviceName, origin: window.location.origin, privateKey: keyPair.privateKey, publicKeyPem: keyPair.publicKeyPem })
      setPairingState('paired'); window.history.replaceState({}, document.title, window.location.pathname)
    } catch (err) { setErrorText(err instanceof Error ? err.message : 'Pairing failed.') }
  }

  async function handleForget() {
    clearReconnectTimer(); socketRef.current?.close(); await removePairing(window.location.origin)
    setSessions({}); setSelectedSessionId(null); setActiveProjectId(null); setPairingState('needs-pairing'); setConnectionState('idle')
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

  const terminalSurfaceStyle = useMemo(() => {
    // Keep the browser terminal sized from its own rendered canvas instead of
    // borrowing the host window's pixel dimensions, which can be much taller
    // and trigger unwanted browser scrolling to xterm's hidden textarea.
    const width = terminalSurfaceSize?.width || 0
    const height = terminalSurfaceSize?.height || 0
    const visibility = Object.keys(sessions).length > 0 ? ('visible' as const) : ('hidden' as const)

    return {
      height: height ? `${height}px` : '100%',
      visibility,
      width: width ? `${width}px` : '100%',
    }
  }, [sessions, terminalSurfaceSize])

  const terminalZoomShellStyle = useMemo(() => {
    const width = terminalSurfaceSize?.width || 0
    const height = terminalSurfaceSize?.height || 0
    const visibility = Object.keys(sessions).length > 0 ? ('visible' as const) : ('hidden' as const)

    return {
      height: height ? `${height * terminalZoom}px` : '100%',
      visibility,
      width: width ? `${width * terminalZoom}px` : '100%',
    }
  }, [sessions, terminalSurfaceSize, terminalZoom])

  const terminalScrollRegionStyle = useMemo(() => {
    if (!showAccessoryBar) {
      return undefined
    }

    return {
      bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
    }
  }, [showAccessoryBar])

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
      {showQrScanner && (
        <div className="qr-scanner-overlay">
          <div className="qr-scanner-header">
            <span>Scan Pairing QR Code</span>
            <button className="button-ghost" onClick={stopQrScanner}>✕</button>
          </div>
          <div className="qr-scanner-viewport">
            <video ref={qrVideoRef} className="qr-scanner-video" playsInline muted />
            <div className="qr-scanner-frame" />
          </div>
          <p className="qr-scanner-hint">Point your camera at the QR code shown in Termide</p>
        </div>
      )}
      {errorText && (
        <div className="error-banner">
          <span>{errorText}</span>
          <button className="button-ghost" style={{ color: 'white' }} onClick={() => setErrorText(null)}>✕</button>
        </div>
      )}
      {pairingState !== 'paired' ? (
        <div className="pairing-screen">
          <div className="pairing-box">
            <h1>Termide Remote</h1>
            <p className="status">{statusText}</p>
            <form className="pairing-form" onSubmit={handlePair}>
              <div className="form-group">
                <label htmlFor="device-name">Device Name</label>
                <input id="device-name" value={deviceName} onChange={e => setDeviceName(e.target.value)} />
              </div>
              <div className="form-group">
                <div className="form-label-row">
                  <label htmlFor="pairing-link">Pairing Link</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="text-button" onClick={startQrScanner}>📷 Scan QR</button>
                    <button type="button" className="text-button" onClick={() => navigator.clipboard.readText().then(t => t.includes('pairingToken=') && setPairingInput(t)).catch(()=>{})}>Paste</button>
                  </div>
                </div>
                <textarea id="pairing-link" value={pairingInput} onChange={e => setPairingInput(e.target.value)} placeholder={defaultPairingInput} />
              </div>
              <button type="submit" className="pair-button" disabled={!pairingInput.trim()}>Pair Device</button>
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
            <div className="app-menu">
              <div className="menu-item" onClick={() => terminalRef.current?.focus()}>Focus</div>
              <div className="menu-item" onClick={handleClear}>Clear</div>
              <div className="menu-item" onClick={handleReset}>Reset</div>
              <div className="menu-item" onClick={() => setShowSettings(true)}>Settings</div>
              <div className="menu-item" onClick={handleForget}>Disconnect</div>
            </div>
          </div>

          <div className="app-project-bar">
             <div className="project-tabs">
               {projects.map((project) => (
                 <div
                   key={project.id}
                   className={`project-tab ${project.id === activeProjectId ? 'active' : ''}`}
                   onClick={() => setActiveProjectId(project.id)}
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
                  style={{ ...terminalSurfaceStyle, zoom: terminalZoom }}
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
