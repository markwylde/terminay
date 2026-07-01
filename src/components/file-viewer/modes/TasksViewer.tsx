import { useMemo, useState } from 'react'
import type { GitFileDiff } from '../../../types/fileViewer'
import { parseTasks } from '../tasks/parseTasks'
import {
  KanbanBoard,
  NO_COLLAPSE,
  SectionNode,
  StatTile,
  TASK_SORT_OPTIONS,
  type TaskFilter,
  TaskCallout,
  TaskHero,
  TaskRow,
  TaskToolbar,
  type TaskSort,
  type TaskView,
  buildPredicate,
  cardMatchesQuery,
  collectCards,
  collectSectionIds,
  isComplete,
  sectionHasVisibleTasks,
  sortTaskCards,
  sortTaskSections,
} from '../tasks/taskView'

type TasksViewerProps = {
  diff: GitFileDiff | null
  text: string
}

export function TasksViewer({ diff, text }: TasksViewerProps) {
  const tree = useMemo(() => parseTasks(text, diff), [text, diff])
  const allSectionIds = useMemo(() => collectSectionIds(tree.root), [tree])
  const cards = useMemo(() => collectCards(tree.root), [tree])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<TaskView>('list')
  const [sort, setSort] = useState<TaskSort>('progress')

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
  const isSearching = query.trim().length > 0
  const activeCollapsed = isSearching ? NO_COLLAPSE : collapsed
  const predicate = buildPredicate(filter, query)
  const rootTasks = tree.root.tasks.filter(predicate)
  const rootChildren = sortTaskSections(
    tree.root.children.filter((child) => sectionHasVisibleTasks(child, predicate)),
    sort,
  )
  const hasVisible = rootTasks.length > 0 || rootChildren.length > 0
  const complete = isComplete(stats)
  const visibleCards = sortTaskCards(cards, sort).filter((card) => cardMatchesQuery(card, query))
  const isKanban = view === 'kanban'

  return (
    <div className="file-tasks">
      <TaskHero stats={stats}>
        <StatTile tone="done" value={stats.completed} label="done" />
        <StatTile tone="remaining" value={stats.remaining} label="remaining" />
        <StatTile tone="total" value={stats.total} label="total" />
        {stats.completedInDiff > 0 ? (
          <span className="file-tasks__chip file-tasks__chip--diff" title="Newly completed in the working-tree diff">
            +{stats.completedInDiff} in diff
          </span>
        ) : null}
      </TaskHero>

      {complete ? (
        <TaskCallout tone="success" icon="🎉">
          All {stats.total} tasks complete — nothing left to do.
        </TaskCallout>
      ) : stats.completedInDiff > 0 ? (
        <TaskCallout tone="diff" icon="✨">
          {stats.completedInDiff} task{stats.completedInDiff === 1 ? '' : 's'} checked off in your working changes since the
          last commit.
        </TaskCallout>
      ) : null}

      <TaskToolbar
        view={view}
        onViewChange={setView}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        showFilter={!isKanban}
      >
        <select
          className="file-tasks__sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as TaskSort)}
          aria-label="Sort task groups"
        >
          {TASK_SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {!isKanban && allSectionIds.length > 0 ? (
          <button
            type="button"
            className="file-tasks__action"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allSectionIds))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        ) : null}
      </TaskToolbar>

      <div className="file-tasks__scroll">
        {isKanban ? (
          visibleCards.length > 0 ? (
            <KanbanBoard cards={visibleCards} showFile={false} />
          ) : (
            <div className="file-tasks__filter-empty">
              {isSearching ? `No groups match “${query.trim()}”.` : 'No task groups to show.'}
            </div>
          )
        ) : (
          <>
            {!hasVisible ? (
              <div className="file-tasks__filter-empty">
                {isSearching
                  ? `No tasks match “${query.trim()}”.`
                  : filter === 'remaining'
                    ? 'Nothing left — all tasks are complete 🎉'
                    : 'No completed tasks yet.'}
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
              <SectionNode
                key={child.id}
                section={child}
                collapsed={activeCollapsed}
                predicate={predicate}
                onToggle={toggle}
                sort={sort}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
