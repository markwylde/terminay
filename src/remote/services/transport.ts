/** Shared API shape for privileged Desktop enrollment. Browser sessions never
 * receive this bootstrap API; their session origin owns it. */
export type RemoteApiTransport = { postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> };
