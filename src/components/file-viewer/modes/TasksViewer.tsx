import MarkdownIt from 'markdown-it'
import { useMemo, useState } from 'react'
import type { GitFileDiff } from '../../../types/fileViewer'
import {
  type TaskItem,
  type TaskSection,
  type TaskStats,
  computeStats,
  parseTasks,
} from '../tasks/parseTasks'

const inlineMarkdown = new MarkdownIt({ html: false, linkify: true, typographer: true })

type TaskFilter = 'all' | 'remaining' | 'done'

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remaining', label: 'Remaining' },
  { id: 'done', label: 'Done' },
]

type TasksViewerProps = {
  diff: GitFileDiff | null
  text: string
}

function renderLabel(label: string): { __html: string } {
  return { __html: inlineMarkdown.renderInline(label) }
}

function percent(stats: TaskStats): number {
  if (stats.total === 0) {
    return 0
  }
  return Math.round((stats.completed / stats.total) * 100)
}

function matchesFilter(task: TaskItem, filter: TaskFilter): boolean {
  if (filter === 'remaining') {
    return !task.checked
  }
  if (filter === 'done') {
    return task.checked
  }
  return true
}

function sectionHasVisibleTasks(section: TaskSection, filter: TaskFilter): boolean {
  if (section.tasks.some((task) => matchesFilter(task, filter))) {
    return true
  }
  return section.children.some((child) => sectionHasVisibleTasks(child, filter))
}

function collectSectionIds(section: TaskSection, ids: string[] = []): string[] {
  for (const child of section.children) {
    ids.push(child.id)
    collectSectionIds(child, ids)
  }
  return ids
}

function StatsBadge({ stats }: { stats: TaskStats }) {
  const complete = stats.total > 0 && stats.completed === stats.total
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
        {stats.completed}/{stats.total}
      </span>
    </span>
  )
}

function TaskRow({ task }: { task: TaskItem }) {
  return (
    <li
      className={`file-tasks__item${task.checked ? ' file-tasks__item--checked' : ''}${
        task.completedInDiff ? ' file-tasks__item--in-diff' : ''
      }`}
      style={task.depth > 0 ? { marginLeft: `${task.depth * 18}px` } : undefined}
    >
      <input className="file-tasks__checkbox" type="checkbox" checked={task.checked} disabled readOnly />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered from inline markdown with html disabled */}
      <span className="file-tasks__label" dangerouslySetInnerHTML={renderLabel(task.label)} />
    </li>
  )
}

function SectionNode({
  section,
  collapsed,
  filter,
  onToggle,
}: {
  collapsed: Set<string>
  filter: TaskFilter
  onToggle: (id: string) => void
  section: TaskSection
}) {
  if (!sectionHasVisibleTasks(section, filter)) {
    return null
  }

  const stats = computeStats(section)
  const isCollapsed = collapsed.has(section.id)
  const visibleTasks = section.tasks.filter((task) => matchesFilter(task, filter))
  const childSections = section.children.filter((child) => sectionHasVisibleTasks(child, filter))

  return (
    <section className="file-tasks__section">
      <button
        type="button"
        className="file-tasks__section-header"
        onClick={() => onToggle(section.id)}
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
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          ) : null}
          {childSections.map((child) => (
            <SectionNode key={child.id} section={child} collapsed={collapsed} filter={filter} onToggle={onToggle} />
          ))}
        </div>
      )}
    </section>
  )
}

export function TasksViewer({ diff, text }: TasksViewerProps) {
  const tree = useMemo(() => parseTasks(text, diff), [text, diff])
  const allSectionIds = useMemo(() => collectSectionIds(tree.root), [tree])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<TaskFilter>('all')

  const toggle = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allCollapsed = allSectionIds.length > 0 && allSectionIds.every((id) => collapsed.has(id))

  if (tree.stats.total === 0) {
    return (
      <div className="file-tasks file-tasks--empty">
        <div className="file-tasks__empty-title">No tasks found</div>
        <div className="file-tasks__empty-hint">
          Add checkboxes like <code>- [ ] todo</code> or <code>- [x] done</code> to see them here.
        </div>
      </div>
    )
  }

  const { stats } = tree
  const rootTasks = tree.root.tasks.filter((task) => matchesFilter(task, filter))
  const rootChildren = tree.root.children.filter((child) => sectionHasVisibleTasks(child, filter))
  const hasVisible = rootTasks.length > 0 || rootChildren.length > 0

  return (
    <div className="file-tasks">
      <header className="file-tasks__summary">
        <div className="file-tasks__summary-row">
          <div className="file-tasks__summary-metric">
            <span className="file-tasks__summary-value">{percent(stats)}%</span>
            <span className="file-tasks__summary-label">complete</span>
          </div>
          <div className="file-tasks__summary-counts">
            <span className="file-tasks__chip file-tasks__chip--done">{stats.completed} done</span>
            <span className="file-tasks__chip file-tasks__chip--remaining">{stats.remaining} remaining</span>
            {stats.completedInDiff > 0 ? (
              <span className="file-tasks__chip file-tasks__chip--diff">+{stats.completedInDiff} in diff</span>
            ) : null}
          </div>
        </div>
        <div className="file-tasks__summary-bar" aria-hidden="true">
          <span className="file-tasks__summary-bar-fill" style={{ width: `${percent(stats)}%` }} />
        </div>
      </header>

      <div className="file-tasks__toolbar">
        <div className="file-tasks__filter" role="tablist" aria-label="Filter tasks">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              className={`file-tasks__filter-button${filter === option.id ? ' file-tasks__filter-button--active' : ''}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {allSectionIds.length > 0 ? (
          <button
            type="button"
            className="file-tasks__action"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allSectionIds))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        ) : null}
      </div>

      <div className="file-tasks__scroll">
        {!hasVisible ? (
          <div className="file-tasks__filter-empty">
            {filter === 'remaining' ? 'Nothing left — all tasks are complete 🎉' : 'No completed tasks yet.'}
          </div>
        ) : null}
        {rootTasks.length > 0 ? (
          <ul className="file-tasks__list file-tasks__list--root">
            {rootTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        ) : null}
        {rootChildren.map((child) => (
          <SectionNode key={child.id} section={child} collapsed={collapsed} filter={filter} onToggle={toggle} />
        ))}
      </div>
    </div>
  )
}
