import type { Terminal } from '@xterm/xterm'

const TOUCH_SCROLL_THRESHOLD_PX = 6

export function bindTerminalTouchScroll(root: HTMLElement, terminal: Terminal): () => void {
  let touchId: number | null = null
  let lastY = 0
  let remainder = 0
  let dragging = false

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    const screen = root.querySelector<HTMLElement>('.xterm-screen')
    if (!(event.target instanceof Node) || screen === null || !screen.contains(event.target)) return
    const touch = event.touches[0]
    if (!touch) return
    touchId = touch.identifier
    lastY = touch.clientY
    remainder = 0
    dragging = false
  }

  const onTouchMove = (event: TouchEvent) => {
    if (touchId === null) return
    const touch = Array.from(event.touches).find((candidate) => candidate.identifier === touchId)
    if (!touch) return
    const delta = touch.clientY - lastY
    lastY = touch.clientY
    remainder += delta
    if (!dragging && Math.abs(remainder) < TOUCH_SCROLL_THRESHOLD_PX) return
    dragging = true
    event.preventDefault()

    const screenHeight = root.querySelector<HTMLElement>('.xterm-screen')?.getBoundingClientRect().height ?? 0
    const rowHeight = screenHeight > 0 && terminal.rows > 0 ? screenHeight / terminal.rows : 16
    const lines = Math.trunc(remainder / rowHeight)
    if (lines === 0) return
    terminal.scrollLines(-lines)
    remainder -= lines * rowHeight
  }

  const finish = () => {
    touchId = null
    remainder = 0
    dragging = false
  }

  root.addEventListener('touchstart', onTouchStart, { passive: true })
  root.addEventListener('touchmove', onTouchMove, { passive: false })
  root.addEventListener('touchend', finish, { passive: true })
  root.addEventListener('touchcancel', finish, { passive: true })
  return () => {
    root.removeEventListener('touchstart', onTouchStart)
    root.removeEventListener('touchmove', onTouchMove)
    root.removeEventListener('touchend', finish)
    root.removeEventListener('touchcancel', finish)
  }
}
