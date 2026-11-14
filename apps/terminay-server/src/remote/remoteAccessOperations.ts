import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	CommandRequest,
	OrderedEventJournalLike,
	QueryRequest,
} from '@terminay/server-core';
import type { StandaloneRemoteAccess } from './standaloneRemoteAccess.js';

export const REMOTE_ACCESS_CHANGED_EVENT = 'remote-access.changed';

type RemoteAccessOperationRegistry = Readonly<{
	queries: Readonly<
		Record<string, (request: QueryRequest) => Promise<JsonValue>>
	>;
	commands: Readonly<
		Record<string, (request: CommandRequest) => Promise<JsonValue>>
	>;
}>;

/**
 * The standalone server's `remote-access.*` operations (ADR-0120), the same
 * set and payloads Desktop's embedded server serves. The controller is looked
 * up per request because the composition is built before exposure starts.
 */
export function createRemoteAccessOperations(
	controller: () => StandaloneRemoteAccess | undefined,
): RemoteAccessOperationRegistry {
	const authorized = (request: QueryRequest | CommandRequest) => {
		if (request.context.authScope !== 'admin')
			throw protocolError(
				'forbidden',
				'managing remote access requires administrative access to this server',
			);
		const current = controller();
		if (current === undefined)
			throw protocolError('unavailable', 'remote access is not ready yet');
		return current;
	};
	const command =
		(
			run: (
				remote: StandaloneRemoteAccess,
				request: CommandRequest,
			) => Promise<unknown>,
		) =>
		async (request: CommandRequest): Promise<JsonValue> => {
			const remote = authorized(request);
			await run(remote, request);
			return remote.status() as unknown as JsonValue;
		};
	return Object.freeze({
		queries: Object.freeze({
			'remote-access.status': async (request: QueryRequest) =>
				authorized(request).status() as unknown as JsonValue,
		}),
		commands: Object.freeze({
			'remote-access.toggle-server': async (request: CommandRequest) =>
				(await authorized(request).toggle()) as unknown as JsonValue,
			'remote-access.create-pairing-link': async (request: CommandRequest) =>
				(await authorized(request).createPairingLink()) as unknown as JsonValue,
			'remote-access.revoke-device': command((remote, request) =>
				remote.revokeDevice(payloadText(request, 'deviceId')),
			),
			'remote-access.close-connection': command((remote, request) =>
				remote.closeConnection(payloadText(request, 'connectionId')),
			),
			'remote-access.approve-device': command((remote, request) =>
				remote.approveDevice(payloadText(request, 'approvalId')),
			),
			'remote-access.deny-device': command((remote, request) =>
				remote.denyDevice(payloadText(request, 'approvalId')),
			),
			'remote-access.reset-identity': async (request: CommandRequest) =>
				(await authorized(request).resetIdentity()) as unknown as JsonValue,
		}),
	});
}

/** Publish every controller change as `remote-access.changed`. */
export function publishRemoteAccessChanges(
	controller: StandaloneRemoteAccess,
	eventJournal: OrderedEventJournalLike,
): () => void {
	return controller.onChange(() => {
		eventJournal.append(REMOTE_ACCESS_CHANGED_EVENT, { changed: true });
	});
}

function payloadText(request: CommandRequest, key: string): string {
	const payload = request.envelope.payload;
	const value =
		typeof payload === 'object' && payload !== null && !Array.isArray(payload)
			? (payload as Record<string, unknown>)[key]
			: undefined;
	if (typeof value !== 'string' || value.length === 0 || value.length > 512)
		throw protocolError('validation', `${key} is invalid`);
	return value;
}
