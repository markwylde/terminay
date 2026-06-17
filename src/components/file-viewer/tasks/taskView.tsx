import MarkdownIt from 'markdown-it'
import type { ReactNode } from 'react'
import type { FileViewerMode } from '../../../types/fileViewer'
import { type TaskItem, type TaskSection, type TaskStats, computeStats } from './parseTasks'

const inlineMarkdown = new MarkdownIt({ html: false, linkify: true, typographer: true })

export type TaskFilter = 'all' | 'remaining' | 'done'

export const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remaining', label: 'Remaining' },
  { id: 'done', label: 'Done' },
]

/** A stable empty set used to force-expand everything while searching. */
export const NO_COLLAPSE: ReadonlySet<string> = new Set()

export type TaskPredicate = (task: TaskItem) => boolean

export function renderLabel(label: string): { __html: string } {
  return { __html: inlineMarkdown.renderInline(label) }
}

export function percent(stats: TaskStats): number {
  if (stats.total === 0) {
    return 0
  }
  return Math.round((stats.completed / stats.total) * 100)
}

export function isComplete(stats: TaskStats): boolean {
  return stats.total > 0 && stats.completed === stats.total
}

export function matchesFilter(task: TaskItem, filter: TaskFilter): boolean {
  if (filter === 'remaining') {
    return !task.checked
  }
  if (filter === 'done') {
    return task.checked
  }
  return true
}

/** Build the combined filter + free-text predicate used to drive every list. */
export function buildPredicate(filter: TaskFilter, query: string): TaskPredicate {
  const needle = query.trim().toLowerCase()
  return (task) => {
    if (!matchesFilter(task, filter)) {
      return false
    }
    if (needle === '') {
      return true
    }
    return task.label.toLowerCase().includes(needle)
  }
}

export function sectionHasVisibleTasks(section: TaskSection, predicate: TaskPredicate): boolean {
  if (section.tasks.some(predicate)) {
    return true
  }
  return section.children.some((child) => sectionHasVisibleTasks(child, predicate))
}

