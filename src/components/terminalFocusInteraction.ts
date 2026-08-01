/**
 * A native window activation can restore focus to the previously active xterm
 * after a pointer down has selected a different Dockview terminal. Keep the
 * recovery scoped to the terminal that received that fresh pointer down. This
 * is presentation-only: it must not write to, resize, or otherwise touch the
 * terminal transport.
 */
export function shouldRestoreTerminalFocusAfterWindowActivation(
  pointerDownAt: unknown,
  now: unknown,
  activationWindowMs = 600,
): boolean {
  if (
    typeof pointerDownAt !== 'number' ||
    !Number.isFinite(pointerDownAt) ||
    typeof now !== 'number' ||
    !Number.isFinite(now) ||
    typeof activationWindowMs !== 'number' ||
    !Number.isFinite(activationWindowMs) ||
    activationWindowMs <= 0
  ) {
    return false
  }

  const elapsed = now - pointerDownAt
  return elapsed >= 0 && elapsed < activationWindowMs
}
