import type { Terminal } from '@xterm/xterm'

export async function enablePreferredXtermRenderer(terminal: Terminal): Promise<void> {
  // Disabled temporarily to rule out WebGL/GPU rendering issues.
  // Keeping the hook in place makes it easy to restore later.
  void terminal
  return
}
