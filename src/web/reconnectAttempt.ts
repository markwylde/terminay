/**
 * Tracks browser connection intent across the asynchronous reconnect protocol.
 * A forgotten profile invalidates only its own pending attempt; selecting a
 * different server supersedes the old selection.
 */
export type BrowserConnectionAttempt = Readonly<{
  profileId: string
  revision: number
}>

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
