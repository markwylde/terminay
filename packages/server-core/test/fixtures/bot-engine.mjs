import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const config = JSON.parse(
	fs.readFileSync(process.env.BOT_ENGINE_CONFIG, 'utf8'),
);
fs.appendFileSync(
	process.env.BOT_ENGINE_CALLS,
	`${JSON.stringify({ executable: path.basename(process.argv[1]), args })}\n`,
);
const out = (value) =>
	process.stdout.write(
		`${typeof value === 'string' ? value : JSON.stringify(value)}\n`,
	);
const fail = (message) => {
	process.stderr.write(message);
	process.exit(1);
};
if (args[0] === '--version')
	out(config.shim ? 'docker version 6.1.4' : 'Docker version 29.9.2');
else if (args[0] === 'context') {
	if (config.shim) fail('unknown command context');
	out([
		{
			Endpoints: {
				docker: { Host: config.endpoint ?? 'unix:///fake/docker.sock' },
			},
		},
	]);
} else if (args[0] === 'system') out(config.connections ?? []);
else if (args[0] === 'machine' && args[1] === 'list')
	out(config.machines ?? []);
else if (args[0] === 'machine')
	out([
		{
			Name: 'podman-machine-default',
			SSHConfig: { Port: 4321, RemoteUsername: 'core' },
		},
	]);
else {
	const command = args[0]?.startsWith('--') ? args.slice(2) : args;
	if (command[0] === 'info') {
		if (config.infoFailure) fail(config.infoFailure);
		const isPodman = path.basename(process.argv[1]) === 'podman' || config.shim;
		out(
			isPodman
				? {
						host: {
							id: config.identity ?? 'podman-id',
							hostname: 'machine',
							security: { rootless: config.rootless ?? false },
							cgroupVersion: config.cgroups ?? 'v2',
							cgroupControllers: config.controllers ?? [
								'cpu',
								'memory',
								'pids',
							],
							remoteSocket: {
								path: config.socket ?? '/run/podman/podman.sock',
							},
						},
					}
				: {
						ID: config.identity ?? 'docker-id',
						SecurityOptions: config.rootless ? ['name=rootless'] : [],
					},
		);
	} else if (command[0] === 'events') {
		fs.watch(process.env.BOT_ENGINE_CONFIG, () => {
			const next = JSON.parse(
				fs.readFileSync(process.env.BOT_ENGINE_CONFIG, 'utf8'),
			);
			if (next.event) out(next.event);
			if (next.eventsEnd) process.exit(0);
		});
		out({ Type: 'container', Action: 'ready' });
	} else if (command[0] === 'hang') {
		process.on('SIGTERM', () => {});
		fs.watch(process.env.BOT_ENGINE_CONFIG, () => {});
	} else if (command[0] === 'overflow') process.stdout.write('x'.repeat(8192));
	else if (command[1] === 'inspect') {
		if (!config.resource) fail('Error: No such object');
		out([config.resource]);
	} else if (command[0] === 'echo') out(command.slice(1));
	else out('ok');
}
