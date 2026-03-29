import { useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
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
  if (root !== 'theme' || !leaf) {
    return settings
  }

  return {
    ...settings,
    theme: {
      ...settings.theme,
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
      allowProposedApi: false,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
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

  const currentCategory = terminalSettingsCategories.find((category) => category.id === activeCategoryId) ?? terminalSettingsCategories[0]

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
          {visibleCategories.map((cat) => (
            <div key={cat.id} className="settings-nav-group">
              <div className="settings-nav-group-title">{cat.label}</div>
              {filteredSections
                .filter((s) => s.categoryId === cat.id)
                .map((section) => (
                  <button
                    key={section.id}
                    className={`settings-nav-item ${activeSectionId === section.id ? 'settings-nav-item--active' : ''}`}
                    aria-current={activeSectionId === section.id ? 'true' : undefined}
                    onClick={() => {
                      setActiveCategoryId(cat.id)
                      setActiveSectionId(section.id)
                      setQuery('')
                      setTimeout(() => scrollToSection(section.id), 0)
                    }}
                  >
                    {section.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <footer className="settings-sidebar-footer">
          <div className="settings-status">{isSaving ? 'Saving...' : isLoading ? 'Loading...' : 'Saved'}</div>
          <button className="settings-reset-all" onClick={() => void resetAll()}>
            Reset to defaults
          </button>
        </footer>
      </aside>

      <main className="settings-main" ref={contentRef}>
        <div className="settings-content">
          {!query && (
            <header className="settings-category-header">
              <h2>{currentCategory.label}</h2>
              <p>{currentCategory.description}</p>
            </header>
          )}

          {displayedCategories.map((cat) => {
            const sections = filteredSections.filter((s) => s.categoryId === cat.id)
            if (sections.length === 0) return null

            return (
              <div key={cat.id}>
                {query && <h2 style={{ marginTop: 40, marginBottom: 20 }}>{cat.label}</h2>}
                {sections.map((section) => (
                  <section key={section.id} id={`section-${section.id}`} className="settings-section">
                    <h3 className="settings-section-title">{section.title}</h3>
                    <p className="settings-section-desc">{section.description}</p>
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
        <div className="settings-preview-dock">
          <header className="settings-preview-header">
            <span>Live Preview</span>
            <button
              onClick={() => setShowPreview(false)}
              style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
            >
              ✕
            </button>
          </header>
          <TerminalPreview settings={draft} />
        </div>
      )}
      {!showPreview && (
        <button
          onClick={() => setShowPreview(true)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            padding: '8px 16px',
            borderRadius: 20,
            background: 'var(--settings-accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 101,
          }}
        >
          Show Preview
        </button>
      )}
    </div>
  )
}
