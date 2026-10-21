import { FEATURE_CAPABILITIES, type JsonValue } from '@terminay/protocol';
import type { CommandRequest, QueryRequest, RequestContext } from './types.js';

/**
 * The server-internal principal an MCP tool acts as when it drives a server
 * operation directly (ADR-0072). An MCP call never rides a client connection:
 * its authority is the caller's capability, decided before the operation runs,
 * so the operation sees this principal with server scope and no project claim.
 * Audits name it, never the client an agent happens to be talking from.
 */
export const MCP_PRINCIPAL = Object.freeze({
	clientId: 'system:mcp',
	connectionId: 'system:mcp',
});

/**
 * Feature capabilities the MCP principal speaks. It starts projects the way
 * the start chooser does, so a project it creates may wait for that choice.
 */
const MCP_PRINCIPAL_CAPABILITIES: readonly string[] = Object.freeze([
	FEATURE_CAPABILITIES.projectStartChoice,
]);

let nextMcpCommand = 0;

/** A query request for one server operation, as the MCP principal. */
export function mcpPrincipalQueryRequest(
	operation: string,
	payload: JsonValue,
	signal: AbortSignal = new AbortController().signal,
): QueryRequest {
	nextMcpCommand += 1;
	const queryId = `mcp:${Date.now().toString(36)}:${nextMcpCommand.toString(36)}`;
	return {
		envelope: { type: 'query', queryId, operation, payload },
		body: new Uint8Array(),
		context: principalContext(signal),
	};
}

function principalContext(signal: AbortSignal): RequestContext {
	return {
		connectionId: MCP_PRINCIPAL.connectionId,
		clientId: MCP_PRINCIPAL.clientId,
		authScope: 'write',
		clientCapabilities: MCP_PRINCIPAL_CAPABILITIES,
		signal,
	};
}

/** A command request for one server operation, as the MCP principal. */
export function mcpPrincipalCommandRequest(
	operation: string,
	payload: JsonValue,
	signal: AbortSignal = new AbortController().signal,
	/** The revision the request was planned against; a stale one conflicts. */
	expectedRevision?: number,
): CommandRequest {
	nextMcpCommand += 1;
	const commandId = `mcp:${Date.now().toString(36)}:${nextMcpCommand.toString(36)}`;
	const context = principalContext(signal);
	return {
		envelope: {
			type: 'command',
			commandId,
			correlationId: commandId,
			operation,
			payload,
			...(expectedRevision === undefined ? {} : { expectedRevision }),
		},
		body: new Uint8Array(),
		context,
	};
}
