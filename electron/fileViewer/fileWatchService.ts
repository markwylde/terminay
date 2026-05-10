import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { webContents } from 'electron'
import type { FileViewerWatchEvent } from '../../src/types/terminay'
import type { FileBufferService } from './fileBufferService'

type WatchRegistration = {
  paths: Map<string, number>
}

type WatchSubscription = {
  subscribers: Map<number, number>
  watcher: FSWatcher
}

export class FileWatchService {
  private readonly subscriptionsByPath = new Map<string, WatchSubscription>()
  private readonly pathsBySubscriber = new Map<number, WatchRegistration>()

  constructor(private readonly fileBufferService: FileBufferService) {}

  async watchFile(ownerWebContentsId: number, rawPath: string): Promise<void> {
    const resolvedPath = this.fileBufferService.normalizePath(rawPath)
    let subscription = this.subscriptionsByPath.get(resolvedPath)

    if (!subscription) {
      const directoryPath = path.dirname(resolvedPath)
      const fileName = path.basename(resolvedPath)
      const watcher = watch(directoryPath, { persistent: false }, (eventType, changedFileName) => {
        if (typeof changedFileName === 'string' && changedFileName.length > 0 && changedFileName !== fileName) {
          return
        }

        void this.handleWatchEvent(resolvedPath, eventType)
      })
      subscription = {
        subscribers: new Map<number, number>(),
        watcher,
      }
      watcher.on('error', (error) => {
        void this.broadcast({
          event: 'error',
          exists: false,
          info: null,
          message: error.message,
          path: resolvedPath,
        })
      })
      this.subscriptionsByPath.set(resolvedPath, subscription)
    }

    subscription.subscribers.set(ownerWebContentsId, (subscription.subscribers.get(ownerWebContentsId) ?? 0) + 1)

    const registration = this.pathsBySubscriber.get(ownerWebContentsId) ?? { paths: new Map<string, number>() }
    registration.paths.set(resolvedPath, (registration.paths.get(resolvedPath) ?? 0) + 1)
    this.pathsBySubscriber.set(ownerWebContentsId, registration)
  }

  async unwatchFile(ownerWebContentsId: number, rawPath: string): Promise<void> {
    const resolvedPath = this.fileBufferService.normalizePath(rawPath)
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
      subscription.watcher.close()
      this.subscriptionsByPath.delete(resolvedPath)
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

  private async handleWatchEvent(resolvedPath: string, eventType: 'change' | 'rename'): Promise<void> {
    const info = await this.fileBufferService.getFileInfo(resolvedPath)
    const payload: FileViewerWatchEvent = {
      event: eventType === 'change' ? 'changed' : info.exists ? 'renamed' : 'deleted',
      exists: info.exists,
      info: info.exists ? info : null,
      path: resolvedPath,
    }

    await this.broadcast(payload)
  }

  private async broadcast(payload: FileViewerWatchEvent): Promise<void> {
    const subscription = this.subscriptionsByPath.get(payload.path)
    if (!subscription) {
      return
    }

    for (const subscriberId of Array.from(subscription.subscribers.keys())) {
      const target = webContents.fromId(subscriberId)
      if (!target || target.isDestroyed()) {
        this.disposeSubscriber(subscriberId)
        continue
      }

      try {
        target.send('file:watch-event', payload)
      } catch {
        this.disposeSubscriber(subscriberId)
      }
    }
  }
}
