/**
 * Tracks browser connection intent across the asynchronous reconnect protocol.
 * A forgotten profile invalidates only its own pending attempt; selecting a
 * different server supersedes the old selection.
 */
export type BrowserConnectionAttempt = Readonly<{
  profileId: string
  revision: number
}>

export type BrowserRecoveryClock = Readonly<{
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, delayMs: number): unknown
}>

const browserRecoveryClock: BrowserRecoveryClock = {
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
}

/** Runs one browser recovery acquisition with both generation cancellation and
 * a hard deadline. The abort race also bounds APIs such as IndexedDB wrappers
 * which cannot consume an AbortSignal themselves. */
export async function runBoundedBrowserRecoveryStep<T>(options: Readonly<{
  clock?: BrowserRecoveryClock
  label: string
  operation(signal: AbortSignal): Promise<T>
  signal: AbortSignal
  timeoutMs?: number
}>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('browser recovery timeout must be a positive integer')
  const clock = options.clock ?? browserRecoveryClock
  const controller = new AbortController()
  const abortFromAttempt = () => controller.abort(abortReason(options.signal))
  if (options.signal.aborted) throw abortReason(options.signal)
  options.signal.addEventListener('abort', abortFromAttempt, { once: true })
  const timer = clock.setTimeout(
    () => controller.abort(new Error(`${options.label} timed out after ${timeoutMs}ms`)),
    timeoutMs,
  )
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const rejectWhenAborted = () => rejectAbort(abortReason(controller.signal))
  controller.signal.addEventListener('abort', rejectWhenAborted, { once: true })
  if (controller.signal.aborted) rejectWhenAborted()
  try {
    return await Promise.race([
      Promise.resolve().then(() => options.operation(controller.signal)),
      aborted,
    ])
  } finally {
    clock.clearTimeout(timer)
    options.signal.removeEventListener('abort', abortFromAttempt)
    controller.signal.removeEventListener('abort', rejectWhenAborted)
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Connection recovery was cancelled.', 'AbortError')
}

export class BrowserConnectionAttemptGate {
  private current: BrowserConnectionAttempt = { profileId: '', revision: 0 }

  begin(profileId: string): BrowserConnectionAttempt {
    const attempt = Object.freeze({ profileId, revision: this.current.revision + 1 })
    this.current = attempt
    return attempt
  }

  invalidate(profileId: string): void {
    if (this.current.profileId !== profileId) return
    this.current = { profileId: '', revision: this.current.revision + 1 }
  }

  isCurrent(attempt: BrowserConnectionAttempt): boolean {
    return this.current.profileId === attempt.profileId && this.current.revision === attempt.revision
  }
}
