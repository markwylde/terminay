import {
	type JsonValue,
	type PushEnrolment,
	parsePushEnrolment,
	protocolError,
} from '@terminay/protocol';
import type { CommandRequest, OperationRegistries } from '../types.js';
import type { PushSender } from './sender.js';

/** Stable protocol names for push enrolment. */
export const PUSH_OPERATIONS = Object.freeze({
	enrol: 'push.enrol',
	withdraw: 'push.withdraw',
	visibility: 'push.visibility',
} as const);

/**
 * Let a paired device enrol for push, withdraw, and say whether its window is
 * being looked at. Every operation acts on the device the connection was
 * authenticated as and on nothing else: no parameter names a device.
 */
export function createPushOperationRegistry(options: {
	readonly sender: PushSender;
}): { readonly operations: OperationRegistries } {
	const { sender } = options;
	return {
		operations: {
			commands: {
				[PUSH_OPERATIONS.enrol]: (request: CommandRequest) => {
					const deviceId = requireDevice(request);
					let enrolment: PushEnrolment;
					try {
						enrolment = parsePushEnrolment(request.envelope.payload);
					} catch {
						throw protocolError('validation', 'push enrolment is invalid');
					}
					sender.enrol(deviceId, request.context.connectionId, enrolment);
					return { enrolled: true };
				},
				[PUSH_OPERATIONS.withdraw]: (request: CommandRequest) => {
					sender.withdraw(requireDevice(request));
					return { enrolled: false };
				},
				[PUSH_OPERATIONS.visibility]: (request: CommandRequest) => {
					const visible = objectPayload(request.envelope.payload).visible;
					if (typeof visible !== 'boolean')
						throw protocolError('validation', 'visible is invalid');
					// A client with no device, such as Local Desktop, has no
					// enrolment for this to affect.
					const deviceId = request.context.deviceId;
					if (deviceId !== undefined)
						sender.setVisibility(
							deviceId,
							request.context.connectionId,
							visible,
						);
					return { visible };
				},
			},
			policies: {
				[PUSH_OPERATIONS.enrol]: { scope: 'read' },
				[PUSH_OPERATIONS.withdraw]: { scope: 'read' },
				[PUSH_OPERATIONS.visibility]: { scope: 'read' },
			},
		},
	};
}

/** Enrolment belongs to an enrolled device, authenticated on this channel. */
function requireDevice(request: CommandRequest): string {
	const deviceId = request.context.deviceId;
	if (deviceId === undefined || request.context.authScope === 'none')
		throw protocolError('forbidden', 'push enrolment requires a paired device');
	return deviceId;
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'push payload must be an object');
	return value as Record<string, JsonValue>;
}
