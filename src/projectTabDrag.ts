// Pure geometry helpers shared by the multi-window project-tab drag logic.
//
// The main process uses these to decide tear-off / hover hit-testing while
// polling the OS cursor, and the renderer uses computeDropIndex to place the
// in-bar drop placeholder. Keeping them pure (no Electron / DOM deps) lets them
// be unit tested in isolation.

export type DragPoint = { x: number; y: number }
export type DragRect = { x: number; y: number; width: number; height: number }

/** True when the point lies within (inclusive of edges) the rectangle. */
export function pointInRect(point: DragPoint, rect: DragRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Shortest distance from the point to the rectangle (0 when inside). */
export function distanceToRect(point: DragPoint, rect: DragRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

/**
 * Insertion index for a tab dropped at `clientX`, given the sorted center X of
 * each existing tab. The dragged tab slots after every tab whose center is left
 * of the cursor — so 0 means "before all", `tabCenters.length` means "after all".
 */
export function computeDropIndex(tabCenters: number[], clientX: number): number {
  let index = 0
  for (const center of tabCenters) {
    if (clientX > center) {
      index += 1
    }
  }
  return index
}

/** The drag preview widths the host accepts for `workspace.drag.start`. */
export const PROJECT_DRAG_PREVIEW_MIN_WIDTH = 80
export const PROJECT_DRAG_PREVIEW_MAX_WIDTH = 2000

/** A tab's laid-out width as a drag preview width the host accepts. */
export function projectDragPreviewWidth(width: number): number {
  if (!Number.isFinite(width)) return PROJECT_DRAG_PREVIEW_MIN_WIDTH
  return Math.min(
    PROJECT_DRAG_PREVIEW_MAX_WIDTH,
    Math.max(PROJECT_DRAG_PREVIEW_MIN_WIDTH, Math.round(width)),
  )
}

export type NativeProjectDragSession<Start, Decision> = {
  /** True once this drag has asked the host for a native session. */
  readonly requested: boolean
  start(input: Start): void
  /** The host's decision, or null when no native session ran: none was
   * requested, or the host refused to start one. */
  finish(): Promise<Decision | null>
}

/**
 * One in-strip drag's native tear-off session. A start the host refuses is
 * reported once and leaves the drag in-strip, so `end` is never asked about a
 * session that does not exist.
 */
export function createNativeProjectDragSession<Start, Decision>(host: {
  begin(input: Start): Promise<void>
  end(): Promise<Decision>
  onRefused(error: unknown): void
}): NativeProjectDragSession<Start, Decision> {
  let started: Promise<boolean> | null = null
  return {
    get requested() {
      return started !== null
    },
    start(input) {
      if (started !== null) return
      started = host.begin(input).then(
        () => true,
        (error: unknown) => {
          host.onRefused(error)
          return false
        },
      )
    },
    async finish() {
      const pending = started
      started = null
      if (pending === null || !(await pending)) return null
      return host.end()
    },
  }
}
