import type { EnrollmentPushMessage } from '@terminay/protocol'

/** Shared API shape for privileged Desktop enrollment. Browser sessions never
 * receive this bootstrap API; their session origin owns it. */
export type RemoteApiTransport = {
  postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse>
  /** Resolve with the host's decision for one pending approval. Only a
   * transport-authenticated lane can deliver it; loopback HTTP has none. */
  waitForEnrollmentDecision?(
    approvalId: string,
    options: Readonly<{ expiresAt: number; signal?: AbortSignal }>,
  ): Promise<EnrollmentPushMessage>
}
