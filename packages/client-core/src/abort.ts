/** Keep pre-send and in-flight cancellation observably identical. */
export function abortError(signal?: AbortSignal): Error | undefined {
  if (!signal?.aborted) return undefined;
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}
