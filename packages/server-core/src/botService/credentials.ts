import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import type { JsonValue } from '@terminay/protocol';

export interface BotAgentStream extends EventEmitter {
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly stderr: Readable;
	kill(signal?: string): boolean;
}
export interface BotTextRedactor {
	push(chunk: string): string;
	finish(): string;
}
/** Owned by the credential broker. Device sign-in uses an empty lease.
 * No extension receives this lease or any bot/session identifier. */
export interface BotCredentialLease {
	readonly environment: Readonly<Record<string, string>>;
	redact(value: string): string;
	stream(): BotTextRedactor;
	release(): void;
}
export const noBotCredentials = (): BotCredentialLease => ({
	environment: {},
	redact: (value) => value,
	stream: () => ({ push: (chunk) => chunk, finish: () => '' }),
	release: () => undefined,
});
export function redactBotJson(
	value: JsonValue,
	credential: Pick<BotCredentialLease, 'redact'>,
): JsonValue {
	if (typeof value === 'string') return credential.redact(value);
	if (Array.isArray(value))
		return value.map((v) => redactBotJson(v, credential));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, v]) => [
				credential.redact(key),
				redactBotJson(v, credential),
			]),
		);
	return value;
}
