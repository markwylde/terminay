import {
	EventFanout,
	type EventFanoutOptions,
	type EventTerminalDescription,
	type TriggerEvent,
} from '../scheduleEngine/eventFanout.js';
import type { RemoteConnectionAdmission } from '../remote/transport.js';
import type { AutomationRepository } from './repository.js';
import type { AutomationRunLog } from './runLog.js';
import type {
	AutomationDefinition,
	AutomationEventKind,
	AutomationRunController,
} from './types.js';

export type AutomationTerminalDescription = EventTerminalDescription;
export type AutomationTriggerEvent = TriggerEvent;
export interface AutomationTriggerOptions
	extends Omit<EventFanoutOptions, 'describeTerminal'> {
	readonly describeTerminal?: EventFanoutOptions['describeTerminal'];
	readonly repository: AutomationRepository;
	readonly controller: () => AutomationRunController | undefined;
	readonly runLog?: AutomationRunLog;
	readonly fanout?: EventFanout;
	readonly generateRunId?: () => string;
}

/** Automation execution policy on the shared canonical event fan-out. */
export class AutomationTriggers {
	private readonly fanout: EventFanout;
	private readonly generateRunId: () => string;
	private started = false;
	private stopped = false;
	private unregister: (() => void) | undefined;

	constructor(private readonly options: AutomationTriggerOptions) {
		if (options.fanout !== undefined) this.fanout = options.fanout;
		else {
			if (options.describeTerminal === undefined)
				throw new Error('Event fan-out requires describeTerminal');
			this.fanout = new EventFanout({
				...options,
				describeTerminal: options.describeTerminal,
			});
		}
		this.generateRunId = options.generateRunId ?? (() => crypto.randomUUID());
	}

	async start(): Promise<void> {
		if (this.started || this.stopped) return;
		this.started = true;
		await this.options.repository.load();
		await this.options.runLog?.load();
		if (this.stopped) return;
		this.unregister = this.fanout.registerSource('automations', {
			accepts: (event) => this.listeners(event).length > 0,
			onEvent: (trigger, firedAt) => this.dispatch(trigger, firedAt),
		});
		this.fanout.start();
	}

	stop(): void {
		this.stopped = true;
		this.unregister?.();
		if (this.options.fanout === undefined) this.fanout.stop();
	}

	markRunTerminal(sessionId: string): void {
		this.fanout.markRunTerminal(sessionId);
	}
	unmarkRunTerminal(sessionId: string): void {
		this.fanout.unmarkRunTerminal(sessionId);
	}
	isRunTerminal(sessionId: string): boolean {
		return this.fanout.isRunTerminal(sessionId);
	}
	deviceConnected(admission: RemoteConnectionAdmission): void {
		this.fanout.deviceConnected(admission);
	}

	private dispatch(trigger: AutomationTriggerEvent, firedAt: number): void {
		const automations = this.listeners(trigger.event);
		if (automations.length === 0) return;
		const controller = this.options.controller();
		for (const automation of automations) {
			if (controller === undefined) {
				void this.recordUnavailable(automation, trigger, firedAt);
				continue;
			}
			controller
				.start({
					automation,
					startedBy: 'trigger',
					firedAt,
					event: trigger.event,
					subject: trigger.subject,
					...(trigger.context === undefined
						? {}
						: { context: trigger.context }),
				})
				.catch((error: unknown) => this.report(error));
		}
	}

	private listeners(
		event: AutomationEventKind,
	): readonly AutomationDefinition[] {
		return this.options.repository.state.automations.filter(
			(automation) =>
				automation.enabled &&
				automation.trigger.kind === 'event' &&
				automation.trigger.event === event,
		);
	}

	private async recordUnavailable(
		automation: AutomationDefinition,
		trigger: AutomationTriggerEvent,
		firedAt: number,
	): Promise<void> {
		const runLog = this.options.runLog;
		if (runLog === undefined) return;
		try {
			await runLog.record({
				runId: this.generateRunId(),
				automationId: automation.id,
				triggerKind: 'event',
				event: trigger.event,
				firedAt,
				startedBy: 'trigger',
				subject: trigger.subject,
				status: 'finished',
				outcome: 'skipped',
				skipReason: 'executorUnavailable',
				reason: 'no automation executor is available on this server',
				startedAt: firedAt,
				finishedAt: firedAt,
				durationMs: 0,
				suppressedEvents: 0,
			});
		} catch (error) {
			this.report(error);
		}
	}

	private report(error: unknown): void {
		try {
			this.options.onError?.(error);
		} catch {
			// A failing reporter never stops the triggers.
		}
	}
}
