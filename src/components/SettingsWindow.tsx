import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import {
  buildTerminalOptions,
  defaultTerminalSettings,
  getTerminalThemeColorFallback,
  TAB_THEME_HUE_COLOR_VALUE,
  terminalSettingsCategories,
  terminalSettingsSections,
} from '../terminalSettings'
import type { SettingsFieldDefinition } from '../terminalSettings'
import {
  acceleratorFromKeyboardEvent,
  defaultKeyboardShortcuts,
  getCommandShortcutLabel,
  normalizeAccelerator,
} from '../keyboardShortcuts'
import {
  isRemoteAccessPairingPinConfigured,
  PAIRING_PIN_PATTERN,
  saveRemoteAccessPairingPin,
} from '../remotePairingPin'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalSettings } from '../types/settings'
import type { AppCommand } from '../types/terminay'
import type { RemoteAccessStatus } from '../types/terminay'
import '../settings.css'

type CategoryId = (typeof terminalSettingsCategories)[number]['id']
type AiModelOption = { id: string; label: string }

function getValueAtPath(settings: TerminalSettings, key: string): boolean | number | string {
  const segments = key.split('.')
  let current: unknown = settings

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return ''
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'boolean' || typeof current === 'number' || typeof current === 'string' ? current : ''
}

function getDefaultValueAtPath(key: string): boolean | number | string {
  return getValueAtPath(defaultTerminalSettings, key)
}

function setValueAtPath(settings: TerminalSettings, key: string, value: boolean | number | string): TerminalSettings {
  const segments = key.split('.')
  const allowedRoots = new Set(['aiTabMetadata', 'keyboardShortcuts', 'recording', 'remoteAccess', 'shell', 'theme'])
  const [root] = segments

  if (!root || (segments.length > 1 && !allowedRoots.has(root))) {
    return settings
  }

  const setNestedValue = (current: unknown, remainingSegments: string[]): unknown => {
    const [segment, ...rest] = remainingSegments
    if (!segment) {
      return value
    }

    if (rest.length === 0) {
      return {
        ...(typeof current === 'object' && current !== null ? current : {}),
        [segment]: value,
      }
    }

    const currentObject = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {}
    return {
      ...currentObject,
      [segment]: setNestedValue(currentObject[segment], rest),
    }
  }

  return setNestedValue(settings, segments) as TerminalSettings
}

function formatReconnectGrantSummary(device: {
  reconnectGrantExpiresAt?: string | null
  reconnectGrantLastUsedAt?: string | null
  reconnectGrantStatus?: 'none' | 'valid' | 'expired' | 'revoked'
}): string {
  const status = device.reconnectGrantStatus ?? 'none'
  if (status === 'none') {
    return 'Saved reconnect not issued'
  }
  if (status === 'revoked') {
    return 'Saved reconnect revoked'
  }
  if (status === 'expired') {
    return 'Saved reconnect expired'
  }

  const expiry = device.reconnectGrantExpiresAt
    ? `expires ${new Date(device.reconnectGrantExpiresAt).toLocaleString()}`
    : 'valid until revoked'
  const lastUsed = device.reconnectGrantLastUsedAt
    ? ` · Last reconnect ${new Date(device.reconnectGrantLastUsedAt).toLocaleString()}`
    : ''
  return `Saved reconnect ${expiry}${lastUsed}`
}

function TerminalPreview({ settings }: { settings: TerminalSettings }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = containerRef.current
    if (!root) {
      return
    }

    root.innerHTML = ''

    const terminal = new Terminal({
      ...buildTerminalOptions(settings),
      cols: 72,
      rows: 18,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'
    terminal.open(root)
    fitAddon.fit()

    terminal.writeln('\x1b[1;36mTerminay Settings Preview\x1b[0m')
    terminal.writeln('\x1b[90mPreview updates in real-time.\x1b[0m')
    terminal.writeln('')
    terminal.writeln(`$ echo "Font: ${settings.fontFamily}"`)
    terminal.writeln(`Font: ${settings.fontFamily}`)
    terminal.writeln('')
    terminal.writeln('\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m \x1b[33myellow\x1b[0m \x1b[34mblue\x1b[0m \x1b[35mmagenta\x1b[0m \x1b[36mcyan\x1b[0m')
    terminal.write('$ ')
    terminal.focus()

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(root)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [settings])

  return <div className="settings-preview-terminal" ref={containerRef} />
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (val: boolean) => void; label: string }) {
  return (
    <label className="settings-switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-slider"></span>
    </label>
  )
}

function renderCategoryIcon(title: string, children: ReactNode) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" role="img">
      <title>{title}</title>
      {children}
    </svg>
  )
}

