import { useState, type ReactNode } from 'react'
import { MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { CompactSectionPage } from '../workspace/compact/CompactSectionPage'
import { CompactChip, CompactEmpty, CompactGroupHeader, CompactRow } from '../workspace/compact/CompactRow'
import { SheetRow } from '../workspace/compact/CompactSheet'
import { countTabs, rowsForTab } from '../workspace/compact/compactSectionModel'
import type { TerminalRecordingListItem } from '../types/terminay'
import type { RecordingGroup } from './SharedRecordingsLibraryPane'

export type RecordingsCompactTab = 'all' | 'today' | 'week' | 'problems'

type Row = Readonly<{ date: string; recording: TerminalRecordingListItem }>

/** Days between a `YYYY-MM-DD` group and today, in local time. */
function daysAgo(date: string, today: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  if (match === null) return Number.POSITIVE_INFINITY
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Math.round((today.getTime() - day.getTime()) / 86_400_000)
}

function tabDefs(today: Date) {
  return [
    { id: 'all' as RecordingsCompactTab, label: 'All' },
    { id: 'today' as RecordingsCompactTab, label: 'Today', test: (row: Row) => daysAgo(row.date, today) === 0 },
    { id: 'week' as RecordingsCompactTab, label: 'This week', test: (row: Row) => daysAgo(row.date, today) < 7 },
    {
      id: 'problems' as RecordingsCompactTab,
      label: 'Problems',
      attention: true,
      test: (row: Row) =>
        row.recording.recordingState === 'interrupted' || row.recording.recordingState === 'failed',
    },
  ]
}

/**
 * Home › Recordings on a compact workspace: the compact section page. Rows sit
 * under day headers; each offers Delete recording from its more control. The
 * sheet holds the server selector, when there is a choice, and Refresh.
 */
export function RecordingsCompactPage({
  groupedRecordings,
  recordings,
  isLoading,
  query,
  onQueryChange,
  onRefresh,
  onDelete,
  onSelect,
  updatedLabel,
  serverAccessory,
  titleFor,
  durationFor,
  detailFor,
  timeFor,
  groupLabel,
  tab,
  onTab,
}: Readonly<{
  groupedRecordings: readonly RecordingGroup[]
  recordings: readonly TerminalRecordingListItem[]
  isLoading: boolean
  query: string
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onDelete?: (recordingId: string) => void
  onSelect: (recordingId: string) => void
  updatedLabel?: string
  serverAccessory?: ReactNode
  titleFor: (recording: TerminalRecordingListItem) => string
  durationFor: (durationMs: number | null) => string
  detailFor: (recording: TerminalRecordingListItem) => string
  timeFor: (startedAt: string) => string
  groupLabel: (date: string) => string
  tab: RecordingsCompactTab
  onTab: (tab: RecordingsCompactTab) => void
}>) {
  const [menuFor, setMenuFor] = useState<string>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const defs = tabDefs(today)
  const rows: Row[] = groupedRecordings.flatMap(([date, items]) => items.map((recording) => ({ date, recording })))
  const tabs = countTabs(rows, defs)
  const shown = rowsForTab(rows, defs, tab)
  const byDate = new Map<string, TerminalRecordingListItem[]>()
  for (const row of shown) {
    const bucket = byDate.get(row.date)
    if (bucket === undefined) byDate.set(row.date, [row.recording])
    else bucket.push(row.recording)
  }
  const term = query.trim()

  let body: ReactNode
  if (isLoading && recordings.length === 0) {
    body = <CompactEmpty title="Loading recordings…" />
  } else if (recordings.length === 0) {
    body = (
      <CompactEmpty title="No recordings yet">
        Start recording from a terminal tab’s menu, or record every new terminal from Settings › Recording.
      </CompactEmpty>
    )
  } else if (shown.length === 0) {
    body =
      term === '' ? (
        <CompactEmpty title={tab === 'problems' ? 'No recording had a problem' : 'No recordings here'} />
      ) : (
        <CompactEmpty
          title={`No recordings match “${term}”`}
          action={{ label: 'Clear search', onActivate: () => onQueryChange('') }}
        />
      )
  } else {
    body = (
      <div>
        {[...byDate].map(([date, items]) => (
          <section key={date} aria-label={groupLabel(date)}>
            <CompactGroupHeader label={groupLabel(date)} count={items.length} />
            {items.map((recording) => {
              const title = titleFor(recording)
              const isMenuOpen = menuFor === recording.recordingId
              return (
                <div key={recording.recordingId}>
                  <CompactRow
                    lead={
                      <span
                        className="crow-group__swatch crecording__swatch"
                        style={recording.projectColor === null ? undefined : { background: recording.projectColor }}
                        aria-hidden="true"
                      />
                    }
                    title={title}
                    trailing={timeFor(recording.startedAt)}
                    detail={[detailFor(recording), durationFor(recording.durationMs)].filter(Boolean).join(' · ')}
                    {...(recording.recordingState === 'completed'
                      ? {}
                      : {
                          chips: (
                            <CompactChip
                              tone={recording.recordingState === 'recording' ? 'working' : 'attention'}
                            >
                              {recording.recordingState}
                            </CompactChip>
                          ),
                        })}
                    onActivate={() => onSelect(recording.recordingId)}
                    {...(onDelete === undefined
                      ? {}
                      : {
                          aside: (
                            <button
                              type="button"
                              className="cpage__action"
                              aria-label={`More for ${title}`}
                              aria-expanded={isMenuOpen}
                              onClick={() => setMenuFor(isMenuOpen ? undefined : recording.recordingId)}
                              data-terminay-recording-more="true"
                            >
                              <MoreHorizontal size={18} aria-hidden="true" />
                            </button>
                          ),
                        })}
                    rowProps={{ 'data-terminay-recording-row': recording.recordingId }}
                  />
                  {isMenuOpen && onDelete !== undefined ? (
                    <div className="crecording__menu">
                      <button
                        type="button"
                        className="crecording__delete"
                        onClick={() => {
                          setMenuFor(undefined)
                          onDelete(recording.recordingId)
                        }}
                        aria-label={`Delete ${title}`}
                      >
                        <Trash2 size={15} aria-hidden="true" /> Delete recording
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    )
  }

  return (
    <CompactSectionPage
      section="recordings"
      title="Recordings"
      {...(recordings.length === 0 ? {} : { summary: String(recordings.length) })}
      search={{ value: query, onChange: onQueryChange, placeholder: 'Search recordings', label: 'Search recordings' }}
      tabs={tabs}
      selectedTab={tab}
      onSelectTab={onTab}
      sheet={{
        title: 'Recordings',
        canReset: false,
        onReset: () => {},
        content: (
          <>
            {serverAccessory === undefined || serverAccessory === null ? null : (
              <div className="csheet__accessory">{serverAccessory}</div>
            )}
            <SheetRow label={updatedLabel ?? 'Not loaded yet'}>
              <button
                type="button"
                className="csheet__button"
                onClick={onRefresh}
                aria-busy={isLoading}
                data-terminay-recordings-refresh="true"
              >
                <RefreshCw size={14} aria-hidden="true" className={isLoading ? 'recordings-spin' : undefined} />
                Refresh
              </button>
            </SheetRow>
          </>
        ),
      }}
    >
      {body}
    </CompactSectionPage>
  )
}
