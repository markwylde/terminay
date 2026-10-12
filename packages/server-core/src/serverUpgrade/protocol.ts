import {
	type JsonValue,
	parseServerUpgradeStartRequest,
	protocolError,
	SERVER_UPGRADE_OPERATIONS,
	type ServerUpgradeStartRequest,
} from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
} from '../types.js';
import type { ServerUpgradeService } from './service.js';

export interface ServerUpgradeOperationRegistry {
	readonly operations: OperationRegistries;
	readonly close: () => void;
}

/**
 * Expose the server's upgrade status and the one request a client may make
 * about it through the authenticated application protocol (ADR-0062).
 *
 * The status is a snapshot query and one event per change on the shared
 * journal, so it reaches every attached client and orders like every other
 * server event. The request carries a mode and nothing else. These operations
 * exist only here: no MCP tool and no extension broker reaches them.
 */
export function createServerUpgradeOperationRegistry(options: {
	readonly service: ServerUpgradeService;
	readonly eventJournal: OrderedEventJournalLike;
}): ServerUpgradeOperationRegistry {
	const { service } = options;
	const unsubscribe = service.subscribe((status) => {
		options.eventJournal.append(
			SERVER_UPGRADE_OPERATIONS.event,
			status as unknown as JsonValue,
		);
	});
	return {
		operations: {
			queries: {
				[SERVER_UPGRADE_OPERATIONS.status]: (request: QueryRequest) => {
					if (request.context.authScope === 'none')
						throw protocolError(
							'forbidden',
							'server upgrade status requires read access',
						);
					return service.status as unknown as JsonValue;
				},
			},
			commands: {
				[SERVER_UPGRADE_OPERATIONS.start]: async (request: CommandRequest) => {
					// Upgrading the server is an administrative act of the device
					// this connection was authenticated as.
					if (request.context.authScope !== 'admin')
						throw protocolError(
							'forbidden',
							'starting a server upgrade requires a paired device',
						);
					let parsed: ServerUpgradeStartRequest;
					try {
						parsed = parseServerUpgradeStartRequest(request.envelope.payload);
					} catch {
						throw protocolError(
							'validation',
							'a server upgrade request names a mode and nothing else',
						);
					}
					return (await service.startUpgrade(
						parsed.mode,
					)) as unknown as JsonValue;
				},
			},
			policies: {
				[SERVER_UPGRADE_OPERATIONS.status]: { scope: 'read' },
				[SERVER_UPGRADE_OPERATIONS.start]: { scope: 'admin' },
			},
		},
		close: () => {
			unsubscribe();
		},
	};
}
