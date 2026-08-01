import type { JsonValue } from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';

export const MCP_SERVER_CONTROL_OPERATIONS = Object.freeze({
	list: 'mcp.servers.list',
	control: 'mcp.servers.control',
});

export type McpServerState = 'running' | 'stopped' | 'failed' | 'installing';
export type McpServerAction = 'start' | 'stop' | 'retry';

export interface McpServerStatus {
	readonly id: string;
	readonly label: string;
	readonly state: McpServerState;
	readonly detail?: string;
}

export interface McpServerControlAcknowledgement {
	readonly serverId: string;
	readonly state: McpServerState;
	readonly acknowledged: true;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class McpServerControlClient {
	constructor(private readonly transport: QueryCommandTransport) {}

	async list(options: QueryOptions = {}): Promise<readonly McpServerStatus[]> {
		const value = await this.transport.query<JsonValue>(
			MCP_SERVER_CONTROL_OPERATIONS.list,
			{},
			options,
		);
		if (
			!isRecord(value) ||
			!Array.isArray(value.servers) ||
			value.servers.length > 100
		)
			throw new TypeError('MCP server list is invalid');
		return Object.freeze(value.servers.map(validateServer));
	}

	async control(
		serverId: string,
		action: McpServerAction,
		options: CommandOptions = {},
	): Promise<McpServerControlAcknowledgement> {
		if (!SAFE_ID.test(serverId))
			throw new TypeError('MCP server id is invalid');
		if (!['start', 'stop', 'retry'].includes(action))
			throw new TypeError('MCP server action is invalid');
		const value = await this.transport.command<JsonValue>(
			MCP_SERVER_CONTROL_OPERATIONS.control,
			{ serverId, action },
			options,
		);
		if (
			!isRecord(value) ||
			value.serverId !== serverId ||
			value.acknowledged !== true ||
			!isState(value.state)
		) {
			throw new TypeError('MCP server acknowledgement is invalid');
		}
		return Object.freeze({ serverId, state: value.state, acknowledged: true });
	}
}

function validateServer(value: JsonValue): McpServerStatus {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!SAFE_ID.test(value.id) ||
		typeof value.label !== 'string' ||
		value.label.length === 0 ||
		value.label.length > 160 ||
		!isState(value.state) ||
		(value.detail !== undefined &&
			(typeof value.detail !== 'string' || value.detail.length > 240))
	) {
		throw new TypeError('MCP server status is invalid');
	}
	return Object.freeze({
		id: value.id,
		label: value.label,
		state: value.state,
		...(value.detail === undefined ? {} : { detail: value.detail }),
	});
}

function isState(value: unknown): value is McpServerState {
	return (
		value === 'running' ||
		value === 'stopped' ||
		value === 'failed' ||
		value === 'installing'
	);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
