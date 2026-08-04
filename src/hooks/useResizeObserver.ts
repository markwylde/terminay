import { useEffect, useState } from 'react'

export type ElementSize = {
  width: number
  height: number
}

const INITIAL_SIZE: ElementSize = {
  width: 0,
  height: 0,
}

export function useResizeObserver<T extends Element>(target: T | null) {
  const [size, setSize] = useState<ElementSize>(INITIAL_SIZE)

  useEffect(() => {
    if (!target) {
      setSize(INITIAL_SIZE)
      return
    }

    const updateSize = () => {
      const nextSize = {
        width: target.clientWidth,
        height: target.clientHeight,
      }

      setSize((current) => {
        if (current.width === nextSize.width && current.height === nextSize.height) {
          return current
        }

        return nextSize
      })
    }

    updateSize()

    const observer = new ResizeObserver(() => {
      updateSize()
    })

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [target])

  return size
}
