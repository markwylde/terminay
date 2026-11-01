import { BotTokenRedactor } from './tokens.js';

/** Redact each engine stream before combining its bounded log tail. An
 * interleaved stderr write must not break a token split across stdout chunks. */
export class BotLogTail {
	private readonly redactors = new Map<string, BotTokenRedactor>();
	private secrets: readonly string[] = [];
	private factory?: () => BotTokenRedactor;
	private tail = Buffer.alloc(0);
	constructor(
		secrets: readonly string[] | (() => BotTokenRedactor),
		private readonly limit = 256 * 1024,
	) {
		if (typeof secrets === 'function') this.factory = secrets;
		else this.secrets = [...secrets];
	}
	push(chunk: string, source: 'stdout' | 'stderr' = 'stdout'): void {
		let redactor = this.redactors.get(source);
		if (!redactor) {
			redactor = this.factory?.() ?? new BotTokenRedactor(this.secrets);
			this.redactors.set(source, redactor);
		}
		this.append(redactor.push(chunk));
	}
	finish(): string {
		for (const redactor of this.redactors.values())
			this.append(redactor.finish());
		this.redactors.clear();
		this.secrets = [];
		this.factory = undefined;
		const result = this.tail.toString('utf8').replace(/^\uFFFD+/, '');
		this.tail = Buffer.alloc(0);
		return result;
	}
	close(): void {
		for (const redactor of this.redactors.values()) redactor.close();
		this.redactors.clear();
		this.secrets = [];
		this.factory = undefined;
		this.tail = Buffer.alloc(0);
	}
	private append(bytes: Buffer): void {
		this.tail = Buffer.concat([this.tail, bytes]).subarray(-this.limit);
	}
}