export function collectSectionIds(section: TaskSection, keyPrefix = '', ids: string[] = []): string[] {
  for (const child of section.children) {
    ids.push(keyPrefix ? `${keyPrefix}:${child.id}` : child.id)
    collectSectionIds(child, keyPrefix, ids)
  }
  return ids
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/** The hero donut. Rendered once per view as the headline progress widget. */
export function ProgressRing({ value, complete }: { value: number; complete: boolean }) {
  const size = 78
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference

  return (
    <div className={`file-tasks__ring${complete ? ' file-tasks__ring--complete' : ''}`} role="img" aria-label={`${value}% complete`}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="taskRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#40c884" />
            <stop offset="100%" stopColor="#57b7ff" />
          </linearGradient>
        </defs>
        <circle className="file-tasks__ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="file-tasks__ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="file-tasks__ring-label">
        {complete ? (
          <span className="file-tasks__ring-check" aria-hidden="true">
            <CheckGlyph />
          </span>
        ) : (
          <span className="file-tasks__ring-value">{value}%</span>
        )}
      </div>
    </div>
  )
}

/** A single number-over-label stat card. The `{' '}` keeps "62 done" contiguous for tests. */
export function StatTile({ tone, value, label }: { tone: 'done' | 'remaining' | 'total' | 'files' | 'diff'; value: ReactNode; label: string }) {
  return (
    <div className={`file-tasks__stat file-tasks__stat--${tone}`}>
      <span className="file-tasks__stat-value">{value}</span>{' '}
      <span className="file-tasks__stat-label">{label}</span>
    </div>
  )
}

export function TaskHero({ stats, meta, children }: { stats: TaskStats; meta?: ReactNode; children: ReactNode }) {
  const pct = percent(stats)
  const complete = isComplete(stats)
  return (
    <header className="file-tasks__summary">
      <div className="file-tasks__hero">
        <ProgressRing value={pct} complete={complete} />
        <div className="file-tasks__hero-body">
          <div className="file-tasks__stats">{children}</div>
          <div className="file-tasks__summary-bar" aria-hidden="true">
            <span
              className={`file-tasks__summary-bar-fill${complete ? ' file-tasks__summary-bar-fill--complete' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {meta ? <div className="file-tasks__hero-meta">{meta}</div> : null}
        </div>
      </div>
    </header>
  )
}

export function TaskCallout({ tone, icon, children }: { tone: 'success' | 'info' | 'diff'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={`file-tasks__callout file-tasks__callout--${tone}`} role="status">
      <span className="file-tasks__callout-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="file-tasks__callout-text">{children}</span>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ListGlyph() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function BoardGlyph() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="5" height="8" rx="1" />
    </svg>
  )
}

export type TaskView = 'list' | 'kanban'

const VIEWS: { id: TaskView; label: string; icon: ReactNode }[] = [
  { id: 'list', label: 'List', icon: <ListGlyph /> },
  { id: 'kanban', label: 'Kanban', icon: <BoardGlyph /> },
]

export function TaskToolbar({
  view,
  onViewChange,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  showFilter = true,
  children,
}: {
  view: TaskView
  onViewChange: (view: TaskView) => void
  filter: TaskFilter
  onFilterChange: (filter: TaskFilter) => void
  query: string
  onQueryChange: (query: string) => void
  showFilter?: boolean
  children?: ReactNode
}) {
  return (
    <div className="file-tasks__toolbar">
      <div className="file-tasks__viewtoggle" role="tablist" aria-label="Task layout">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={view === option.id}
            className="file-tasks__viewtoggle-button"
            onClick={() => onViewChange(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
      {showFilter ? (
        <div className="file-tasks__filter" role="tablist" aria-label="Filter tasks">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              className={`file-tasks__filter-button${filter === option.id ? ' file-tasks__filter-button--active' : ''}`}
              onClick={() => onFilterChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`file-tasks__search${query ? ' file-tasks__search--active' : ''}`}>
        <span className="file-tasks__search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="file-tasks__search-input"
          type="search"
          placeholder="Search tasks…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search tasks"
        />
        {query ? (
          <button type="button" className="file-tasks__search-clear" onClick={() => onQueryChange('')} aria-label="Clear search">
            ✕
          </button>
        ) : null}
      </div>
      {children ? <div className="file-tasks__toolbar-actions">{children}</div> : null}
    </div>
  )
}

export function StatsBadge({ stats }: { stats: TaskStats }) {
  const complete = isComplete(stats)
  return (
    <span className="file-tasks__badge">
      {stats.completedInDiff > 0 ? (
        <span className="file-tasks__badge-diff" title="Newly completed in the working-tree diff">
          +{stats.completedInDiff}
        </span>
      ) : null}
      <span className="file-tasks__track" aria-hidden="true">
        <span className="file-tasks__track-fill" style={{ width: `${percent(stats)}%` }} />
      </span>
      <span className={`file-tasks__badge-count${complete ? ' file-tasks__badge-count--complete' : ''}`}>
        {complete ? (
          <span className="file-tasks__badge-check" aria-hidden="true">
            <CheckGlyph />
          </span>
        ) : null}
        {stats.completed}/{stats.total}
      </span>
    </span>
  )
}

export function TaskRow({
  task,
  documentPath,
  onOpenFile,
}: {
  task: TaskItem
  documentPath?: string
  onOpenFile?: (path: string, initialMode?: FileViewerMode) => void
}) {
  const label = <span className="file-tasks__label" dangerouslySetInnerHTML={renderLabel(task.label)} />
  return (
    <li
      className={`file-tasks__item${task.checked ? ' file-tasks__item--checked' : ''}${task.completedInDiff ? ' file-tasks__item--in-diff' : ''}`}
      style={task.depth > 0 ? { marginLeft: `${task.depth * 18}px` } : undefined}
    >
      <input className="file-tasks__checkbox" type="checkbox" checked={task.checked} disabled readOnly />
      {onOpenFile && documentPath ? (
        <button
          type="button"
          className="folder-tasks__task-link"
          onDoubleClick={() => onOpenFile(documentPath, 'tasks')}
          title={`Open ${documentPath}`}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </li>
  )
}

export function SectionNode({
  section,
  collapsed,
  predicate,
  onToggle,
  keyPrefix,
  documentPath,
  onOpenFile,
}: {
  section: TaskSection
  collapsed: ReadonlySet<string>
  predicate: TaskPredicate
  onToggle: (id: string) => void
  keyPrefix?: string
  documentPath?: string
  onOpenFile?: (path: string, initialMode?: FileViewerMode) => void
}) {
  if (!sectionHasVisibleTasks(section, predicate)) {
    return null
  }

  const sectionId = keyPrefix ? `${keyPrefix}:${section.id}` : section.id
  const stats = computeStats(section)
  const isCollapsed = collapsed.has(sectionId)
  const visibleTasks = section.tasks.filter(predicate)
  const childSections = section.children.filter((child) => sectionHasVisibleTasks(child, predicate))
  const complete = isComplete(stats)

  return (
    <section className={`file-tasks__section${complete ? ' file-tasks__section--complete' : ''}`}>
      <button
        type="button"
        className="file-tasks__section-header"
        onClick={() => onToggle(sectionId)}
        aria-expanded={!isCollapsed}
      >
        <span className={`file-tasks__chevron${isCollapsed ? ' file-tasks__chevron--collapsed' : ''}`}>▾</span>
        <span className="file-tasks__section-title">{section.title}</span>
        <StatsBadge stats={stats} />
      </button>

      {isCollapsed ? null : (
        <div className="file-tasks__section-body">
          {visibleTasks.length > 0 ? (
            <ul className="file-tasks__list">
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} documentPath={documentPath} onOpenFile={onOpenFile} />
              ))}
            </ul>
          ) : null}
          {childSections.map((child) => (
            <SectionNode
              key={child.id}
              section={child}
              collapsed={collapsed}
              predicate={predicate}
              onToggle={onToggle}
              keyPrefix={keyPrefix}
              documentPath={documentPath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * Kanban
 *
 * A "card" is the lowest grouping that directly owns tasks — one level up from
 * an individual checkbox. Hoisting to the group is what gives us a meaningful
 * three-state board: a group with zero done is Not Started, all done is
 * Finished, and anything in between is Started.
 * ------------------------------------------------------------------------- */

export type KanbanStatus = 'notStarted' | 'started' | 'finished'

export const KANBAN_COLUMNS: { id: KanbanStatus; label: string }[] = [
  { id: 'notStarted', label: 'Not Started' },
  { id: 'started', label: 'Started' },
  { id: 'finished', label: 'Finished' },
]

export type TaskCard = {
  id: string
  title: string
  crumbs: string[]
  fileName?: string
  documentPath?: string
  completed: number
  total: number
  tasks: TaskItem[]
}

function shallowCount(section: TaskSection): { total: number; completed: number } {
  let total = 0
  let completed = 0
  for (const task of section.tasks) {
    total += 1
    if (task.checked) {
      completed += 1
    }
  }
  return { total, completed }
}

export function cardStatus(card: { completed: number; total: number }): KanbanStatus {
  if (card.completed === 0) {
    return 'notStarted'
  }
  if (card.completed >= card.total) {
    return 'finished'
  }
  return 'started'
}

export function collectCards(
  root: TaskSection,
  options: { documentPath?: string; fileName?: string } = {},
): TaskCard[] {
  const cards: TaskCard[] = []
  const idBase = options.documentPath ? `${options.documentPath}:` : ''

  const pushCard = (section: TaskSection, title: string, crumbs: string[]) => {
    const { total, completed } = shallowCount(section)
    cards.push({
      id: `${idBase}${section.id}`,
      title,
      crumbs,
      fileName: options.fileName,
      documentPath: options.documentPath,
      completed,
      total,
      tasks: section.tasks,
    })
  }

  // Tasks placed before any heading form an implicit top-level group.
  if (root.tasks.length > 0) {
    pushCard(root, options.fileName ?? 'Ungrouped', [])
  }

  const walk = (section: TaskSection, crumbs: string[]) => {
    for (const child of section.children) {
      const childCrumbs = section.title ? [...crumbs, section.title] : crumbs
      if (child.tasks.length > 0) {
        pushCard(child, child.title ?? 'Ungrouped', childCrumbs)
      }
      walk(child, childCrumbs)
    }
  }
  walk(root, [])

  return cards
}

export function cardMatchesQuery(card: TaskCard, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return true
  }
  if (card.title.toLowerCase().includes(needle)) {
    return true
  }
  if (card.fileName?.toLowerCase().includes(needle)) {
    return true
  }
  if (card.crumbs.some((crumb) => crumb.toLowerCase().includes(needle))) {
    return true
  }
  return card.tasks.some((task) => task.label.toLowerCase().includes(needle))
}

function KanbanCard({
  card,
  showFile,
  onOpenFile,
}: {
  card: TaskCard
  showFile: boolean
  onOpenFile?: (path: string, initialMode?: FileViewerMode) => void
}) {
  const status = cardStatus(card)
  const pct = card.total > 0 ? Math.round((card.completed / card.total) * 100) : 0
  const crumbs = showFile && card.fileName ? [card.fileName, ...card.crumbs] : card.crumbs
  const interactive = Boolean(onOpenFile && card.documentPath)

  const body = (
    <>
      {crumbs.length > 0 ? (
        <span className="file-kanban__card-crumbs">{crumbs.join(' › ')}</span>
      ) : null}
      <span className="file-kanban__card-title">{card.title}</span>
      <span className="file-kanban__card-progress">
        <span className="file-tasks__track" aria-hidden="true">
          <span className="file-tasks__track-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="file-kanban__card-count">
          {card.completed}/{card.total}
        </span>
      </span>
    </>
  )

  const className = `file-kanban__card file-kanban__card--${status}`

  if (interactive && onOpenFile && card.documentPath) {
    const path = card.documentPath
    return (
      <button
        type="button"
        className={className}
        onDoubleClick={() => onOpenFile(path, 'tasks')}
        title={`Open ${path}`}
      >
        {body}
      </button>
    )
  }

  return <div className={className}>{body}</div>
}

export function KanbanBoard({
  cards,
  showFile,
  onOpenFile,
}: {
  cards: TaskCard[]
  showFile: boolean
  onOpenFile?: (path: string, initialMode?: FileViewerMode) => void
}) {
  const byStatus: Record<KanbanStatus, TaskCard[]> = {
    notStarted: [],
    started: [],
    finished: [],
  }
  for (const card of cards) {
    byStatus[cardStatus(card)].push(card)
  }

  return (
    <div className="file-kanban__board">
      {KANBAN_COLUMNS.map((column) => {
        const columnCards = byStatus[column.id]
        return (
          <section key={column.id} className={`file-kanban__column file-kanban__column--${column.id}`}>
            <header className="file-kanban__column-header">
              <span className="file-kanban__column-dot" aria-hidden="true" />
              <span className="file-kanban__column-title">{column.label}</span>
              <span className="file-kanban__column-count">{columnCards.length}</span>
            </header>
            <div className="file-kanban__column-body">
              {columnCards.length === 0 ? (
                <div className="file-kanban__column-empty">No groups</div>
              ) : (
                columnCards.map((card) => (
                  <KanbanCard key={card.id} card={card} showFile={showFile} onOpenFile={onOpenFile} />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
