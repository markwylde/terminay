import type {
	BotObservationSource,
	BotSourceMatch,
	BotTriggerCondition,
	BotTriggerSchedule,
} from '@terminay/protocol';
import { BotError, object, text } from './store.js';
export function exact(
	d: Record<string, unknown>,
	keys: readonly string[],
): void {
	if (Object.keys(d).some((k) => !keys.includes(k)))
		throw new BotError('validation', 'Unknown source field');
}
export function integer(
	v: unknown,
	min: number,
	max: number,
	name: string,
): number {
	if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max)
		throw new BotError('validation', `Invalid ${name} (${min}–${max})`);
	return v as number;
}
export function pointer(v: unknown): string {
	const s = text(v, 1024, 'JSON Pointer', true);
	if (s !== '' && (!s.startsWith('/') || /~(?:[^01]|$)/.test(s)))
		throw new BotError('validation', 'Invalid JSON Pointer');
	return s;
}
function path(v: unknown): string {
	const s = text(v, 4096, 'container path');
	if (!s.startsWith('/'))
		throw new BotError('validation', 'Use an absolute container path');
	return s;
}
export function sourceMatch(value: unknown): BotSourceMatch {
	const d = object(value);
	exact(d, ['kind', 'text', 'repeat', 'code', 'items', 'identity', 'initial']);
	if (d.repeat !== undefined && typeof d.repeat !== 'boolean')
		throw new BotError('validation', 'Invalid repeat');
	if (d.kind === 'changed') {
		exact(d, ['kind']);
		return { kind: 'changed' };
	}
	if (d.kind === 'contains' || d.kind === 'regex')
		return {
			kind: d.kind,
			text: text(d.text, 4096, 'match text'),
			repeat: d.repeat === true,
		};
	if (d.kind === 'exit')
		return {
			kind: 'exit',
			code: integer(d.code, 0, 255, 'exit code'),
			repeat: d.repeat === true,
		};
	if (d.kind === 'items') {
		if (
			d.initial !== undefined &&
			!['process', 'baseline'].includes(String(d.initial))
		)
			throw new BotError('validation', 'Invalid first observation');
		return {
			kind: 'items',
			items: pointer(d.items ?? ''),
			identity: pointer(d.identity ?? '/id'),
			initial: d.initial === 'baseline' ? 'baseline' : 'process',
		};
	}
	throw new BotError('validation', 'Invalid source condition');
}
export function observationSource(
	value: unknown,
	anchor: number,
): BotObservationSource {
	const d = object(value);
	if (d.kind === 'files') {
		exact(d, ['kind', 'path', 'recursive', 'include', 'exclude', 'debounceMs']);
		if (d.recursive !== undefined && typeof d.recursive !== 'boolean')
			throw new BotError('validation', 'Invalid recursive');
		return {
			kind: 'files',
			path: path(d.path),
			recursive: d.recursive !== false,
			include: text(d.include ?? '', 1024, 'include', true),
			exclude: text(d.exclude ?? '', 1024, 'exclude', true),
			debounceMs: integer(d.debounceMs ?? 5000, 0, 60000, 'debounce'),
		};
	}
	if (d.kind !== 'command' && d.kind !== 'http' && d.kind !== 'sse')
		throw new BotError('validation', 'Invalid source');
	const periodic = d.kind !== 'sse';
	const period = periodic
		? {
				intervalMs: integer(
					d.intervalMs,
					60000,
					2_147_483_647,
					'interval (minimum 1 minute)',
				),
				anchor,
				timeoutMs: integer(d.timeoutMs ?? 30000, 1000, 300000, 'timeout'),
			}
		: {};
	if (d.kind === 'command') {
		exact(d, [
			'kind',
			'command',
			'cwd',
			'intervalMs',
			'anchor',
			'timeoutMs',
			'match',
		]);
		return {
			kind: 'command',
			command: text(d.command, 32768, 'command'),
			cwd: path(d.cwd ?? '/home/bot'),
			...period,
			match: sourceMatch(d.match),
		} as BotObservationSource;
	}
	exact(
		d,
		d.kind === 'http'
			? [
					'kind',
					'url',
					'headers',
					'intervalMs',
					'anchor',
					'timeoutMs',
					'select',
					'match',
				]
			: ['kind', 'url', 'headers', 'eventName'],
	);
	const url = text(d.url, 8192, 'URL');
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new BotError('validation', 'Invalid URL');
	}
	if (
		!['http:', 'https:'].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password
	)
		throw new BotError('validation', 'Use an HTTP(S) URL without credentials');
	const headers: Record<string, string> = {};
	if (d.headers !== undefined)
		for (const [k, v] of Object.entries(object(d.headers))) {
			if (
				!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(k) ||
				/^(host|content-length|connection|transfer-encoding)$/i.test(k)
			)
				throw new BotError('validation', 'Invalid header name');
			const safe = text(v, 8192, 'header', true);
			if (/[\r\n]/.test(safe))
				throw new BotError('validation', 'Invalid header value');
			headers[k] = safe;
		}
	if (Object.keys(headers).length > 32)
		throw new BotError('validation', 'At most 32 headers');
	if (d.kind === 'sse')
		return {
			kind: 'sse',
			url,
			headers,
			eventName: text(d.eventName ?? '', 256, 'event name', true),
		};
	const match = sourceMatch(d.match ?? { kind: 'changed' });
	if (match.kind === 'exit' || match.kind === 'regex')
		throw new BotError('validation', 'Exit code and regular expressions apply to commands');
	return {
		kind: 'http',
		url,
		headers,
		...period,
		select: pointer(d.select ?? ''),
		match,
	} as BotObservationSource;
}
export function isObservation(
	c: BotTriggerCondition,
): c is BotObservationSource {
	return ['command', 'http', 'sse', 'files'].includes(c.kind);
}
export function asSchedule(
	c: BotTriggerCondition,
): BotTriggerSchedule | undefined {
	if (c.kind === 'command' || c.kind === 'http')
		return { kind: 'every', anchor: c.anchor ?? 0, intervalMs: c.intervalMs };
	if (c.kind === 'cron' || c.kind === 'once' || c.kind === 'every') return c;
	return undefined;
}
