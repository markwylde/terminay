import { STORAGE_FAILURE_REASONS } from "@terminay/protocol";

const REASONS: ReadonlySet<unknown> = new Set(Object.values(STORAGE_FAILURE_REASONS));

/** The server's storage refused a command (ADR-0149). Its message is shown as
 * sent, so test this before rewriting an error by its code. Feature facades
 * wrap errors; their bounded cause chain is searched. */
export function isServerStorageFailure(error: unknown): boolean {
  for (let source = error, depth = 0; source instanceof Error && depth < 4; source = source.cause, depth += 1) {
    const details = (source as { details?: unknown }).details;
    if (typeof details === "object" && details !== null && REASONS.has((details as { reason?: unknown }).reason)) return true;
  }
  return false;
}
