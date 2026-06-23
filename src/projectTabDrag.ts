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
