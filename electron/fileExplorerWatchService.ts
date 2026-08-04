import { watch, type FSWatcher } from 'node:fs'
import { webContents } from 'electron'
import type { FileExplorerWatchEvent } from '../src/types/terminay'
import { normalizeFileViewerPath } from './fileViewer/pathUtils'

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 30_000

type WatchRegistration = {
  paths: Map<string, number>
}

type WatchSubscription = {
  isClosing: boolean
  retryDelayMs: number
  retryTimer: ReturnType<typeof setTimeout> | null
  subscribers: Map<number, number>
  watchPath: string
  watcher: FSWatcher | null
}

export class FileExplorerWatchService {
  private readonly pathsBySubscriber = new Map<number, WatchRegistration>()
  private readonly subscriptionsByPath = new Map<string, WatchSubscription>()

  constructor(private readonly getHomePath: () => string) {}

  watchDirectory(ownerWebContentsId: number, rawPath: string): void {
    const resolvedPath = this.normalizePath(rawPath)
    let subscription = this.subscriptionsByPath.get(resolvedPath)

    if (!subscription) {
      subscription = {
        isClosing: false,
        retryDelayMs: INITIAL_RETRY_DELAY_MS,
        retryTimer: null,
        subscribers: new Map<number, number>(),
        watchPath: rawPath,
        watcher: null,
      }
      this.subscriptionsByPath.set(resolvedPath, subscription)
    }

    subscription.subscribers.set(ownerWebContentsId, (subscription.subscribers.get(ownerWebContentsId) ?? 0) + 1)

    const registration = this.pathsBySubscriber.get(ownerWebContentsId) ?? { paths: new Map<string, number>() }
    registration.paths.set(resolvedPath, (registration.paths.get(resolvedPath) ?? 0) + 1)
    this.pathsBySubscriber.set(ownerWebContentsId, registration)

    if (!subscription.watcher && !subscription.retryTimer && !this.startWatcher(resolvedPath, subscription)) {
      this.scheduleRetry(resolvedPath, subscription)
    }
  }

  unwatchDirectory(ownerWebContentsId: number, rawPath: string): void {
    const resolvedPath = this.normalizePath(rawPath)
    this.removeSubscriberFromPath(ownerWebContentsId, resolvedPath)
  }

  disposeSubscriber(ownerWebContentsId: number): void {
    const registration = this.pathsBySubscriber.get(ownerWebContentsId)
    if (!registration) {
      return
    }

    for (const [watchedPath, count] of Array.from(registration.paths.entries())) {
      for (let index = 0; index < count; index += 1) {
        this.removeSubscriberFromPath(ownerWebContentsId, watchedPath)
      }
    }
  }

  private normalizePath(rawPath: string): string {
    return normalizeFileViewerPath(rawPath, this.getHomePath())
  }

  private startWatcher(resolvedPath: string, subscription: WatchSubscription): boolean {
    if (subscription.watcher) {
      return true
    }

    try {
      subscription.isClosing = false
      const watcher = watch(resolvedPath, { persistent: false }, (_eventType, changedFileName) => {
        void this.broadcast(resolvedPath, {
          entryName: typeof changedFileName === 'string' && changedFileName.length > 0 ? changedFileName : null,
          event: 'changed',
        })
      })

      subscription.watcher = watcher
      subscription.retryDelayMs = INITIAL_RETRY_DELAY_MS

      watcher.on('error', (error) => {
        if (subscription.watcher === watcher) {
          subscription.watcher = null
        }

        try {
          watcher.close()
        } catch {
          // Already closed by the runtime.
        }

        void this.broadcast(resolvedPath, {
          event: 'error',
          message: error.message,
        })
        this.scheduleRetry(resolvedPath, subscription)
      })

      watcher.on('close', () => {
        if (subscription.isClosing) {
          return
        }

        if (subscription.watcher === watcher) {
          subscription.watcher = null
        }
        this.scheduleRetry(resolvedPath, subscription)
      })

      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.broadcast(resolvedPath, {
        event: 'error',
        message,
      })
      return false
    }
  }

  private scheduleRetry(resolvedPath: string, subscription: WatchSubscription): void {
    if (subscription.retryTimer || subscription.subscribers.size === 0) {
      return
    }

    const delayMs = subscription.retryDelayMs
    subscription.retryDelayMs = Math.min(subscription.retryDelayMs * 2, MAX_RETRY_DELAY_MS)
    subscription.retryTimer = setTimeout(() => {
      subscription.retryTimer = null
      if (this.subscriptionsByPath.get(resolvedPath) !== subscription || subscription.subscribers.size === 0) {
        return
      }

      if (this.startWatcher(resolvedPath, subscription)) {
        void this.broadcast(resolvedPath, {
          entryName: null,
          event: 'changed',
        })
      } else {
        this.scheduleRetry(resolvedPath, subscription)
      }
    }, delayMs)
  }

  private removeSubscriberFromPath(ownerWebContentsId: number, resolvedPath: string): void {
    const subscription = this.subscriptionsByPath.get(resolvedPath)
    if (!subscription) {
      return
    }

    const subscriberCount = subscription.subscribers.get(ownerWebContentsId) ?? 0
    if (subscriberCount <= 1) {
      subscription.subscribers.delete(ownerWebContentsId)
    } else {
      subscription.subscribers.set(ownerWebContentsId, subscriberCount - 1)
    }

    if (subscription.subscribers.size === 0) {
      this.closeSubscription(resolvedPath, subscription)
    }

    const registration = this.pathsBySubscriber.get(ownerWebContentsId)
    const registrationCount = registration?.paths.get(resolvedPath) ?? 0
    if (registration && registrationCount <= 1) {
      registration.paths.delete(resolvedPath)
    } else if (registration) {
      registration.paths.set(resolvedPath, registrationCount - 1)
    }
    if (registration && registration.paths.size === 0) {
      this.pathsBySubscriber.delete(ownerWebContentsId)
    }
  }

  private closeSubscription(resolvedPath: string, subscription: WatchSubscription): void {
    subscription.isClosing = true

    if (subscription.retryTimer) {
      clearTimeout(subscription.retryTimer)
      subscription.retryTimer = null
    }

    if (subscription.watcher) {
      subscription.watcher.close()
      subscription.watcher = null
    }

    this.subscriptionsByPath.delete(resolvedPath)
  }

  private async broadcast(resolvedPath: string, payload: Omit<FileExplorerWatchEvent, 'path'>): Promise<void> {
    const subscription = this.subscriptionsByPath.get(resolvedPath)
    if (!subscription) {
      return
    }

    const message: FileExplorerWatchEvent = {
      ...payload,
      path: subscription.watchPath,
    }

    for (const subscriberId of Array.from(subscription.subscribers.keys())) {
      const target = webContents.fromId(subscriberId)
      if (!target || target.isDestroyed()) {
        this.disposeSubscriber(subscriberId)
        continue
      }

      try {
        target.send('file-explorer:watch-event', message)
      } catch {
        this.disposeSubscriber(subscriberId)
      }
    }
  }
}
