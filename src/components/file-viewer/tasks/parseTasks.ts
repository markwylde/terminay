import type { GitFileDiff } from '../../../types/fileViewer'

export type TaskItem = {
  /** Stable identity within the document (line index based). */
  id: string
  label: string
  checked: boolean
  depth: number
  lineNumber: number
  /** Newly checked (or newly added already-checked) compared with the committed file. */
  completedInDiff: boolean
}

export type TaskStats = {
  total: number
  completed: number
  remaining: number
  /** Net completions gained in the working-tree diff. */
  completedInDiff: number
}

export type TaskSection = {
  id: string
  title: string | null
  level: number
  tasks: TaskItem[]
  children: TaskSection[]
}

export type TaskTree = {
  root: TaskSection
  stats: TaskStats
}

const HEADING_PATTERN = /^(#{1,6})\s+(.*\S)\s*$/
const TASK_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

function indentWidth(indent: string): number {
  let width = 0
  for (const character of indent) {
    width += character === '\t' ? 2 : 1
  }
  return width
}

type DiffTaskMarkers = {
  /** Labels added (in the new file) as checked. */
  addedChecked: Set<string>
  /** Labels removed (from the old file) that were unchecked. */
  removedUnchecked: Set<string>
  /** Every label that existed as a task in the old file. */
  removedAny: Set<string>
}

function collectDiffMarkers(diff: GitFileDiff | null): DiffTaskMarkers {
  const addedChecked = new Set<string>()
  const removedUnchecked = new Set<string>()
  const removedAny = new Set<string>()

  if (!diff || diff.isBinary) {
    return { addedChecked, removedUnchecked, removedAny }
  }

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        continue
      }
      const match = TASK_PATTERN.exec(line.value)
      if (!match) {
        continue
      }
      const checked = match[2].toLowerCase() === 'x'
      const label = normalizeLabel(match[3])
      if (!label) {
        continue
      }
      if (line.type === 'add') {
        if (checked) {
          addedChecked.add(label)
        }
      } else {
        removedAny.add(label)
        if (!checked) {
          removedUnchecked.add(label)
        }
      }
    }
  }

  return { addedChecked, removedUnchecked, removedAny }
}

/**
 * A current task counts as "completed in diff" when it is now checked and either
 * it flipped from unchecked, or it is a brand-new checked task — both represent a
 * completion gained since the last commit.
 */
function isCompletedInDiff(label: string, checked: boolean, markers: DiffTaskMarkers): boolean {
  if (!checked) {
    return false
  }
  const normalized = normalizeLabel(label)
  if (!normalized || !markers.addedChecked.has(normalized)) {
    return false
  }
  return markers.removedUnchecked.has(normalized) || !markers.removedAny.has(normalized)
}

export function parseTasks(text: string, diff: GitFileDiff | null = null): TaskTree {
  const markers = collectDiffMarkers(diff)
  const root: TaskSection = { id: 'section-root', title: null, level: 0, tasks: [], children: [] }
  const sectionStack: TaskSection[] = [root]
  const indentStack: number[] = []
  let inFence = false
  let fenceMarker = ''

  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]

    const fenceMatch = FENCE_PATTERN.exec(rawLine)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) {
      continue
    }

    const headingMatch = HEADING_PATTERN.exec(rawLine)
    if (headingMatch) {
      const level = headingMatch[1].length
      const section: TaskSection = {
        id: `section-${index}`,
        title: headingMatch[2].trim(),
        level,
        tasks: [],
        children: [],
      }
      while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].level >= level) {
        sectionStack.pop()
      }
      sectionStack[sectionStack.length - 1].children.push(section)
      sectionStack.push(section)
      indentStack.length = 0
      continue
    }

    const taskMatch = TASK_PATTERN.exec(rawLine)
    if (!taskMatch) {
      continue
    }

    const width = indentWidth(taskMatch[1])
    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= width) {
      indentStack.pop()
    }
    const depth = indentStack.length
    indentStack.push(width)

    const checked = taskMatch[2].toLowerCase() === 'x'
    const label = taskMatch[3].trim()
    const task: TaskItem = {
      id: `task-${index}`,
      label,
      checked,
      depth,
      lineNumber: index + 1,
      completedInDiff: isCompletedInDiff(label, checked, markers),
    }
    sectionStack[sectionStack.length - 1].tasks.push(task)
  }

  return { root, stats: computeStats(root) }
}

export function computeStats(section: TaskSection): TaskStats {
  let total = 0
  let completed = 0
  let completedInDiff = 0

  for (const task of section.tasks) {
    total += 1
    if (task.checked) {
      completed += 1
    }
    if (task.completedInDiff) {
      completedInDiff += 1
    }
  }

  for (const child of section.children) {
    const childStats = computeStats(child)
    total += childStats.total
    completed += childStats.completed
    completedInDiff += childStats.completedInDiff
  }

  return { total, completed, remaining: total - completed, completedInDiff }
}
