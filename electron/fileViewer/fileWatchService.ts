import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { webContents } from 'electron'
import type { FileViewerWatchEvent } from '../../src/types/termide'
import type { FileBufferService } from './fileBufferService'

type WatchRegistration = {
  paths: Set<string>
}

type WatchSubscription = {
  subscribers: Set<number>
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
        subscribers: new Set<number>(),
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

    subscription.subscribers.add(ownerWebContentsId)

    const registration = this.pathsBySubscriber.get(ownerWebContentsId) ?? { paths: new Set<string>() }
    registration.paths.add(resolvedPath)
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

    for (const watchedPath of registration.paths) {
      this.removeSubscriberFromPath(ownerWebContentsId, watchedPath)
    }
  }

  private removeSubscriberFromPath(ownerWebContentsId: number, resolvedPath: string): void {
    const subscription = this.subscriptionsByPath.get(resolvedPath)
    if (!subscription) {
      return
    }

    subscription.subscribers.delete(ownerWebContentsId)
    if (subscription.subscribers.size === 0) {
      subscription.watcher.close()
      this.subscriptionsByPath.delete(resolvedPath)
    }

    const registration = this.pathsBySubscriber.get(ownerWebContentsId)
    registration?.paths.delete(resolvedPath)
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

    for (const subscriberId of subscription.subscribers) {
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
