import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import {
  buildTerminalOptions,
  defaultTerminalSettings,
  terminalSettingsCategories,
  terminalSettingsSections,
} from '../terminalSettings'
import type { SettingsFieldDefinition } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalSettings } from '../types/settings'
import '../settings.css'

type CategoryId = (typeof terminalSettingsCategories)[number]['id']

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

function setValueAtPath(settings: TerminalSettings, key: string, value: boolean | number | string): TerminalSettings {
  const segments = key.split('.')
  if (segments.length === 1) {
    return { ...settings, [segments[0]]: value } as TerminalSettings
  }

  const [root, leaf] = segments
  if ((root !== 'theme' && root !== 'shell') || !leaf) {
    return settings
  }

  return {
    ...settings,
    [root]: {
      ...(settings[root] as Record<string, boolean | number | string>),
      [leaf]: value,
    },
  }
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

    terminal.writeln('\x1b[1;36mTermide Settings Preview\x1b[0m')
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
    case 'shell': return renderCategoryIcon('Shell', <><path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 7l3-3h10l3 3"/><path d="m9 12 2 2-2 2"/><line x1="13.5" y1="16" x2="16.5" y2="16"/></>)
    case 'appearance': return renderCategoryIcon('Appearance', <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></>)
    case 'cursor': return renderCategoryIcon('Cursor', <path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>)
    case 'interaction': return renderCategoryIcon('Interaction', <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></>)
    case 'scrolling': return renderCategoryIcon('Scrolling', <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>)
    case 'accessibility': return renderCategoryIcon('Accessibility', <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></>)
    case 'theme': return renderCategoryIcon('Theme', <><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></>)
    default: return renderCategoryIcon('Category', <circle cx="12" cy="12" r="10"/>)
  }
}

export function SettingsWindow() {
  const { settings: persistedSettings, isLoading } = useTerminalSettings()
  const [draft, setDraft] = useState<TerminalSettings>(defaultTerminalSettings)
  const [activeCategoryId, setActiveCategoryId] = useState<CategoryId>('appearance')
  const [activeSectionId, setActiveSectionId] = useState<string>(
    () => terminalSettingsSections.find((section) => section.categoryId === 'appearance')?.id ?? terminalSettingsSections[0]?.id ?? '',
  )
  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewHeight, setPreviewHeight] = useState(240)

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

  useEffect(() => {
    setDraft(persistedSettings)
  }, [persistedSettings])

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

  const updateField = async (field: SettingsFieldDefinition, rawValue: boolean | number | string) => {
    const nextDraft = setValueAtPath(draft, field.key, rawValue)
    setDraft(nextDraft)
    setIsSaving(true)

    try {
      const saved = await window.termide.updateTerminalSettings(nextDraft)
      setDraft(saved)
    } finally {
      setIsSaving(false)
    }
  }

  const resetAll = async () => {
    if (!confirm('Are you sure you want to reset all settings to default?')) return
    setIsSaving(true)
    try {
      const saved = await window.termide.resetTerminalSettings()
      setDraft(saved)
      setQuery('')
    } finally {
      setIsSaving(false)
    }
  }


  const scrollToSection = (id: string) => {
    const el = document.getElementById(`section-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const renderFieldControl = (field: SettingsFieldDefinition) => {
    const value = getValueAtPath(draft, field.key)

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
        return (
          <div className="settings-color-container">
            <input
              className="settings-color-swatch"
              type="color"
              value={String(value)}
              onChange={(e) => void updateField(field, e.target.value)}
            />
            <input
              className="settings-input-text settings-color-text"
              type="text"
              value={String(value)}
              onChange={(e) => void updateField(field, e.target.value)}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
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
                    <h3 className="settings-section-title">{section.title}</h3>
                    <div className="settings-group">
                      {section.fields.map((field) => (
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
              </div>
            )
          })}
        </div>
        </main>

        {showPreview && (
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
        {!showPreview && (
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
  )
}
