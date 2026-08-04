export interface BeforeQuitEvent {
  preventDefault(): void
}

export interface QuitApplication {
  quit(): void
}

/**
 * Turns Electron's synchronous `before-quit` event into one bounded graceful
 * shutdown. The initial quit is held until cleanup settles; the second quit is
 * deliberately allowed through, preventing an async cleanup loop.
 */
export function createGracefulQuitHandler(options: {
  readonly app: QuitApplication
  readonly shutdown: () => Promise<void>
  readonly onShutdownError?: (error: unknown) => void
}): (event: BeforeQuitEvent) => void {
  let cleanupComplete = false
  let shutdownPromise: Promise<void> | undefined

  return (event) => {
    if (cleanupComplete) return
    event.preventDefault()

    if (shutdownPromise !== undefined) return
    shutdownPromise = Promise.resolve()
      .then(options.shutdown)
      .catch((error) => options.onShutdownError?.(error))
      .finally(() => {
        cleanupComplete = true
        options.app.quit()
      })
  }
}
