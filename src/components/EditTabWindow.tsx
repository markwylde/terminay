import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import type {
  EditWindowState,
  ProjectEditWindowResult,
  TerminalEditWindowResult,
} from '../types/terminay'
import '../settings.css'
import './editTabWindow.css'

function hexToHue(hex: string): number {
  const normalizedHex = hex.replace(/^#/, '')
  const r = Number.parseInt(normalizedHex.substring(0, 2), 16) / 255
  const g = Number.parseInt(normalizedHex.substring(2, 4), 16) / 255
  const b = Number.parseInt(normalizedHex.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let hue = 0

  if (max !== min) {
    const delta = max - min
    switch (max) {
      case r:
        hue = (g - b) / delta + (g < b ? 6 : 0)
        break
      case g:
        hue = (b - r) / delta + 2
        break
      case b:
        hue = (r - g) / delta + 4
        break
    }

    hue /= 6
  }

  return Math.round(hue * 360)
}

function hueToHex(hue: number): string {
  const normalizedHue = hue / 360
  const saturation = 0.65
  const lightness = 0.6

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const r = hue2rgb(p, q, normalizedHue + 1 / 3)
  const g = hue2rgb(p, q, normalizedHue)
  const b = hue2rgb(p, q, normalizedHue - 1 / 3)

  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function takeSingleCharacter(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return ''
  }

  const SegmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: Intl.LocalesArgument,
        options?: { granularity?: 'grapheme' },
      ) => {
        segment: (input: string) => Iterable<{ segment: string }>
      }
    }
  ).Segmenter

  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' })
    const iterator = segmenter.segment(trimmedValue)[Symbol.iterator]()
    return iterator.next().value?.segment ?? ''
  }

  return Array.from(trimmedValue)[0] ?? ''
}

