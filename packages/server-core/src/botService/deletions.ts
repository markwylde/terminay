import { botEnvironmentId } from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';
import type { EnginePin } from './engine.js';
import { samePin } from './engine.js';
import { validateEnginePin } from './engineService.js';
import { object } from './store.js';

export interface BotDeletion {
	readonly botId: string;
	readonly serverId: string;
	readonly deleteHome: boolean;
	readonly pin: EnginePin | null;
}
/** A durable intent never follows a new engine selected at the same address. */
export class BotDeletions {
	private entries: BotDeletion[];
	constructor(
		private readonly path: string,
		private readonly serverId: string,
	) {
		this.entries =
			loadCanonicalStateSync(path, 'bots', {
				validate: (value) => {
					const v = object(value);
					if (v.version !== 1 || !Array.isArray(v.entries))
						throw new Error('invalid bot deletion intents');
					return v.entries.map((raw) => {
						const e = object(raw);
						if (
							typeof e.serverId !== 'string' ||
							!e.serverId ||
							typeof e.deleteHome !== 'boolean'
						)
							throw new Error('invalid home deletion choice');
						return {
							botId: botEnvironmentId(e.botId),
							serverId: e.serverId,
							deleteHome: e.deleteHome,
							pin: e.pin === null ? null : validateEnginePin(e.pin),
						};
					});
				},
			}) ?? [];
	}
	list(): readonly BotDeletion[] {
		return this.entries;
	}
	begin(botId: string, deleteHome: boolean, pin: EnginePin | undefined): void {
		if (this.entries.some((e) => e.botId === botId)) return;
		this.save([
			...this.entries,
			{
				botId: botEnvironmentId(botId),
				serverId: this.serverId,
				deleteHome,
				pin: pin ?? null,
			},
		]);
	}
	matches(botId: string, pin: EnginePin): boolean {
		const e = this.entries.find((e) => e.botId === botId);
		return !!e?.pin && e.serverId === this.serverId && samePin(e.pin, pin);
	}
	complete(botId: string): void {
		this.save(this.entries.filter((e) => e.botId !== botId));
	}
	private save(entries: BotDeletion[]): void {
		writeFileDurablySync(this.path, JSON.stringify({ version: 1, entries }), {
			keepPrevious: true,
		});
		this.entries = entries;
	}
}
