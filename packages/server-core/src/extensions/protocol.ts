import { Buffer } from 'node:buffer';

export const EXTENSION_HOST_PROTOCOL_VERSION = 1;

interface ExtensionHostFrameBase {
	readonly protocolVersion: 1;
	readonly id: string;
	readonly payload?: unknown;
}

interface ExtensionChildFrameBase {
	readonly protocolVersion: 1;
	readonly id: string;
	readonly payload?: unknown;
}

/** Messages initiated by Server Core. */
export type HostFrame = ExtensionHostFrameBase & {
	readonly kind: HostFrameKind;
};

export const HOST_FRAME_KINDS = [
	'activate',
	'invoke',
	'cancel',
	'deactivate',
	'broker.result',
	/** Start, stop, or re-scope one registered session source. */
	'agent.source.start',
	'agent.source.stop',
	'agent.source.harnesses',
	/** The host's answer to one `agent.source.publish`. */
	'agent.source.ack',
	/** One status, install, or uninstall call on an MCP install target. */
	'mcp.target.invoke',
	'language.request',
	/** Start, stop, re-scope, or notify one worktree insight source. */
	'worktree.source.start',
	'worktree.source.stop',
	'worktree.source.contexts',
	'worktree.source.credential',
] as const;
export type HostFrameKind = (typeof HOST_FRAME_KINDS)[number];

export const CHILD_FRAME_KINDS = [
	'ready',
	'result',
	'failure',
	'broker.request',
	'broker.cancel',
	'deactivated',
	'agent.source.publish',
	'agent.source.diagnostic',
	'agent.source.disposed',
	'mcp.target.disposed',
	'language.diagnostics',
	'language.session.exited',
	'worktree.source.publish',
	'worktree.source.sign-in',
	'worktree.source.disposed',
	'fatal',
] as const;
export type ChildFrameKind = (typeof CHILD_FRAME_KINDS)[number];

/** Messages initiated by an extension child. */
export type ChildFrame = ExtensionChildFrameBase & {
	readonly kind: ChildFrameKind;
};

/**
 * What a child reports about the error that is about to end it.
 *
 * A packaged extension child has no terminal behind its stderr, so an error it
 * does not send here leaves no evidence anywhere. The frame is best effort: a
 * killed child never sends one, and the host records the exit code it observed
 * regardless.
 */
export interface ExtensionFatalErrorReport {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly exitCode: number;
}

export function isExtensionFatalErrorReport(
	value: unknown,
): value is ExtensionFatalErrorReport {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const report = value as Record<string, unknown>;
	return (
		typeof report.name === 'string' &&
		typeof report.message === 'string' &&
		(report.stack === undefined || typeof report.stack === 'string') &&
		typeof report.exitCode === 'number' &&
		Number.isInteger(report.exitCode)
	);
}

export function frameByteLength(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), 'utf8');
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/** Drop AbortSignal and other non-JSON values before child IPC. Electron's
 * `process.send` uses structured clone; a live signal makes the send throw,
 * which the child surfaces as a generic admission failure. */
export function jsonIpcValue(value: unknown): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal)
		return undefined;
	if (Array.isArray(value))
		return value.map((item) => jsonIpcValue(item) ?? null);
	if (typeof value !== 'object') return undefined;
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'signal' && (item === undefined || typeof item === 'object'))
			continue;
		const next = jsonIpcValue(item);
		if (next === undefined) continue;
		result[key] = next;
	}
	return result;
}

export function isHostFrame(value: unknown): value is HostFrame {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const frame = value as Record<string, unknown>;
	return (
		frame.protocolVersion === EXTENSION_HOST_PROTOCOL_VERSION &&
		typeof frame.id === 'string' &&
		frame.id.length > 0 &&
		frame.id.length <= 200 &&
		(HOST_FRAME_KINDS as readonly unknown[]).includes(frame.kind)
	);
}

export function isChildFrame(value: unknown): value is ChildFrame {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const frame = value as Record<string, unknown>;
	return (
		frame.protocolVersion === EXTENSION_HOST_PROTOCOL_VERSION &&
		typeof frame.id === 'string' &&
		frame.id.length > 0 &&
		frame.id.length <= 200 &&
		(CHILD_FRAME_KINDS as readonly unknown[]).includes(frame.kind)
	);
}
