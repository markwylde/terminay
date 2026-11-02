export interface BotDeadlineClock {
	setTimeout(callback: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
}
const clock: BotDeadlineClock = {
	setTimeout(callback, milliseconds) {
		const timer = setTimeout(callback, milliseconds);
		timer.unref?.();
		return timer;
	},
	clearTimeout(handle) {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
};
export interface BotActivity {
	readonly runningSessions: number;
	readonly queuedSessions: number;
	readonly shells: number;
	readonly desktops: number;
}

/** Event-driven inactivity deadline. An unchanged idle state never rearms it. */
export class BotIdleDeadline {
	private timer: unknown;
	private idle = false;
	private period: number | null = null;
	private running = false;
	constructor(
		private readonly stop: () => void,
		private readonly timers = clock,
	) {}
	update(
		running: boolean,
		activity: BotActivity,
		milliseconds: number | null = 30 * 60_000,
	): void {
		if (
			milliseconds !== null &&
			(!Number.isSafeInteger(milliseconds) || milliseconds <= 0)
		)
			throw new RangeError('idle stop must be positive or never');
		const idle = Object.values(activity).every((value) => value === 0);
		if (
			this.idle === idle &&
			this.period === milliseconds &&
			this.running === running
		)
			return;
		this.cancel();
		this.idle = idle;
		this.period = milliseconds;
		this.running = running;
		if (idle && running && milliseconds !== null)
			this.timer = this.timers.setTimeout(() => {
				this.timer = undefined;
				this.stop();
			}, milliseconds);
	}
	cancel(): void {
		if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
		this.timer = undefined;
	}
	close(): void {
		this.cancel();
		this.running = false;
	}
}

/** Group 4.9 supplies the helper; its acquire/release events drive this timer. */
export class BotHelperIdleDeadline {
	private references = 0;
	private closed = false;
	private timer: unknown;
	constructor(
		private readonly stop: () => void,
		private readonly timers = clock,
		private readonly milliseconds: number | null = 5 * 60_000,
	) {}
	acquire(): () => void {
		if (this.closed) throw new Error('helper deadline closed');
		this.references++;
		if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
		this.timer = undefined;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.references--;
			if (!this.closed && !this.references && this.milliseconds !== null)
				this.timer = this.timers.setTimeout(() => {
					this.timer = undefined;
					this.stop();
				}, this.milliseconds);
		};
	}
	close(): void {
		this.closed = true;
		if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
		this.timer = undefined;
	}
}
