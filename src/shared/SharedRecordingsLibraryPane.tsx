import type { ReactNode } from 'react'
import { Film, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { TerminalRecordingListItem } from '../types/terminay'

export type RecordingGroup = readonly [string, readonly TerminalRecordingListItem[]]

/**
 * Host-neutral recordings library chrome. Replay, deletion, persistence and
 * transport remain with the host route; browser and Desktop can share only
 * the list, filtering presentation and selection semantics.
 */
export function SharedRecordingsLibraryPane({
  groupedRecordings,
  headerAccessory,
  isLoading,
  onQueryChange,
  onRefresh,
  onDelete,
  updatedLabel,
  onSelect,
  query,
  recordings,
  selectedRecordingId,
  titleFor,
  durationFor,
  layout = 'sidebar',
}: Readonly<{
  groupedRecordings: readonly RecordingGroup[]
  /** Drawn in the header before the refresh control. */
  headerAccessory?: ReactNode
  isLoading: boolean
  onQueryChange: (query: string) => void
  onRefresh: () => void
  /** Offered on each row of the `page` layout. */
  onDelete?: (recordingId: string) => void
  /** "Updated just now", shown beside refresh on the `page` layout. */
  updatedLabel?: string
  onSelect: (recordingId: string) => void
  query: string
  recordings: readonly TerminalRecordingListItem[]
  selectedRecordingId: string | null
  titleFor: (recording: TerminalRecordingListItem) => string
  durationFor: (durationMs: number | null) => string
  /** `page` fills a Home tab, in the voice of the other Home pages; `sidebar` is a narrow list beside a replay. */
  layout?: 'sidebar' | 'page'
}>) {
  if (layout === 'page') {
    const shown = groupedRecordings.reduce((total, [, items]) => total + items.length, 0)
    const count = recordings.length === 1 ? '1 recording' : `${recordings.length} recordings`
    return (
      <section className="recordings-page" data-shared-route-body="recordings-library">
        <header className="home-section__header">
          <h2 className="home-section__heading">Recordings</h2>
          <p className="home-section__subheading" data-terminay-recordings-count>
            {query.trim() === '' ? count : `${shown} of ${count}`}
          </p>
        </header>
        <div className="recordings-page__toolbar">
          <label className="recordings-page__search">
            <Search aria-hidden="true" size={13} />
            <input
              aria-label="Search recordings"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search recordings"
              type="search"
            />
          </label>
          {headerAccessory}
          <span className="recordings-page__spacer" />
          {updatedLabel === undefined ? null : (
            <span className="recordings-page__updated" aria-live="polite">{updatedLabel}</span>
          )}
          <button
            type="button"
            className="recordings-page__refresh"
            onClick={onRefresh}
            aria-busy={isLoading}
            aria-label="Refresh recordings"
            title="Refresh"
          >
            <RefreshCw size={13} aria-hidden="true" className={isLoading ? 'recordings-spin' : undefined} />
          </button>
        </div>
        <div className="recordings-page__list">
          {isLoading && recordings.length === 0 ? (
            <p className="recordings-page__state" role="status">Loading recordings…</p>
          ) : null}
          {!isLoading && recordings.length === 0 ? (
            <div className="recordings-page__empty">
              <div className="recordings-page__empty-icon" aria-hidden="true">
                <Film size={20} />
              </div>
              <h3 className="recordings-page__empty-title">No recordings yet</h3>
              <p className="recordings-page__empty-text">
                Start recording from a terminal tab’s menu, or record every new terminal from Settings › Recording.
              </p>
            </div>
          ) : null}
          {!isLoading && recordings.length > 0 && groupedRecordings.length === 0 ? (
            <p className="recordings-page__state">No recordings match “{query}”.</p>
          ) : null}
          {groupedRecordings.map(([date, items]) => (
            <section key={date} className="recordings-page__group" aria-label={formatGroupDate(date)}>
              <h3 className="recordings-page__group-head">
                {formatGroupDate(date)}
                <span className="recordings-page__group-count">{items.length}</span>
              </h3>
              {items.map((recording) => (
                <div key={recording.recordingId} className="recordings-page__row" data-terminay-recording-row={recording.recordingId}>
                  <button
                    type="button"
                    className="recordings-page__open"
                    onClick={() => onSelect(recording.recordingId)}
                  >
                    <span
                      className="recordings-page__swatch"
                      style={recording.projectColor === null ? undefined : { background: recording.projectColor }}
                      aria-hidden="true"
                    />
                    <span className="recordings-page__title">{titleFor(recording)}</span>
                    <span className="recordings-page__detail">{recordingDetail(recording)}</span>
                    {recording.recordingState === 'completed' ? null : (
                      <span className={`recordings-page__pill recordings-page__pill--${recording.recordingState}`}>
                        {recording.recordingState}
                      </span>
                    )}
                    <span className="recordings-page__time">{formatStartTime(recording.startedAt)}</span>
                    <span className="recordings-page__time">{durationFor(recording.durationMs)}</span>
                  </button>
                  {onDelete === undefined ? null : (
                    <button
                      type="button"
                      className="recordings-page__row-action"
                      onClick={() => onDelete(recording.recordingId)}
                      aria-label={`Delete ${titleFor(recording)}`}
                      title="Delete recording"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>
    )
  }

  return (
    <aside className="recordings-sidebar" data-shared-route-body="recordings-library">
      <header className="recordings-header">
        <div>
          <h1>Recordings</h1>
          <p>{recordings.length} saved session{recordings.length === 1 ? '' : 's'}</p>
        </div>
        <div className="recordings-header__actions">
          {headerAccessory}
          <button type="button" className="recordings-icon-button" onClick={onRefresh} aria-label="Refresh recordings">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      <label className="recordings-search">
        <Search size={15} />
        <input
          aria-label="Search recordings"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search recordings"
        />
      </label>
      <div className="recordings-list">
        {isLoading ? <div className="recordings-empty">Loading recordings...</div> : null}
        {!isLoading && groupedRecordings.length === 0 ? <div className="recordings-empty">No recordings found.</div> : null}
        {groupedRecordings.map(([date, items]) => (
          <section key={date} className="recordings-group">
            <h2>{date}</h2>
            {items.map((recording) => (
              <button
                key={recording.recordingId}
                type="button"
                className={`recordings-list-item${recording.recordingId === selectedRecordingId ? ' recordings-list-item--selected' : ''}`}
                onClick={() => onSelect(recording.recordingId)}
              >
                <span className="recordings-list-item__title">{titleFor(recording)}</span>
                <span className="recordings-list-item__meta">
                  {(recording.cwdLabel ?? 'Unknown folder')} · {durationFor(recording.durationMs)}
                </span>
                <span className={`recordings-list-item__state recordings-list-item__state--${recording.recordingState}`}>
                  {recording.recordingState}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

function formatStartTime(startedAt: string): string {
  const date = new Date(startedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function recordingDetail(recording: TerminalRecordingListItem): string {
  return [recording.projectTitle, recording.cwdLabel, shellLabel(recording.shellName), formatSize(recording.bytesWritten)]
    .filter(Boolean)
    .join(' · ')
}

/** `/bin/zsh` reads as `zsh`; "System default" says nothing worth a column. */
function shellLabel(shell: string | null): string | null {
  if (shell === null || shell === 'System default') return null
  return shell.split(/[\\/]/u).at(-1) || null
}

function formatSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "Today", "Yesterday", or the weekday and date for a `YYYY-MM-DD` group. */
function formatGroupDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  if (match === null) return date
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  return day.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}
