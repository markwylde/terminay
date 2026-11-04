import type { BotAgentContribution } from '@terminay/extension-api';
import { botEnvironmentId } from '@terminay/protocol';
import type { ServerVaultService } from '../settings/vault.js';

export type BotCredentialSecret = NonNullable<
	BotAgentContribution['credentialSecrets']
>[number];
export type BotTokenVault = Pick<
	ServerVaultService,
	'status' | 'put' | 'replace' | 'remove' | 'withSecret'
>;
const variable = (name: string): string => {
	if (!/^[A-Z][A-Z0-9_]*$/.test(name))
		throw new TypeError('invalid bot credential variable');
	return name;
};
const key = (id: string, name: string) =>
	`bot:${botEnvironmentId(id)}:${variable(name)}`;

/** Byte-oriented streaming exact-value redaction. Never decodes a partial UTF-8
 * character. The caller decodes emitted bytes with a streaming decoder. */
export class BotTokenRedactor {
	private carry = Buffer.alloc(0);
	private secrets: Buffer[];
	private closed = false;
	constructor(values: readonly (string | Uint8Array)[]) {
		this.secrets = values
			.map((v) => Buffer.from(v))
			.filter((v) => v.length > 0)
			.sort((a, b) => b.length - a.length);
	}
	push(chunk: Uint8Array | string): Buffer {
		if (this.closed) throw new Error('redactor closed');
		return this.drain(Buffer.from(chunk), false);
	}
	finish(): Buffer {
		if (this.closed) return Buffer.alloc(0);
		const result = this.drain(Buffer.alloc(0), true);
		this.close();
		return result;
	}
	close(): void {
		this.closed = true;
		this.carry.fill(0);
		this.carry = Buffer.alloc(0);
		for (const value of this.secrets) value.fill(0);
		this.secrets = [];
	}
	private drain(chunk: Buffer, final: boolean): Buffer {
		const input = Buffer.concat([this.carry, chunk]);
		this.carry.fill(0);
		const window = Math.max(1, ...this.secrets.map((v) => v.length)) - 1;
		const boundary = final ? input.length : Math.max(0, input.length - window);
		const output: Buffer[] = [];
		const find = (value: Buffer, from = 0) =>
			(
				input as unknown as { indexOf(value: Uint8Array, from: number): number }
			).indexOf(value, from);
		const matches = this.secrets.map((value) => ({
			value,
			offset: find(value),
		}));
		let position = 0;
		while (position < boundary) {
			let next: (typeof matches)[number] | undefined;
			for (const match of matches) {
				if (
					match.offset >= position &&
					match.offset < boundary &&
					(!next ||
						match.offset < next.offset ||
						(match.offset === next.offset &&
							match.value.length > next.value.length))
				)
					next = match;
			}
			if (!next) {
				output.push(Buffer.from(input.subarray(position, boundary)));
				position = boundary;
				break;
			}
			if (next.offset > position)
				output.push(Buffer.from(input.subarray(position, next.offset)));
			output.push(Buffer.from('[redacted]'));
			position = next.offset + next.value.length;
			for (const match of matches)
				if (match.offset >= 0 && match.offset < position)
					match.offset = find(match.value, position);
		}
		this.carry = Buffer.from(input.subarray(position));
		input.fill(0);
		return Buffer.concat(output);
	}
}

/** Server-only lease. Extensions receive neither this object nor its values.
 * The process owner releases only after its session group is confirmed gone. */
export interface BotTokenLease {
	readonly environmentNames: readonly string[];
	withEnvironment<T>(
		callback: (env: NodeJS.ProcessEnv) => T | Promise<T>,
	): Promise<T>;
	redactor(): BotTokenRedactor;
	release(): void;
}
interface RetainedToken {
	value: Buffer;
	references: number;
}
export class BotTokenService {
	private readonly retained = new Map<string, Set<RetainedToken>>();
	constructor(private readonly vault: BotTokenVault) {}
	async save(id: string, name: string, value: Uint8Array): Promise<void> {
		const secretId = key(id, name);
		try {
			if (!value.length || value.length > 64 * 1024 || value.includes(0))
				throw new TypeError('invalid bot token');
			new TextDecoder('utf-8', { fatal: true }).decode(value);
			const input = { id: secretId, label: secretId, value };
			if (this.vault.status().entries.some((entry) => entry.id === secretId))
				await this.vault.replace(input);
			else await this.vault.put(input);
		} finally {
			value.fill(0);
		}
	}
	configured(id: string, name: string): boolean {
		return this.vault
			.status()
			.entries.some((entry) => entry.id === key(id, name));
	}
	async remove(id: string, name: string): Promise<void> {
		await this.vault.remove(key(id, name));
	}
	/** Copy is explicit, with distinct vault ownership for the destination bot. */
	async copy(source: string, destination: string, name: string): Promise<void> {
		if (source === destination) throw new TypeError('choose another bot');
		await this.vault.withSecret(key(source, name), (value) =>
			this.save(destination, name, new Uint8Array(value)),
		);
	}
	async acquire(
		id: string,
		declarations: readonly BotCredentialSecret[],
	): Promise<BotTokenLease> {
		botEnvironmentId(id);
		if (
			new Set(declarations.map((d) => d.environmentVariable)).size !==
			declarations.length
		)
			throw new TypeError('duplicate credential variable');
		const tokens: { name: string; token: RetainedToken }[] = [];
		const redactors = new Set<BotTokenRedactor>();
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			for (const r of redactors) r.close();
			redactors.clear();
			for (const { token } of tokens) {
				if (--token.references === 0) {
					token.value.fill(0);
					this.retained.get(id)?.delete(token);
				}
			}
			tokens.length = 0;
			if (!this.retained.get(id)?.size) this.retained.delete(id);
		};
		try {
			for (const declaration of declarations) {
				const name = variable(declaration.environmentVariable);
				await this.vault.withSecret(key(id, name), (value) => {
					let values = this.retained.get(id);
					if (!values) {
						values = new Set();
						this.retained.set(id, values);
					}
					let token = [...values].find((v) => equalBytes(v.value, value));
					if (!token) {
						token = { value: Buffer.from(value), references: 0 };
						values.add(token);
					}
					token.references++;
					tokens.push({
						name,
						token,
					});
				});
			}
		} catch {
			release();
			throw new Error('bot credential unavailable');
		}
		const check = () => {
			if (released) throw new Error('bot credential lease closed');
		};
		return {
			environmentNames: tokens.map((t) => t.name),
			withEnvironment: async (callback) => {
				check();
				const env = {} as NodeJS.ProcessEnv;
				try {
					for (const { name, token } of tokens)
						env[name] = token.value.toString('utf8');
					return await callback(env);
				} finally {
					for (const name of Object.keys(env)) delete env[name];
				}
			},
			redactor: () => {
				check();
				const r = new BotTokenRedactor(tokens.map((t) => t.token.value));
				redactors.add(r);
				return r;
			},
			release,
		};
	}
	/** Diagnostic count only: values never cross this boundary. */
	retainedCount(id: string): number {
		return this.retained.get(id)?.size ?? 0;
	}
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
