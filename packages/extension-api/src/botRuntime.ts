import {
	type BotAgentContribution,
	type BotAgentLaunch,
	type BotAgentLaunchRequest,
	type BotAgentModel,
	type BotAgentRegistry,
	type BotAgentResult,
	type BotAgentRuntime,
	type BotAgentStatus,
	validateBotAgentLaunch,
	validateBotAgentLaunchRequest,
	validateBotAgentModels,
	validateBotAgentStatus,
} from './bots.js';
import { EXTENSION_LIMITS } from './constants.js';
import type { ValidationResult } from './validation.js';

interface Entry {
	contribution: BotAgentContribution;
	runtime: BotAgentRuntime;
	controllers: Set<AbortController>;
	models?: Promise<BotAgentResult<BotAgentModel[]>>;
	unavailable: boolean;
}

/** Host/test infrastructure. None of its invocation methods enter ExtensionContext. */
export class BotAgentRuntimeHost implements BotAgentRegistry {
	private readonly entries = new Map<string, Entry>();
	private active = true;
	constructor(
		private readonly declarations: readonly BotAgentContribution[],
		private readonly permitted: boolean,
		private readonly deadlineMs: number = EXTENSION_LIMITS.deadlineMs,
	) {}

	registerBotAgent(agentId: string, runtime: BotAgentRuntime) {
		if (!this.active) throw new Error('extension is deactivated');
		if (!this.permitted)
			throw new Error('bot agents require agent-bots permission');
		const contribution = this.declarations.find((c) => c.id === agentId);
		if (!contribution) throw new Error('bot agent registration is undeclared');
		if (this.entries.has(agentId))
			throw new Error('duplicate bot agent registration');
		if (
			!runtime ||
			typeof runtime.models !== 'function' ||
			typeof runtime.status !== 'function' ||
			typeof runtime.launch !== 'function'
		)
			throw new Error('invalid bot agent runtime');
		const entry: Entry = {
			contribution: structuredClone(contribution),
			runtime,
			controllers: new Set(),
			unavailable: false,
		};
		this.entries.set(agentId, entry);
		return Object.freeze({
			agentId,
			dispose: () => {
				if (this.entries.get(agentId) !== entry) return;
				this.entries.delete(agentId);
				for (const controller of entry.controllers) controller.abort();
			},
		});
	}
	remove(agentId: string): void {
		const entry = this.entries.get(agentId);
		this.entries.delete(agentId);
		if (entry) for (const controller of entry.controllers) controller.abort();
	}
	ids(): readonly string[] {
		return [...this.entries.keys()];
	}
	deactivate(): void {
		this.active = false;
		for (const entry of this.entries.values())
			for (const controller of entry.controllers) controller.abort();
		this.entries.clear();
	}
	models(agentId: string): Promise<BotAgentResult<BotAgentModel[]>> {
		const entry = this.entries.get(agentId);
		if (!entry || entry.unavailable) return Promise.resolve(unavailable());
		entry.models ??= this.invoke(
			agentId,
			(signal) => entry.runtime.models(signal),
			validateBotAgentModels,
		);
		return entry.models.then((result) =>
			entry.unavailable || this.entries.get(agentId) !== entry || !this.active
				? unavailable()
				: structuredClone(result),
		);
	}
	status(agentId: string): Promise<BotAgentResult<BotAgentStatus>> {
		const entry = this.entries.get(agentId);
		if (!entry || entry.unavailable) return Promise.resolve(unavailable());
		return this.invoke(
			agentId,
			(signal) => entry.runtime.status(signal),
			validateBotAgentStatus,
		);
	}
	launch(
		agentId: string,
		request: BotAgentLaunchRequest,
	): Promise<BotAgentResult<BotAgentLaunch>> {
		const entry = this.entries.get(agentId);
		const checked = validateBotAgentLaunchRequest(request);
		if (!entry || !checked.ok) return Promise.resolve(unavailable());
		return this.invoke(
			agentId,
			(signal) => entry.runtime.launch(checked.value, signal),
			(value) => validateBotAgentLaunch(value, entry.contribution),
		);
	}
	private async invoke<T>(
		agentId: string,
		call: (signal: AbortSignal) => Promise<unknown>,
		validate: (value: unknown) => ValidationResult<T>,
	): Promise<BotAgentResult<T>> {
		const entry = this.entries.get(agentId);
		if (!entry || entry.unavailable || !this.active) return unavailable();
		const controller = new AbortController();
		entry.controllers.add(controller);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		try {
			const ended = new Promise<never>((_, reject) => {
				abort = () => reject(new Error('bot agent call ended'));
				controller.signal.addEventListener('abort', abort, { once: true });
				timer = setTimeout(() => controller.abort(), this.deadlineMs);
			});
			const raw = await Promise.race([
				Promise.resolve().then(() => call(controller.signal)),
				ended,
			]);
			if (
				controller.signal.aborted ||
				this.entries.get(agentId) !== entry ||
				!this.active
			)
				return unavailable();
			const result = validate(raw);
			if (!result.ok) throw new Error('invalid bot agent result');
			return { available: true, value: result.value };
		} catch {
			entry.unavailable = true;
			return unavailable();
		} finally {
			clearTimeout(timer);
			if (abort) controller.signal.removeEventListener('abort', abort);
			entry.controllers.delete(controller);
		}
	}
}
function unavailable(): { available: false; reason: 'unavailable' } {
	return { available: false, reason: 'unavailable' };
}
