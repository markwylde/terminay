const MAX_SIGNALING_MESSAGE_BYTES = 128 * 1024;
const MAX_SIGNALING_DEPTH = 24;
const MAX_SIGNALING_KEYS = 512;
const SIGNALING_TYPE = /^[a-z][a-z0-9._:-]{0,63}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type SignalingMessage = Record<string, unknown>;

/**
 * Signaling is untrusted relay input. Keep its JSON boundary separate from
 * application frames: relay messages are bounded records and are never
 * allowed to carry prototype-mutating keys into host code.
 */
export function parseSignalingMessage(raw: string | Uint8Array): SignalingMessage {
	const text = typeof raw === "string" ? raw : decodeBytes(raw);
	if (byteLength(text) > MAX_SIGNALING_MESSAGE_BYTES) throw new RangeError("WebRTC signaling message exceeds 128 KiB");
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new TypeError("WebRTC signaling message is invalid JSON");
	}
	assertSignalingMessage(value);
	return value;
}

export function serializeSignalingMessage(value: unknown): string {
	assertSignalingMessage(value);
	let text: string | undefined;
	try {
		text = JSON.stringify(value);
	} catch {
		throw new TypeError("WebRTC signaling message is not serializable");
	}
	if (text === undefined) throw new TypeError("WebRTC signaling message is not serializable");
	if (byteLength(text) > MAX_SIGNALING_MESSAGE_BYTES) throw new RangeError("WebRTC signaling message exceeds 128 KiB");
	return text;
}

export function assertSignalingMessage(value: unknown): asserts value is SignalingMessage {
	if (!isRecord(value)) throw new TypeError("WebRTC signaling message must be an object");
	if (typeof value.type !== "string" || !SIGNALING_TYPE.test(value.type)) throw new TypeError("WebRTC signaling message type is invalid");
	assertSafeJson(value, 0, new Set());
}

function assertSafeJson(value: unknown, depth: number, seen: Set<object>): void {
	if (depth > MAX_SIGNALING_DEPTH) throw new RangeError("WebRTC signaling message is too deeply nested");
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("WebRTC signaling message contains a non-finite number");
		return;
	}
	if (typeof value !== "object") throw new TypeError("WebRTC signaling message contains an unsupported value");
	if (seen.has(value)) throw new TypeError("WebRTC signaling message contains a cycle");
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > MAX_SIGNALING_KEYS) throw new RangeError("WebRTC signaling array is too large");
		for (const item of value) assertSafeJson(item, depth + 1, seen);
	} else {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length > MAX_SIGNALING_KEYS) throw new RangeError("WebRTC signaling object has too many fields");
		for (const key of keys) {
			if (FORBIDDEN_KEYS.has(key)) throw new TypeError("WebRTC signaling message contains a forbidden key");
			assertSafeJson(record[key], depth + 1, seen);
		}
	}
	seen.delete(value);
}

function decodeBytes(value: Uint8Array): string {
	if (!(value instanceof Uint8Array)) throw new TypeError("WebRTC signaling message bytes are invalid");
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(value);
	} catch {
		throw new TypeError("WebRTC signaling message is not valid UTF-8");
	}
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