export function EditTabWindow() {
  const [state, setState] = useState<EditWindowState | null>(null)
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('')
  const [color, setColor] = useState('#717b85')
  const [inheritsProjectColor, setInheritsProjectColor] = useState(false)
  const [activityIndicatorsEnabled, setActivityIndicatorsEnabled] = useState(true)
  const [projectColor, setProjectColor] = useState('#717b85')
  const [rootFolder, setRootFolder] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let isMounted = true

    void window.terminay.getEditWindowState().then((nextState) => {
      if (!isMounted) {
        return
      }

      if (!nextState) {
        setLoadError('This edit window no longer has any draft data.')
        return
      }

      setState(nextState)
      setTitle(nextState.draft.title)
      setEmoji(nextState.draft.emoji)
      setColor(nextState.draft.color)
      if (nextState.kind === 'project') {
        setRootFolder(nextState.draft.rootFolder)
      } else {
        setActivityIndicatorsEnabled(nextState.draft.activityIndicatorsEnabled)
        setInheritsProjectColor(nextState.draft.inheritsProjectColor)
        setProjectColor(nextState.draft.projectColor)
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!state) {
      return
    }

    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
  }, [state])

  const heading = state?.kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab'
  const previewColor = state?.kind === 'terminal' && inheritsProjectColor ? projectColor : color
  const hueValue = useMemo(() => hexToHue(previewColor), [previewColor])
  const previewTitle = title.trim() || (state?.kind === 'project' ? 'Untitled Project' : 'Untitled Tab')
  const previewEmoji = emoji.trim()

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!state || isSaving) {
      return
    }

    setIsSaving(true)

    try {
      if (state.kind === 'project') {
        const result: ProjectEditWindowResult = {
          color,
          emoji: takeSingleCharacter(emoji),
          rootFolder,
          title,
        }

        await window.terminay.submitEditWindowResult({
          kind: 'project',
          result,
        })
        return
      }

      const result: TerminalEditWindowResult = {
        activityIndicatorsEnabled,
        color,
        emoji: takeSingleCharacter(emoji),
        inheritsProjectColor,
        projectColor,
        title,
      }

      await window.terminay.submitEditWindowResult({
        kind: 'terminal',
        result,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const saveOnEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target
    if (
      event.key !== 'Enter' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      !(target instanceof HTMLInputElement) ||
      !['email', 'password', 'search', 'tel', 'text', 'url'].includes(target.type)
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.requestSubmit()
  }

  return (
    <div className="edit-window-shell">
      <form className="edit-window-card" onSubmit={save} onKeyDown={saveOnEnter}>
        <header className="edit-window-header">
          <div className="edit-window-header-content">
            <h1>{heading}</h1>
            <p>Customize your tab appearance and settings.</p>
          </div>
        </header>

        {loadError ? <div className="edit-window-error">{loadError}</div> : null}

        <label className="edit-window-field">
          <span>Name</span>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={state?.kind === 'project' ? 'Project name' : 'Terminal name'}
            disabled={!state || isSaving}
          />
        </label>

        <div className="edit-window-row">
          <label className="edit-window-field edit-window-field--icon">
            <span>Icon</span>
            <input
              type="text"
              inputMode="text"
              value={emoji}
              onChange={(event) => setEmoji(takeSingleCharacter(event.target.value))}
              aria-label="Tab icon"
              disabled={!state || isSaving}
            />
          </label>

          <div className="edit-window-field edit-window-field--grow">
            <div className="hue-slider-header">
              <span>{state?.kind === 'project' ? 'Project Theme Hue' : 'Tab Theme Hue'}</span>
              <span className="hue-slider-value">{hueValue}°</span>
            </div>
            {state?.kind === 'terminal' ? (
              <div className="edit-window-inline-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-inline"
                  onClick={() => {
                    setInheritsProjectColor(true)
                    setColor(projectColor)
                  }}
                  disabled={!state || isSaving || inheritsProjectColor}
                >
                  Inherit project colour
                </button>
                <span className="edit-window-inline-hint">
                  {inheritsProjectColor
                    ? 'Following the project colour until you move the hue slider.'
                    : 'Moving the hue slider sets a manual override for this tab.'}
                </span>
              </div>
            ) : null}
            <div className="hue-slider-container">
              <input
                type="range"
                min="0"
                max="360"
                className="hue-slider"
                value={hueValue}
                onChange={(event) => {
                  setColor(hueToHex(Number(event.target.value)))
                  if (state?.kind === 'terminal') {
                    setInheritsProjectColor(false)
                  }
                }}
                disabled={!state || isSaving}
              />
            </div>
          </div>
        </div>

        {state?.kind === 'project' ? (
          <label className="edit-window-field">
            <span>Root Folder</span>
            <input
              type="text"
              value={rootFolder}
              onChange={(event) => setRootFolder(event.target.value)}
              placeholder="Enter folder path"
              disabled={isSaving}
            />
          </label>
        ) : null}

        {state?.kind === 'terminal' ? (
          <div className="edit-window-setting-row">
            <div className="edit-window-setting-copy">
              <span>Enable activity indicators</span>
              <p>Show this tab in the top activity menu and color its activity underline.</p>
            </div>
            <label className="settings-switch" aria-label="Enable activity indicators">
              <input
                type="checkbox"
                checked={activityIndicatorsEnabled}
                onChange={(event) => setActivityIndicatorsEnabled(event.target.checked)}
                disabled={isSaving}
              />
              <span className="settings-slider"></span>
            </label>
          </div>
        ) : null}

        <div className="edit-window-preview-section">
          <div className="edit-window-preview-label">Preview</div>
          <div className="edit-window-preview-container">
            {state?.kind === 'project' ? (
              <div
                className="tab-preview-project"
                style={
                  {
                    '--project-color': previewColor,
                  } as CSSProperties
                }
              >
                <span className="tab-preview-project-main">
                  {previewEmoji ? (
                    <span className="tab-preview-project-emoji" aria-hidden="true">
                      {previewEmoji}
                    </span>
                  ) : null}
                  <span className="tab-preview-project-title">{previewTitle}</span>
                </span>
                <div className="tab-preview-project-close">
                  <svg
                    aria-hidden="true"
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 3L3 9M3 3L9 9"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            ) : (
              <div
                className="tab-preview-terminal"
                style={
                  {
                    '--project-color': color,
                  } as CSSProperties
                }
              >
                {previewEmoji ? (
                  <span className="tab-preview-terminal-emoji" aria-hidden="true">
                    {previewEmoji}
                  </span>
                ) : null}
                <span className="tab-preview-terminal-title">{previewTitle}</span>
                <div className="tab-preview-terminal-close">
                  <svg
                    aria-hidden="true"
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 3L3 9M3 3L9 9"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="edit-window-actions">
          <button type="button" className="btn btn-secondary" onClick={() => window.close()} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!state || isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
