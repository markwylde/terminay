import { describe, expect, it, vi } from 'vitest';
import { RendererConnectionController, type RendererConnectionClock } from './rendererConnectionController';

const settle = async (condition: () => boolean) => {
	for (let attempt = 0; attempt < 20 && !condition(); attempt += 1)
		await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('RendererConnectionController', () => {
	it('publishes connected only after authenticate, subscribe, hydrate and verification', async () => {
		const order: string[] = [];
		const controller = new RendererConnectionController<{ dispose(): void }>({ onActivated: () => { order.push('activated'); } });
		controller.connect('profile-1', {
			acquire: async () => { order.push('acquire'); return { dispose: () => order.push('dispose') }; },
			authenticate: async () => { order.push('authenticate'); },
			resubscribe: async () => { order.push('resubscribe'); },
			hydrate: async () => { order.push('hydrate'); },
			verify: async () => { order.push('verify'); },
		});
		await settle(() => controller.state.phase === 'connected');
		expect(controller.state.phase).toBe('connected');
		expect(order).toEqual(['acquire', 'authenticate', 'resubscribe', 'hydrate', 'verify', 'activated']);
	});

	it('fences and disposes a late candidate from a retired generation', async () => {
		let release!: (value: { id: string; dispose(): void }) => void;
		const disposed: string[] = [];
		const controller = new RendererConnectionController<{ id: string; dispose(): void }>();
		const pipeline = (acquire: () => Promise<{ id: string; dispose(): void }>) => ({
			acquire, resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
		});
		controller.connect('profile-1', pipeline(() => new Promise((resolve) => { release = resolve; })));
		controller.connect('profile-1', pipeline(async () => ({ id: 'new', dispose: () => disposed.push('new') })));
		release({ id: 'old', dispose: () => disposed.push('old') });
		await settle(() => controller.current?.id === 'new');
		expect(controller.current?.id).toBe('new');
		expect(disposed).toContain('old');
	});

	it('keeps retry stable and cancels backoff before an immediate fresh attempt', async () => {
		const timers: Array<() => void> = [];
		const clock: RendererConnectionClock = { clearTimeout: vi.fn(), setTimeout: (callback) => { timers.push(callback); return callback; } };
		let acquisitions = 0;
		const controller = new RendererConnectionController<{ dispose(): void }>({ clock });
		const retry = controller.retry;
		controller.connect('profile-1', {
			acquire: async () => { acquisitions += 1; if (acquisitions === 1) throw new Error('offline'); return { dispose() {} }; },
			resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
		});
		await settle(() => controller.state.phase === 'retry-wait');
		expect(controller.state.phase).toBe('retry-wait');
		retry();
		await settle(() => controller.state.phase === 'connected');
		expect(acquisitions).toBe(2);
		expect(controller.state.phase).toBe('connected');
		expect(clock.clearTimeout).toHaveBeenCalled();
	});

	it('ignores recovery from another profile and stops current authority', async () => {
		const controller = new RendererConnectionController<{ dispose(): void }>();
		controller.connect('profile-1', { acquire: async () => ({ dispose() {} }), resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {} });
		await settle(() => controller.state.phase === 'connected');
		controller.recover('profile-2');
		expect(controller.state.profileId).toBe('profile-1');
		await controller.stop('profile-1');
		expect(controller.state.phase).toBe('stopped');
		expect(controller.current).toBeUndefined();
	});
});
