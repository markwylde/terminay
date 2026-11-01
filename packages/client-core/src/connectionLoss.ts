/** Feature facades wrap errors; inspect their bounded cause chain. Generic
 * unavailable refusals are not proof that the connection ended. */
export function isClientConnectionLoss(error: unknown): boolean {
  for (let source = error, depth = 0; source instanceof Error && depth < 4; source = source.cause, depth += 1) {
    const code = (source as { code?: unknown }).code;
    if (source.name === "RequestNotSentError" || source.name === "ClientDisconnectedError" || source.name === "CommandOutcomeUnknownError" || code === "disconnected" || code === "unknown_command_outcome") return true;
  }
  return false;
}
