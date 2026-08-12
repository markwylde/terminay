import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import type { EditWindowState, ProjectEditWindowResult, TerminalEditWindowResult } from '../types/terminay'
import '../settings.css'
import '../components/editTabWindow.css'

export type SharedEditTabResult = ProjectEditWindowResult | TerminalEditWindowResult

export interface SharedEditTabRouteBodyProps {
  readonly state: EditWindowState
  readonly onCancel: () => void
  readonly onSubmit: (result: SharedEditTabResult) => Promise<void>
}

function hexToHue(hex: string): number {
  const normalized = hex.replace(/^#/, '')
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const delta = max - min
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return Math.round((hue / 6) * 360)
}

function hueToHex(hue: number): string {
  const normalized = hue / 360
  const saturation = 0.65
  const lightness = 0.6
  const hue2rgb = (p: number, q: number, t: number) => {
    const value = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  const q = lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const hex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0')
  return `#${hex(hue2rgb(p, q, normalized + 1 / 3))}${hex(hue2rgb(p, q, normalized))}${hex(hue2rgb(p, q, normalized - 1 / 3))}`
}

export function takeSingleEditTabCharacter(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const SegmenterCtor = (Intl as typeof Intl & { Segmenter?: new (locales?: Intl.LocalesArgument, options?: { granularity?: 'grapheme' }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter
  if (SegmenterCtor) return new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value?.segment ?? ''
  return Array.from(trimmed)[0] ?? ''
}

/**
 * Host-neutral Edit Tab route body. Hosts load and persist the draft, while
 * this component owns the form, validation, preview, keyboard behaviour, and
 * cancel/submit semantics for both project and terminal tabs.
 */
export function SharedEditTabRouteBody({ state, onCancel, onSubmit }: SharedEditTabRouteBodyProps) {
  const [title, setTitle] = useState(state.draft.title)
  const [emoji, setEmoji] = useState(state.draft.emoji)
  const [color, setColor] = useState(state.draft.color)
  const [rootFolder, setRootFolder] = useState(state.kind === 'project' ? state.draft.rootFolder : '')
	const [defaultShellProfileId, setDefaultShellProfileId] = useState(state.kind === 'project' ? state.draft.defaultShellProfileId : null)
  const [inheritsProjectColor, setInheritsProjectColor] = useState(state.kind === 'terminal' ? state.draft.inheritsProjectColor : false)
  const [projectColor] = useState(state.kind === 'terminal' ? state.draft.projectColor : '#717b85')
  const [activityIndicatorsEnabled, setActivityIndicatorsEnabled] = useState(state.kind === 'terminal' ? state.draft.activityIndicatorsEnabled : true)
  const [isSaving, setIsSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => { titleInputRef.current?.focus(); titleInputRef.current?.select() }, 0)
    return () => clearTimeout(timer)
  }, [])

  const previewColor = state.kind === 'terminal' && inheritsProjectColor ? projectColor : color
  const hueValue = useMemo(() => hexToHue(previewColor), [previewColor])
  const previewTitle = title.trim() || (state.kind === 'project' ? 'Untitled Project' : 'Untitled Tab')
  const previewEmoji = emoji.trim()
  const heading = state.kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab'
  const disabled = isSaving

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    try {
      await onSubmit(state.kind === 'project'
        ? { color, defaultShellProfileId, emoji: takeSingleEditTabCharacter(emoji), rootFolder, title }
        : { activityIndicatorsEnabled, color, emoji: takeSingleEditTabCharacter(emoji), inheritsProjectColor, projectColor, title })
    } finally { setIsSaving(false) }
  }
  const saveOnEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(target instanceof HTMLInputElement) || !['email', 'password', 'search', 'tel', 'text', 'url'].includes(target.type)) return
    event.preventDefault()
    event.currentTarget.requestSubmit()
  }

  return <div className="edit-window-shell" data-shared-route-body="edit-tab">
    <form className="edit-window-card" onSubmit={save} onKeyDown={saveOnEnter}>
      <header className="edit-window-header"><div className="edit-window-header-content"><h1>{heading}</h1><p>Customize your tab appearance and settings.</p></div></header>
      <label className="edit-window-field"><span>Name</span><input ref={titleInputRef} type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={state.kind === 'project' ? 'Project name' : 'Terminal name'} disabled={disabled} /></label>
      <div className="edit-window-row">
        <label className="edit-window-field edit-window-field--icon"><span>Icon</span><input type="text" inputMode="text" value={emoji} onChange={(event) => setEmoji(takeSingleEditTabCharacter(event.target.value))} aria-label="Tab icon" disabled={disabled} /></label>
        <div className="edit-window-field edit-window-field--grow">
          <div className="hue-slider-header"><span>{state.kind === 'project' ? 'Project Theme Hue' : 'Tab Theme Hue'}</span><span className="hue-slider-value">{hueValue}°</span></div>
          {state.kind === 'terminal' ? <div className="edit-window-inline-actions"><button type="button" className="btn btn-secondary btn-inline" onClick={() => { setInheritsProjectColor(true); setColor(projectColor) }} disabled={disabled || inheritsProjectColor}>Inherit project colour</button><span className="edit-window-inline-hint">{inheritsProjectColor ? 'Following the project colour until you move the hue slider.' : 'Moving the hue slider sets a manual override for this tab.'}</span></div> : null}
          <div className="hue-slider-container"><input type="range" min="0" max="360" className="hue-slider" aria-label={state.kind === 'project' ? 'Project theme hue' : 'Tab theme hue'} aria-valuetext={`${hueValue} degrees`} value={hueValue} onChange={(event) => { setColor(hueToHex(Number(event.target.value))); if (state.kind === 'terminal') setInheritsProjectColor(false) }} disabled={disabled} /></div>
        </div>
      </div>
      {state.kind === 'project' ? <label className="edit-window-field"><span>Root Folder</span><input type="text" value={rootFolder} onChange={(event) => setRootFolder(event.target.value)} placeholder="Enter folder path" disabled={disabled} /></label> : null}
		{state.kind === 'project' ? <section className="edit-window-setting-row" aria-label="Project environment"><div className="edit-window-setting-copy"><span>Environment</span><p><strong>{state.draft.environmentLabel}</strong> · {state.draft.environmentStatus}<br /><small>{state.draft.projectEnvironmentId}</small></p></div>{state.draft.environmentDefaultRoot === null ? null : <button type="button" className="btn btn-secondary btn-inline" disabled={disabled || rootFolder === state.draft.environmentDefaultRoot} onClick={() => setRootFolder(state.draft.environmentDefaultRoot ?? rootFolder)}>Use environment default</button>}</section> : null}
		{state.kind === 'project' ? <label className="edit-window-field"><span>Default shell profile</span><select value={defaultShellProfileId ?? ''} onChange={(event) => setDefaultShellProfileId(event.target.value || null)} disabled={disabled}><option value="">Use server default</option>{state.draft.shellProfileOptions.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.available}>{profile.name}{profile.available ? '' : ' — unavailable'}</option>)}</select><small>Applies to new terminals in this project. Existing terminals do not change.</small></label> : null}
      {state.kind === 'terminal' ? <div className="edit-window-setting-row"><div className="edit-window-setting-copy"><span>Enable activity indicators</span><p>Show this tab in the top activity menu and color its activity underline.</p></div><label className="settings-switch" aria-label="Enable activity indicators"><input type="checkbox" checked={activityIndicatorsEnabled} onChange={(event) => setActivityIndicatorsEnabled(event.target.checked)} disabled={disabled} /><span className="settings-slider" /></label></div> : null}
      <div className="edit-window-preview-section"><div className="edit-window-preview-label">Preview</div><div className="edit-window-preview-container">
        {state.kind === 'project' ? <div className="tab-preview-project" style={{ '--project-color': previewColor } as CSSProperties}><span className="tab-preview-project-main">{previewEmoji ? <span className="tab-preview-project-emoji" aria-hidden="true">{previewEmoji}</span> : null}<span className="tab-preview-project-title">{previewTitle}</span></span><PreviewClose className="tab-preview-project-close" /></div>
          : <div className="tab-preview-terminal" style={{ '--project-color': previewColor } as CSSProperties}>{previewEmoji ? <span className="tab-preview-terminal-emoji" aria-hidden="true">{previewEmoji}</span> : null}<span className="tab-preview-terminal-title">{previewTitle}</span><PreviewClose className="tab-preview-terminal-close" /></div>}
      </div></div>
      <div className="edit-window-actions"><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={disabled}>Cancel</button><button type="submit" className="btn btn-primary" disabled={disabled}>{isSaving ? 'Saving...' : 'Save'}</button></div>
    </form>
  </div>
}

function PreviewClose({ className }: Readonly<{ className: string }>) {
  return <div className={className}><svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
}
