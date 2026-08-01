import type { TerminalAcceptedInput } from "../terminalService/inputSources.js";
import type { RecordingService } from "./service.js";

/**
 * Connects the single server PTY-input boundary to recording capture. The
 * source label is deliberately not persisted: all six input sources share the
 * same capture consent and sensitive-input policy in RecordingService.
 */
export function createRecordingInputCapture(service: Pick<RecordingService, "appendInput">): (event: TerminalAcceptedInput) => void {
  return (event) => {
    service.appendInput(event.identity.sessionId, new TextDecoder().decode(event.data));
  };
}
