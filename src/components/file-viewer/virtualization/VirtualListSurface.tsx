import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useResizeObserver } from '../../../hooks/useResizeObserver'
import { cx } from '../helpers'

type VirtualItem<T> = {
  item: T
  index: number
  start: number
  size: number
}

export type VirtualListSurfaceProps<T> = {
  items: T[]
  className?: string
  contentClassName?: string
  estimateSize: (item: T, index: number) => number
  overscan?: number
  getKey: (item: T, index: number) => string
  renderItem: (item: VirtualItem<T>) => ReactNode
  emptyState?: ReactNode
}

export function VirtualListSurface<T>({
  items,
  className,
  contentClassName,
  estimateSize,
  overscan = 6,
  getKey,
  renderItem,
  emptyState = null,
}: VirtualListSurfaceProps<T>) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    setViewportElement(element)
  }, [])
  const { height: viewportHeight } = useResizeObserver(viewportElement)
  const [scrollTop, setScrollTop] = useState(0)

  const measurements = useMemo(() => {
    const offsets: number[] = new Array(items.length)
    let totalSize = 0

    for (const [index, item] of items.entries()) {
      offsets[index] = totalSize
      totalSize += estimateSize(item, index)
    }

    return {
      offsets,
      totalSize,
    }
  }, [estimateSize, items])

  const visibleItems = useMemo(() => {
    if (items.length === 0) {
      return []
    }

    const viewportLimit = scrollTop + viewportHeight
    let startIndex = 0

    while (
      startIndex < items.length &&
      measurements.offsets[startIndex] + estimateSize(items[startIndex], startIndex) < scrollTop
    ) {
      startIndex += 1
    }

    let endIndex = startIndex

    while (endIndex < items.length && measurements.offsets[endIndex] < viewportLimit) {
      endIndex += 1
    }

    const safeStart = Math.max(0, startIndex - overscan)
    const safeEnd = Math.min(items.length, endIndex + overscan)

    return items.slice(safeStart, safeEnd).map((item, sliceIndex) => {
      const index = safeStart + sliceIndex
      const start = measurements.offsets[index]
      const size = estimateSize(item, index)

      return {
        item,
        index,
        start,
        size,
      }
    })
  }, [estimateSize, items, measurements.offsets, overscan, scrollTop, viewportHeight])

  if (items.length === 0) {
    return <div className={cx('file-viewer-virtual-surface', className)}>{emptyState}</div>
  }

  return (
    <div
      ref={viewportRef}
      className={cx('file-viewer-virtual-surface', className)}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className={cx('file-viewer-virtual-surface__content', contentClassName)}
        style={{ height: measurements.totalSize }}
      >
        {visibleItems.map((virtualItem) => (
          <div
            key={getKey(virtualItem.item, virtualItem.index)}
            className="file-viewer-virtual-surface__row"
            style={{
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(virtualItem)}
          </div>
        ))}
      </div>
    </div>
  )
}
