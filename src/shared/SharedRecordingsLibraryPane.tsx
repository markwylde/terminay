import { RefreshCw, Search } from 'lucide-react'
import type { TerminalRecordingListItem } from '../types/terminay'

export type RecordingGroup = readonly [string, readonly TerminalRecordingListItem[]]

/**
 * Host-neutral recordings library chrome. Replay, deletion, persistence and
 * transport remain with the host route; browser and Desktop can share only
 * the list, filtering presentation and selection semantics.
 */
export function SharedRecordingsLibraryPane({
  groupedRecordings,
  isLoading,
  onQueryChange,
  onRefresh,
  onSelect,
  query,
  recordings,
  selectedRecordingId,
  titleFor,
  durationFor,
}: Readonly<{
  groupedRecordings: readonly RecordingGroup[]
  isLoading: boolean
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onSelect: (recordingId: string) => void
  query: string
  recordings: readonly TerminalRecordingListItem[]
  selectedRecordingId: string | null
  titleFor: (recording: TerminalRecordingListItem) => string
  durationFor: (durationMs: number | null) => string
}>) {
  return (
    <aside className="recordings-sidebar" data-shared-route-body="recordings-library">
      <header className="recordings-header">
        <div>
          <h1>Recordings</h1>
          <p>{recordings.length} saved session{recordings.length === 1 ? '' : 's'}</p>
        </div>
        <button type="button" className="recordings-icon-button" onClick={onRefresh} aria-label="Refresh recordings">
          <RefreshCw size={16} />
        </button>
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
