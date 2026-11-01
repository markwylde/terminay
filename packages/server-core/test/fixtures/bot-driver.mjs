export const botId = 'abc123def456';
export const name = `terminay-bot-${botId}`;
export function fakeDriver(options = {}) {
	const resources = new Map();
	const calls = [];
	let n = 0;
	const driver = {
		details: {
			pin: {
				kind: options.kind ?? 'docker',
				address: 'local',
				identity: 'identity',
			},
			rootless: options.rootless ?? false,
			limitsEnforced: true,
			platform: 'linux',
			botUid: 501,
			botGid: 20,
			socketPath: options.socket ?? '/var/run/docker.sock',
		},
		resources,
		calls,
		inspect: async (kind, key) => {
			calls.push(['inspect', kind, key]);
			return (
				resources.get(`${kind}:${key}`) ??
				[...resources.entries()].find(
					([k, v]) => k.startsWith(`${kind}:`) && v.Id === key,
				)?.[1]
			);
		},
		run: async (args, callOptions = {}) => {
			calls.push(args);
			if (driver.fail && args[0] === driver.fail)
				throw new Error('engine unavailable');
			if (args[0] === 'stats')
				return JSON.stringify(
					options.kind === 'podman'
						? [{ CPU: '4.5%', MemUsage: '12MiB / 4GiB' }]
						: { CPUPerc: '2.5%', MemUsage: '16MiB / 4GiB' },
				);
			if (args[0] === 'logs') {
				for (const chunk of ['x'.repeat(300000), 'key=sec', 'ret\n'])
					callOptions.onOutput?.(chunk);
				return '';
			}
			if (args[0] === 'run')
				return args.includes('stat') ? '999' : '123\t/home/bot';
			const [kind, action] = args;
			if (action === 'ls')
				return [...resources.entries()]
					.filter(
						([k, v]) =>
							k.startsWith('container:') &&
							v.Config.Labels['terminay.bot'] === botId,
					)
					.map(([, v]) => v.Id)
					.join('\n');
			if (action === 'create') {
				const labels = {};
				args.forEach((arg, i) => {
					if (arg === '--label') {
						const [key, value] = args[i + 1].split('=');
						labels[key] = value;
					}
				});
				const key =
					kind === 'container' ? args[args.indexOf('--name') + 1] : args.at(-1);
				resources.set(`${kind}:${key}`, {
					Id: String(++n).padStart(64, 'a'),
					Name: `/${key}`,
					Created: '2026-11-01T00:00:00Z',
					Labels: labels,
					Config: { Labels: labels, Image: 'terminay-bot:local' },
					State: { Running: false, Status: 'created', ExitCode: 0 },
				});
			} else if (action === 'rm') {
				const key = [...resources.entries()].find(
					([key, resource]) =>
						key === `${kind}:${args.at(-1)}` || resource.Id === args.at(-1),
				)?.[0];
				if (key) resources.delete(key);
			} else if (['start', 'stop', 'restart'].includes(action)) {
				const resource =
					resources.get(`${kind}:${args.at(-1)}`) ??
					[...resources.values()].find((r) => r.Id === args.at(-1));
				if (resource)
					resource.State = {
						Running: action !== 'stop',
						Status: action === 'stop' ? 'exited' : 'running',
						StartedAt: '2026-11-01T00:00:00Z',
						ExitCode: 0,
					};
			}
			return '';
		},
		json: async (args, opts) => JSON.parse(await driver.run(args, opts)),
		exec: async (container, command, callOptions) => {
			calls.push(['exec', container, command, callOptions]);
			if (driver.failExec) throw new Error('bootstrap failed');
			return 'ready';
		},
	};
	return driver;
}
export function fakeClock() {
	let now = 0;
	const timers = new Map();
	let n = 0;
	return {
		timers,
		get now() {
			return now;
		},
		setTimeout(callback, ms) {
			timers.set(++n, { callback, at: now + ms });
			return n;
		},
		clearTimeout(handle) {
			timers.delete(handle);
		},
		tick(ms) {
			now += ms;
			for (const [id, entry] of [...timers])
				if (entry.at <= now) {
					timers.delete(id);
					entry.callback();
				}
		},
	};
}