function getCategoryIcon(id: CategoryId) {
  switch (id) {
    case 'remote': return renderCategoryIcon('Remote Access', <><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="16" r="1.4"/><path d="M12 17.5v2.5"/></>)
    case 'recording': return renderCategoryIcon('Recording', <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M5 19l14-14"/></>)
    case 'ai': return renderCategoryIcon('AI', <><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/><path d="M5 14l.7 1.6L7 16l-1.3.4L5 18l-.7-1.6L3 16l1.3-.4z"/></>)
    case 'shell': return renderCategoryIcon('Shell', <><path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 7l3-3h10l3 3"/><path d="m9 12 2 2-2 2"/><line x1="13.5" y1="16" x2="16.5" y2="16"/></>)
    case 'appearance': return renderCategoryIcon('Appearance', <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></>)
    case 'cursor': return renderCategoryIcon('Cursor', <path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>)
    case 'interaction': return renderCategoryIcon('Interaction', <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></>)
    case 'keyboard': return renderCategoryIcon('Shortcuts', <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M17 13h.01M13 13H7"/></>)
    case 'scrolling': return renderCategoryIcon('Scrolling', <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>)
    case 'accessibility': return renderCategoryIcon('Accessibility', <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></>)
    case 'theme': return renderCategoryIcon('Theme', <><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></>)
    default: return renderCategoryIcon('Category', <circle cx="12" cy="12" r="10"/>)
  }
}

export function SettingsWindow() {
  const searchParams = new URLSearchParams(window.location.search)
  const initialSectionFromUrl = searchParams.get('section')
  const initialCategoryFromUrl =
    terminalSettingsSections.find((section) => section.id === initialSectionFromUrl)?.categoryId ?? 'appearance'
  const { settings: persistedSettings, isLoading } = useTerminalSettings()
  const [draft, setDraft] = useState<TerminalSettings>(defaultTerminalSettings)
  const draftRef = useRef<TerminalSettings>(defaultTerminalSettings)
  const [activeCategoryId, setActiveCategoryId] = useState<CategoryId>(initialCategoryFromUrl)
  const [activeSectionId, setActiveSectionId] = useState<string>(
    () =>
      initialSectionFromUrl ??
      terminalSettingsSections.find((section) => section.categoryId === initialCategoryFromUrl)?.id ??
      terminalSettingsSections[0]?.id ??
      '',
  )
  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewHeight, setPreviewHeight] = useState(240)
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null)
  const [remoteActionError, setRemoteActionError] = useState<string | null>(null)
  const [selectedRemotePairingMode, setSelectedRemotePairingMode] = useState<'lan' | 'webrtc'>('lan')
  const [isTogglingRemoteAccess, setIsTogglingRemoteAccess] = useState(false)
  const [isPairingPinModalOpen, setIsPairingPinModalOpen] = useState(false)
  const [pairingPinInput, setPairingPinInput] = useState('')
  const [pairingPinError, setPairingPinError] = useState<string | null>(null)
  const [isSavingPairingPin, setIsSavingPairingPin] = useState(false)
  const [isLinkCopied, setIsLinkCopied] = useState(false)
  const [isUpdatingRemoteDevices, setIsUpdatingRemoteDevices] = useState(false)
  const [listeningShortcutKey, setListeningShortcutKey] = useState<string | null>(null)
  const [codexModels, setCodexModels] = useState<AiModelOption[]>([])
  const [isLoadingCodexModels, setIsLoadingCodexModels] = useState(false)
  const [codexModelsError, setCodexModelsError] = useState<string | null>(null)
  const [claudeCodeModels, setClaudeCodeModels] = useState<AiModelOption[]>([])
  const [isLoadingClaudeCodeModels, setIsLoadingClaudeCodeModels] = useState(false)
  const [claudeCodeModelsError, setClaudeCodeModelsError] = useState<string | null>(null)

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = previewHeight

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startY - moveEvent.clientY
      setPreviewHeight(Math.max(100, Math.min(800, startHeight + delta)))
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const contentRef = useRef<HTMLDivElement>(null)
  const pairingPinRequestRef = useRef<((configured: boolean) => void) | null>(null)

  useEffect(() => {
    setDraft(persistedSettings)
    draftRef.current = persistedSettings
  }, [persistedSettings])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    let isMounted = true

    void window.terminay.getRemoteAccessStatus().then((status) => {
      if (isMounted) {
        setRemoteStatus(status)
      }
    })

    const unsubscribe = window.terminay.onRemoteAccessStatusChanged((status) => {
      setRemoteStatus(status)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    setSelectedRemotePairingMode(remoteStatus?.pairingMode ?? draft.remoteAccess.pairingMode)
  }, [remoteStatus?.pairingMode, draft.remoteAccess.pairingMode])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredSections = useMemo(() => {
    return terminalSettingsSections.filter((section) => {
      const sectionMatches =
        section.title.toLowerCase().includes(normalizedQuery) || section.description.toLowerCase().includes(normalizedQuery)

      const fieldMatches = section.fields.some((field) => {
        const keywords = field.keywords?.join(' ').toLowerCase() ?? ''
        return (
          field.label.toLowerCase().includes(normalizedQuery) ||
          field.description.toLowerCase().includes(normalizedQuery) ||
          field.key.toLowerCase().includes(normalizedQuery) ||
          keywords.includes(normalizedQuery)
        )
      })

      return !normalizedQuery || sectionMatches || fieldMatches
    })
  }, [normalizedQuery])

  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return terminalSettingsCategories
    const categoryIds = new Set(filteredSections.map((section) => section.categoryId))
    return terminalSettingsCategories.filter((category) => categoryIds.has(category.id))
  }, [filteredSections, normalizedQuery])

  const displayedCategories = useMemo(() => {
    if (normalizedQuery) {
      return visibleCategories
    }

    return visibleCategories.filter((category) => category.id === activeCategoryId)
  }, [activeCategoryId, normalizedQuery, visibleCategories])

  useEffect(() => {
    const eligibleSections = normalizedQuery
      ? filteredSections
      : filteredSections.filter((section) => section.categoryId === activeCategoryId)

    if (eligibleSections.some((section) => section.id === activeSectionId)) {
      return
    }

    setActiveSectionId(eligibleSections[0]?.id ?? '')
  }, [activeCategoryId, activeSectionId, filteredSections, normalizedQuery])

  useEffect(() => {
    const unsubscribe = window.terminay.onSettingsFocusSection(({ sectionId }) => {
      const section = terminalSettingsSections.find((candidate) => candidate.id === sectionId)
      if (!section) {
        return
      }

      setActiveCategoryId(section.categoryId)
      setActiveSectionId(section.id)
      window.requestAnimationFrame(() => {
        const element = document.getElementById(`section-${section.id}`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const root = contentRef.current
    if (!root) {
      return
    }

    const visibleSectionIds = displayedCategories.flatMap((category) =>
      filteredSections.filter((section) => section.categoryId === category.id).map((section) => section.id),
    )
    const sectionElements = visibleSectionIds
      .map((id) => document.getElementById(`section-${id}`))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)

    if (sectionElements.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            if (b.intersectionRatio !== a.intersectionRatio) {
              return b.intersectionRatio - a.intersectionRatio
            }

            return a.boundingClientRect.top - b.boundingClientRect.top
          })

        const nextEntry = visibleEntries[0]
        if (!nextEntry) {
          return
        }

        const nextSectionId = nextEntry.target.id.replace(/^section-/, '')
        const nextCategoryId = terminalSettingsSections.find((section) => section.id === nextSectionId)?.categoryId

        setActiveSectionId((current) => (current === nextSectionId ? current : nextSectionId))
        if (nextCategoryId) {
          setActiveCategoryId((current) => (current === nextCategoryId ? current : nextCategoryId))
        }
      },
      {
        root,
        rootMargin: '0px 0px -55% 0px',
        threshold: [0.1, 0.25, 0.5, 0.75, 1],
      },
    )

    sectionElements.forEach((element) => {
      observer.observe(element)
    })

    return () => {
      observer.disconnect()
    }
  }, [displayedCategories, filteredSections])

  const saveDraft = useCallback(async (nextDraft: TerminalSettings) => {
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setIsSaving(true)

    try {
      const saved = await window.terminay.updateTerminalSettings(nextDraft)
      draftRef.current = saved
      setDraft(saved)
    } finally {
      setIsSaving(false)
    }
  }, [])

  const updateField = async (field: SettingsFieldDefinition, rawValue: boolean | number | string) => {
    const nextDraft = setValueAtPath(draftRef.current, field.key, rawValue)
    await saveDraft(nextDraft)
  }

  const updateShortcut = useCallback(async (key: string, value: string) => {
    const normalizedValue = value.trim().length === 0 ? '' : normalizeAccelerator(value)
    const nextDraft = setValueAtPath(draftRef.current, key, normalizedValue)
    await saveDraft(nextDraft)
  }, [saveDraft])

  const resetShortcut = (field: SettingsFieldDefinition) => {
    const command = field.key.replace('keyboardShortcuts.', '') as AppCommand
    void updateShortcut(field.key, defaultKeyboardShortcuts[command] ?? '')
  }

  const resetAllShortcuts = async () => {
    const nextDraft: TerminalSettings = {
      ...draftRef.current,
      keyboardShortcuts: defaultKeyboardShortcuts,
    }
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setListeningShortcutKey(null)
    setIsSaving(true)

    try {
      const saved = await window.terminay.updateTerminalSettings(nextDraft)
      draftRef.current = saved
      setDraft(saved)
    } finally {
      setIsSaving(false)
    }
  }

  const resetAll = async () => {
    if (!confirm('Are you sure you want to reset all settings to default?')) return
    setIsSaving(true)
    try {
      const saved = await window.terminay.resetTerminalSettings()
      draftRef.current = saved
      setDraft(saved)
      setQuery('')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const shouldLoadCodexModels =
      draft.aiTabMetadata.title.provider === 'codex' || draft.aiTabMetadata.note.provider === 'codex'

    if (!shouldLoadCodexModels || codexModels.length > 0) {
      return
    }

    let isCurrent = true
    setIsLoadingCodexModels(true)
    setCodexModelsError(null)

    void window.terminay.listAiTabMetadataModels('codex')
      .then((models) => {
        if (!isCurrent) {
          return
        }

        setCodexModels(models)
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setCodexModelsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingCodexModels(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [
    codexModels.length,
    draft.aiTabMetadata.note.provider,
    draft.aiTabMetadata.title.provider,
  ])

  useEffect(() => {
    const shouldLoadClaudeCodeModels =
      draft.aiTabMetadata.title.provider === 'claudeCode' || draft.aiTabMetadata.note.provider === 'claudeCode'

    if (!shouldLoadClaudeCodeModels || claudeCodeModels.length > 0) {
      return
    }

    let isCurrent = true
    setIsLoadingClaudeCodeModels(true)
    setClaudeCodeModelsError(null)

    void window.terminay.listAiTabMetadataModels('claudeCode')
      .then((models) => {
        if (!isCurrent) {
          return
        }

        setClaudeCodeModels(models)
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        setClaudeCodeModelsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingClaudeCodeModels(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [
    claudeCodeModels.length,
    draft.aiTabMetadata.note.provider,
    draft.aiTabMetadata.title.provider,
  ])

  useEffect(() => {
    const firstModel = codexModels[0]?.id
    if (!firstModel) {
      return
    }

    const current = draftRef.current
    let nextDraft = current

    if (current.aiTabMetadata.title.provider === 'codex' && current.aiTabMetadata.title.codexModel.length === 0) {
      nextDraft = setValueAtPath(nextDraft, 'aiTabMetadata.title.codexModel', firstModel)
    }

    if (current.aiTabMetadata.note.provider === 'codex' && current.aiTabMetadata.note.codexModel.length === 0) {
      nextDraft = setValueAtPath(nextDraft, 'aiTabMetadata.note.codexModel', firstModel)
    }

    if (nextDraft !== current) {
      void saveDraft(nextDraft)
    }
  }, [codexModels, saveDraft])

  useEffect(() => {
    const firstModel = claudeCodeModels[0]?.id
    if (!firstModel) {
      return
    }

    const current = draftRef.current
    let nextDraft = current

    if (
      current.aiTabMetadata.title.provider === 'claudeCode' &&
      current.aiTabMetadata.title.claudeCodeModel.length === 0
    ) {
      nextDraft = setValueAtPath(nextDraft, 'aiTabMetadata.title.claudeCodeModel', firstModel)
    }

    if (
      current.aiTabMetadata.note.provider === 'claudeCode' &&
      current.aiTabMetadata.note.claudeCodeModel.length === 0
    ) {
      nextDraft = setValueAtPath(nextDraft, 'aiTabMetadata.note.claudeCodeModel', firstModel)
    }

    if (nextDraft !== current) {
      void saveDraft(nextDraft)
    }
  }, [claudeCodeModels, saveDraft])


  const scrollToSection = (id: string) => {
    const el = document.getElementById(`section-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const isFieldVisible = (field: SettingsFieldDefinition) => {
    if (!field.visibleWhen) {
      return true
    }

    return getValueAtPath(draft, field.visibleWhen.key) === field.visibleWhen.value
  }

  const renderCodexModelControl = (field: SettingsFieldDefinition, value: boolean | number | string) => {
    if (isLoadingCodexModels) {
      return <span className="settings-row-description">Loading Codex models...</span>
    }

    if (codexModelsError) {
      return <span className="settings-shortcut-warning">{codexModelsError}</span>
    }

    if (codexModels.length === 0) {
      return <span className="settings-shortcut-warning">No Codex models are available.</span>
    }

    return (
      <select className="settings-select" value={String(value)} onChange={(e) => void updateField(field, e.target.value)}>
        {codexModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    )
  }

  const renderClaudeCodeModelControl = (field: SettingsFieldDefinition, value: boolean | number | string) => {
    if (isLoadingClaudeCodeModels) {
      return <span className="settings-row-description">Loading Claude Code models...</span>
    }

    if (claudeCodeModelsError) {
      return <span className="settings-shortcut-warning">{claudeCodeModelsError}</span>
    }

    if (claudeCodeModels.length === 0) {
      return <span className="settings-shortcut-warning">No Claude Code models are available.</span>
    }

    return (
      <select className="settings-select" value={String(value)} onChange={(e) => void updateField(field, e.target.value)}>
        {claudeCodeModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    )
  }

  const renderFieldControl = (field: SettingsFieldDefinition) => {
    const value = getValueAtPath(draft, field.key)

    if (field.key.startsWith('keyboardShortcuts.')) {
      const command = field.key.replace('keyboardShortcuts.', '') as AppCommand
      const normalizedValue = normalizeAccelerator(String(value))
      const isDefault = normalizedValue === defaultKeyboardShortcuts[command]
      const displayValue = normalizedValue
        ? getCommandShortcutLabel(draft.keyboardShortcuts, command, navigator.platform.toLowerCase().includes('mac'))
        : 'Disabled'
      const conflict = normalizedValue
        ? Object.entries(draft.keyboardShortcuts).find(
            ([otherCommand, otherValue]) =>
              otherCommand !== command && normalizeAccelerator(otherValue) === normalizedValue,
          )
        : null

      return (
        <div className="settings-shortcut-editor">
          <div className="settings-shortcut-value">
            <input
              className="settings-input-text settings-shortcut-input"
              type="text"
              value={listeningShortcutKey === field.key ? 'Listening...' : String(value)}
              placeholder={field.placeholder}
              onFocus={() => {
                if (listeningShortcutKey !== field.key) {
                  setListeningShortcutKey(field.key)
                }
              }}
              onClick={() => setListeningShortcutKey(field.key)}
              readOnly
            />
            <span className={`settings-shortcut-chip${normalizedValue ? '' : ' settings-shortcut-chip--muted'}`}>
              {displayValue}
            </span>
          </div>
          {conflict ? (
            <span className="settings-shortcut-warning">Also used by {conflict[0].replace(/-/g, ' ')}</span>
          ) : null}
          <div className="settings-shortcut-actions">
            <button
              type="button"
              className={`settings-secondary-button settings-secondary-button--small${listeningShortcutKey === field.key ? ' settings-shortcut-listen-button--active' : ''}`}
              onClick={() => setListeningShortcutKey(field.key)}
            >
              {listeningShortcutKey === field.key ? 'Press keys' : 'Listen'}
            </button>
            <button
              type="button"
              className="settings-secondary-button settings-secondary-button--small"
              onClick={() => void updateShortcut(field.key, '')}
            >
              Clear
            </button>
            <button
              type="button"
              className="settings-secondary-button settings-secondary-button--small"
              disabled={isDefault}
              onClick={() => resetShortcut(field)}
            >
              Reset
            </button>
          </div>
        </div>
      )
    }

    if (field.key === 'aiTabMetadata.title.codexModel' || field.key === 'aiTabMetadata.note.codexModel') {
      return renderCodexModelControl(field, value)
    }

    if (
      field.key === 'aiTabMetadata.title.claudeCodeModel' ||
      field.key === 'aiTabMetadata.note.claudeCodeModel'
    ) {
      return renderClaudeCodeModelControl(field, value)
    }

    switch (field.input) {
      case 'boolean':
        return <Switch checked={Boolean(value)} onChange={(val) => void updateField(field, val)} label={field.label} />
      case 'select':
        return (
          <select className="settings-select" value={String(value)} onChange={(e) => void updateField(field, e.target.value)}>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )
      case 'number':
        return (
          <div className="settings-input-number-container">
            <input
              className="settings-input-range"
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Number(value)}
              onChange={(e) => void updateField(field, Number(e.target.value))}
            />
            <input
              className="settings-input-number"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Number(value)}
              onChange={(e) => void updateField(field, Number(e.target.value))}
            />
          </div>
        )
      case 'text':
        return (
          <input
            className="settings-input-text"
            type="text"
            value={String(value)}
            placeholder={field.placeholder}
            onChange={(e) => void updateField(field, e.target.value)}
          />
        )
      case 'color':
        {
          const stringValue = String(value)
          const isTabThemeHue = stringValue === TAB_THEME_HUE_COLOR_VALUE
          const defaultValue = String(getDefaultValueAtPath(field.key) || '#000000')
          const fallbackValue =
            defaultValue === TAB_THEME_HUE_COLOR_VALUE
              ? getTerminalThemeColorFallback(field.key.replace(/^theme\./, ''))
              : defaultValue
          const colorValue = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(stringValue) ? stringValue : fallbackValue

          return (
            <div className="settings-color-container">
              <select
                className="settings-select settings-color-mode-select"
                value={isTabThemeHue ? TAB_THEME_HUE_COLOR_VALUE : 'custom'}
                onChange={(e) => {
                  const nextValue =
                    e.target.value === TAB_THEME_HUE_COLOR_VALUE
                      ? TAB_THEME_HUE_COLOR_VALUE
                      : colorValue
                  void updateField(field, nextValue)
                }}
              >
                <option value="custom">Custom colour</option>
                <option value={TAB_THEME_HUE_COLOR_VALUE}>Tab Theme Hue</option>
              </select>
              {isTabThemeHue ? (
                <span className="settings-tab-hue-chip">
                  <span className="settings-tab-hue-chip-swatch" aria-hidden="true" />
                  Tab Theme Hue
                </span>
              ) : (
                <>
                  <input
                    className="settings-color-swatch"
                    type="color"
                    value={colorValue.slice(0, 7)}
                    onChange={(e) => void updateField(field, e.target.value)}
                  />
                  <input
                    className="settings-input-text settings-color-text"
                    type="text"
                    value={stringValue}
                    onChange={(e) => void updateField(field, e.target.value)}
                  />
                </>
              )}
            </div>
          )
        }
      default:
        return null
    }
  }

  useEffect(() => {
    if (!listeningShortcutKey) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setListeningShortcutKey(null)
        return
      }

      const nextAccelerator = acceleratorFromKeyboardEvent(event, navigator.platform.toLowerCase().includes('mac'))
      if (!nextAccelerator) {
        return
      }

      void updateShortcut(listeningShortcutKey, nextAccelerator)
      setListeningShortcutKey(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [listeningShortcutKey, updateShortcut])

  const selectRemotePairingMode = useCallback(
    async (mode: 'lan' | 'webrtc') => {
      setSelectedRemotePairingMode(mode)
      setRemoteActionError(null)

      try {
        if (draftRef.current.remoteAccess.pairingMode !== mode) {
          await saveDraft({
            ...draftRef.current,
            remoteAccess: {
              ...draftRef.current.remoteAccess,
              pairingMode: mode,
            },
          })
        }

        setRemoteStatus(await window.terminay.getRemoteAccessStatus())
        return true
      } catch (error) {
        setRemoteActionError(
          error instanceof Error ? error.message : 'Could not save the remote pairing mode.',
        )
        return false
      }
    },
    [saveDraft],
  )

  const closePairingPinModal = useCallback((configured: boolean) => {
    pairingPinRequestRef.current?.(configured)
    pairingPinRequestRef.current = null
    setIsPairingPinModalOpen(false)
    setPairingPinInput('')
    setPairingPinError(null)
    setIsSavingPairingPin(false)
  }, [])

  const ensureRemoteAccessPairingPin = useCallback(async (mode: 'lan' | 'webrtc') => {
    if (await isRemoteAccessPairingPinConfigured(mode)) {
      return true
    }

    setPairingPinInput('')
    setPairingPinError(null)
    setIsPairingPinModalOpen(true)

    return new Promise<boolean>((resolve) => {
      pairingPinRequestRef.current = resolve
    })
  }, [])

  const submitPairingPin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const pin = pairingPinInput.trim()

      if (!PAIRING_PIN_PATTERN.test(pin)) {
        setPairingPinError('Pairing PIN must be exactly 6 digits.')
        return
      }

      setIsSavingPairingPin(true)
      setPairingPinError(null)

      try {
        await saveRemoteAccessPairingPin(pin)
        closePairingPinModal(true)
      } catch (error) {
        setPairingPinError(error instanceof Error ? error.message : 'Could not save the pairing PIN.')
        setIsSavingPairingPin(false)
      }
    },
    [closePairingPinModal, pairingPinInput],
  )

  const toggleRemoteAccess = async () => {
    setIsTogglingRemoteAccess(true)
    setRemoteActionError(null)

    try {
      if (remoteStatus?.configurationIssue) {
        setActiveCategoryId('remote')
        setActiveSectionId('remote-access-host')
        scrollToSection('remote-access-host')
        return
      }

      if (!remoteStatus?.isRunning && !(await selectRemotePairingMode(selectedRemotePairingMode))) {
        return
      }

      if (!remoteStatus?.isRunning && !(await ensureRemoteAccessPairingPin(selectedRemotePairingMode))) {
        return
      }

      const nextStatus = await window.terminay.toggleRemoteAccessServer()
      setRemoteStatus(nextStatus)
      setRemoteActionError(nextStatus.errorMessage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start remote access.'
      setRemoteActionError(message)
      setRemoteStatus((current) => (current ? { ...current, errorMessage: message } : current))
    } finally {
      setIsTogglingRemoteAccess(false)
    }
  }

  const revokeDevice = async (deviceId: string) => {
    setIsUpdatingRemoteDevices(true)
    try {
      const nextStatus = await window.terminay.revokeRemoteAccessDevice(deviceId)
      setRemoteStatus(nextStatus)
    } finally {
      setIsUpdatingRemoteDevices(false)
    }
  }

  const closeConnection = async (connectionId: string) => {
    setIsUpdatingRemoteDevices(true)
    try {
      const nextStatus = await window.terminay.closeRemoteAccessConnection(connectionId)
      setRemoteStatus(nextStatus)
    } finally {
      setIsUpdatingRemoteDevices(false)
    }
  }

  const renderRemoteManagement = () => {
    if (!displayedCategories.some((category) => category.id === 'remote')) {
      return null
    }

    const remoteSummary = remoteStatus?.isRunning
      ? remoteStatus.origin ?? 'Remote access is live.'
      : remoteActionError || remoteStatus?.errorMessage
        ? 'Remote access could not start.'
        : 'Remote access is ready.'

    const remoteDescription = remoteStatus?.isRunning
      ? 'Scan the QR code from a phone or browser, then manage trusted devices and live connections here.'
      : remoteActionError || remoteStatus?.errorMessage
        ? `${remoteActionError ?? remoteStatus?.errorMessage} You can also add your own certificate files below later if you want.`
        : 'Terminay will use your Remote Access settings and generate a self-signed certificate automatically if you leave the TLS paths blank.'
    const activePairingMode = selectedRemotePairingMode
    const selectedPairingUrl = activePairingMode === 'webrtc' ? remoteStatus?.webRtcPairingUrl : remoteStatus?.lanPairingUrl
    const selectedPairingQrCodeDataUrl =
      activePairingMode === 'webrtc' ? remoteStatus?.webRtcPairingQrCodeDataUrl : remoteStatus?.lanPairingQrCodeDataUrl
    const selectedPairingExpiresAt =
      activePairingMode === 'webrtc' ? remoteStatus?.webRtcPairingExpiresAt : remoteStatus?.lanPairingExpiresAt
    const selectedPairingLabel = activePairingMode === 'webrtc' ? 'WebRTC Relay QR' : 'Local Network QR'
    const pairedDevices = remoteStatus?.pairedDevices ?? []
    const activeConnections = remoteStatus?.connections ?? []
    const auditEvents = remoteStatus?.auditEvents ?? []

    return (
      <section id="section-remote-access-management" className="settings-section">
        <h3 className="settings-section-title">Pair Device & Live Access</h3>
        <div className="settings-group">
          <div className="settings-remote-panel">
            <div className="settings-remote-panel-header">
              <div>
                <p className="settings-remote-kicker">Remote Access</p>
                <h4>{remoteSummary}</h4>
                <p>{remoteDescription}</p>
              </div>
              <button
                type="button"
                className="settings-primary-button"
                onClick={() => void toggleRemoteAccess()}
                disabled={isTogglingRemoteAccess}
              >
                {isTogglingRemoteAccess ? 'Working...' : remoteStatus?.isRunning ? 'Stop Remote Access' : 'Pair Device'}
              </button>
            </div>

            <div className="settings-remote-card-header">
              <span className="settings-remote-card-label">Pairing QR Type</span>
              <div className="settings-remote-toggle">
                <button
                  type="button"
                  className={`settings-remote-toggle-btn${activePairingMode === 'lan' ? ' settings-remote-toggle-btn--active' : ''}`}
                  onClick={() => void selectRemotePairingMode('lan')}
                >
                  Local Network
                </button>
                <button
                  type="button"
                  className={`settings-remote-toggle-btn${activePairingMode === 'webrtc' ? ' settings-remote-toggle-btn--active' : ''}`}
                  onClick={() => void selectRemotePairingMode('webrtc')}
                >
                  WebRTC Relay
                </button>
              </div>
            </div>

            {selectedPairingQrCodeDataUrl ? (
              <div className="settings-remote-grid">
                <div className="settings-remote-card">
                  <div className="settings-remote-card-header">
                    <span className="settings-remote-card-label">{selectedPairingLabel}</span>
                    {selectedPairingUrl ? (
                      <button
                        type="button"
                        className="settings-remote-copy-button"
                        onClick={() => {
                          void navigator.clipboard.writeText(selectedPairingUrl)
                          setIsLinkCopied(true)
                          setTimeout(() => setIsLinkCopied(false), 2000)
                        }}
                      >
                        {isLinkCopied ? 'Copied' : 'Copy Link'}
                      </button>
                    ) : null}
                  </div>
                  <div className="settings-remote-qr-card">
                    <img className="settings-remote-qr" src={selectedPairingQrCodeDataUrl} alt="Remote pairing QR code" />
                  </div>
                  <p className="settings-remote-meta">
                    Expires {selectedPairingExpiresAt ? new Date(selectedPairingExpiresAt).toLocaleString() : 'soon'}
                  </p>
                  {activePairingMode === 'webrtc' && remoteStatus?.webRtcStatusMessage ? (
                    <p className="settings-remote-meta">{remoteStatus.webRtcStatusMessage}</p>
                  ) : null}
                </div>

                <div className="settings-remote-card">
                  <span className="settings-remote-card-label">Paired Devices</span>
                  <div className="settings-remote-list">
                    {pairedDevices.length === 0 ? (
                      <p className="settings-remote-empty">No paired browsers yet.</p>
                    ) : (
                      pairedDevices.map((device) => (
                        <div key={device.deviceId} className="settings-remote-item">
                          <div>
                            <strong>{device.name}</strong>
                            <p>
                              Added {new Date(device.addedAt).toLocaleString()}
                              {device.lastSeenAt ? ` · Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : ''}
                            </p>
                            <p>{formatReconnectGrantSummary(device)}</p>
                            {device.origin.includes('#transport=webrtc') ? (
                              <p>{device.origin.split('#')[0]}</p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="settings-danger-button settings-danger-button--quiet"
                            disabled={isUpdatingRemoteDevices}
                            onClick={() => void revokeDevice(device.deviceId)}
                          >
                            Revoke
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="settings-remote-card">
                  <span className="settings-remote-card-label">Active Connections</span>
                  <div className="settings-remote-list">
                    {activeConnections.length === 0 ? (
                      <p className="settings-remote-empty">No live remote connections.</p>
                    ) : (
                      activeConnections.map((connection) => (
                        <div key={connection.connectionId} className="settings-remote-item">
                          <div>
                            <strong>{connection.deviceName}</strong>
                            <p>{connection.attachedSessionCount} attached session{connection.attachedSessionCount === 1 ? '' : 's'}</p>
                          </div>
                          <button
                            type="button"
                            className="settings-secondary-button settings-secondary-button--small"
                            disabled={isUpdatingRemoteDevices}
                            onClick={() => void closeConnection(connection.connectionId)}
                          >
                            Close
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="settings-remote-card">
                  <span className="settings-remote-card-label">Recent Audit Log</span>
                  <div className="settings-remote-list">
                    {auditEvents.length === 0 ? (
                      <p className="settings-remote-empty">No remote access events yet.</p>
                    ) : (
                      auditEvents.map((event) => (
                        <div
                          key={`${event.occurredAt}-${event.action}-${event.connectionId ?? 'none'}-${event.deviceId ?? 'none'}`}
                          className="settings-remote-item settings-remote-item--stacked"
                        >
                          <strong>{event.action.replace(/-/g, ' ')}</strong>
                          <p>
                            {new Date(event.occurredAt).toLocaleString()}
                            {event.deviceName ? ` · ${event.deviceName}` : ''}
                            {event.connectionId ? ` · ${event.connectionId.slice(0, 8)}` : ''}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="settings-remote-empty-state">
                Click Pair Device to start remote access and generate a fresh pairing QR code for browsers.
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <header className="settings-sidebar-header">
          <div className="settings-brand">
            <h1>Settings</h1>
          </div>
          <div className="settings-search-container">
            <input
              type="search"
              className="settings-search-input"
              placeholder="Search settings..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </header>

        <nav className="settings-nav">
          <div className="settings-nav-section">
            {visibleCategories.map((cat) => (
              <button
                key={cat.id}
                className={`settings-nav-item ${activeCategoryId === cat.id ? 'settings-nav-item--active' : ''}`}
                aria-current={activeCategoryId === cat.id ? 'true' : undefined}
                onClick={() => {
                  setActiveCategoryId(cat.id)
                  const firstSection = filteredSections.find((s) => s.categoryId === cat.id)
                  if (firstSection) {
                    setActiveSectionId(firstSection.id)
                    setQuery('')
                    setTimeout(() => scrollToSection(firstSection.id), 0)
                  }
                }}
              >
                <div className="settings-nav-item-inner" style={{ gap: 8 }}>
                  <div className="settings-nav-icon" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>{getCategoryIcon(cat.id)}</div>
                  <span>{cat.label}</span>
                </div>
              </button>
            ))}
          </div>
        </nav>

        <footer className="settings-sidebar-footer">
          <div className="settings-status">{isSaving ? 'Saving...' : isLoading ? 'Loading...' : 'Saved'}</div>
          <button className="settings-reset-all" onClick={() => void resetAll()}>
            Reset to defaults
          </button>
        </footer>
      </aside>

      <div className="settings-right-pane">
        <main className="settings-main" ref={contentRef}>
          <div className="settings-content">

          {displayedCategories.map((cat) => {
            const sections = filteredSections.filter((s) => s.categoryId === cat.id)
            if (sections.length === 0) return null

            return (
              <div key={cat.id}>
                {query && <h3 className="settings-section-title" style={{ marginTop: 24, marginBottom: 16 }}>{cat.label}</h3>}
                {sections.map((section) => (
                  <section key={section.id} id={`section-${section.id}`} className="settings-section">
                    <div className="settings-section-title-row">
                      <h3 className="settings-section-title">{section.title}</h3>
                      {section.id === 'keyboard-shortcuts' ? (
                        <button
                          type="button"
                          className="settings-secondary-button settings-secondary-button--small"
                          onClick={() => void resetAllShortcuts()}
                        >
                          Reset All
                        </button>
                      ) : null}
                    </div>
                    <div className="settings-group">
                      {section.fields.filter(isFieldVisible).map((field) => (
                        <div key={field.key} className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">{field.label}</span>
                            <span className="settings-row-description">{field.description}</span>
                          </div>
                          <div className="settings-row-control">{renderFieldControl(field)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {cat.id === 'remote' ? renderRemoteManagement() : null}
              </div>
            )
          })}
        </div>
        </main>

        {['appearance', 'cursor', 'theme'].includes(activeCategoryId) && showPreview && (
          <>
            <div className="settings-preview-resizer" onPointerDown={handleResizePointerDown} />
            <div className="settings-preview-dock" style={{ height: previewHeight }}>
              <header className="settings-preview-header">
                <span>Live Preview</span>
                <button
                  onClick={() => setShowPreview(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--settings-text-muted)', cursor: 'pointer', fontSize: 12 }}
                >
                  Hide
                </button>
              </header>
              <TerminalPreview settings={draft} />
            </div>
          </>
        )}
        {['appearance', 'cursor', 'theme'].includes(activeCategoryId) && !showPreview && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)', textAlign: 'center' }}>
            <button
              onClick={() => setShowPreview(true)}
              style={{
                padding: '6px 16px',
                borderRadius: 6,
                background: 'var(--settings-accent)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Show Live Preview
            </button>
          </div>
        )}
      </div>
    </div>
    {isPairingPinModalOpen ? (
      <div className="settings-modal-backdrop" onMouseDown={() => closePairingPinModal(false)}>
        <form
          className="settings-pin-modal"
          onSubmit={submitPairingPin}
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-pin-modal-title"
        >
          <div className="settings-pin-modal-header">
            <h2 id="settings-pin-modal-title">Remote Pairing PIN</h2>
            <button type="button" onClick={() => closePairingPinModal(false)} aria-label="Close Remote Pairing PIN">
              x
            </button>
          </div>
          <p>Choose a 6-digit PIN. Your browser will ask for this after scanning the WebRTC QR code.</p>
          <label className="settings-pin-modal-field">
            <span>Pairing PIN</span>
            <input
              className="settings-input-text"
              type="text"
              value={pairingPinInput}
              onChange={(event) => {
                setPairingPinInput(event.target.value.replace(/\D/g, '').slice(0, 6))
                setPairingPinError(null)
              }}
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {pairingPinError ? <p className="settings-pin-modal-error">{pairingPinError}</p> : null}
          <div className="settings-pin-modal-actions">
            <button
              type="button"
              className="settings-secondary-button"
              onClick={() => closePairingPinModal(false)}
              disabled={isSavingPairingPin}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-primary-button"
              disabled={isSavingPairingPin || pairingPinInput.length !== 6}
            >
              {isSavingPairingPin ? 'Saving...' : 'Save PIN'}
            </button>
          </div>
        </form>
      </div>
    ) : null}
    </>
  )
}
