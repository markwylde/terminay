import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { EngineCommandError, EngineProcess } from './process.js';

export function unixSocketPath(address: string): string {
	if (
		!address.startsWith('unix:///') ||
		address.includes('\0') ||
		address.includes('?') ||
		address.includes('#')
	)
		throw new EngineCommandError('remote-engine', 'local Unix socket required');
	return address.slice('unix://'.length);
}
async function json(file: string): Promise<
	| {
			currentContext?: string;
			Name?: string;
			Endpoints?: { docker?: { Host?: string } };
	  }
	| undefined
> {
	try {
		const info = await stat(file);
		if (info.size > 1024 * 1024) return undefined;
		return JSON.parse(await readFile(file, 'utf8'));
	} catch {
		return undefined;
	}
}
export interface SocketCandidate {
	address: string;
}
/** Metadata only. Docker/Podman executables never run bot operations. */
export async function discoverSockets(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	runner?: EngineProcess,
): Promise<SocketCandidate[]> {
	if (platform !== 'darwin' && platform !== 'linux')
		throw new EngineCommandError(
			'unsupported-platform',
			'bots require macOS or Linux',
		);
	const home = env.HOME ?? homedir();
	const configDir = env.DOCKER_CONFIG ?? path.join(home, '.docker');
	const config = await json(path.join(configDir, 'config.json'));
	const context =
		env.DOCKER_CONTEXT ??
		(!env.DOCKER_HOST ? config?.currentContext : undefined);
	let selected: string | undefined;
	if (context && context !== 'default') {
		let entries: string[] = [];
		try {
			entries = await readdir(path.join(configDir, 'contexts', 'meta'));
		} catch {
			/* Refuse an unresolved selected context. */
		}
		for (const entry of entries.slice(0, 256)) {
			const meta = await json(
				path.join(configDir, 'contexts', 'meta', entry, 'meta.json'),
			);
			if (meta?.Name === context) selected = meta.Endpoints?.docker?.Host;
		}
		if (!selected)
			throw new EngineCommandError(
				'not-running',
				'selected Docker context unavailable',
			);
	} else
		selected =
			env.DOCKER_CONTEXT === 'default'
				? 'unix:///var/run/docker.sock'
				: env.DOCKER_HOST;
	if (selected) {
		unixSocketPath(selected);
		if (env.DOCKER_HOST || env.DOCKER_CONTEXT) return [{ address: selected }];
	}
	if (env.CONTAINER_HOST) {
		unixSocketPath(env.CONTAINER_HOST);
		return [{ address: env.CONTAINER_HOST }];
	}
	const sockets: string[] = [
		...(selected ? [unixSocketPath(selected)] : []),
		'/var/run/docker.sock',
		path.join(home, '.docker/run/docker.sock'),
		path.join(home, '.docker/desktop/docker.sock'),
		path.join(home, '.orbstack/run/docker.sock'),
		path.join(home, '.local/share/containers/podman/machine/podman.sock'),
		...(platform === 'linux'
			? [
					'/run/podman/podman.sock',
					...(env.XDG_RUNTIME_DIR
						? [path.join(env.XDG_RUNTIME_DIR, 'podman/podman.sock')]
						: []),
				]
			: []),
	];
	if (env.CONTAINER_CONNECTION) {
		if (!runner)
			throw new EngineCommandError(
				'not-running',
				'selected Podman connection unavailable',
			);
		return [
			{
				address: (await localPodmanConnection(env.CONTAINER_CONNECTION, runner))
					.address,
			},
		];
	}
	// Provider-specific metadata is an optional discovery aid only.
	if (platform === 'darwin' && runner) {
		try {
			const machines = JSON.parse(
				await runner.run('podman', ['machine', 'list', '--format', 'json'], {
					deadlineMs: 5000,
					maxBytes: 1024 * 1024,
				}),
			) as { Name?: string; Running?: boolean }[];
			for (const machine of machines
				.slice(0, 16)
				.filter((m) => m.Running && m.Name)) {
				const info = JSON.parse(
					await runner.run('podman', ['machine', 'inspect', machine.Name!], {
						deadlineMs: 5000,
						maxBytes: 1024 * 1024,
					}),
				) as { ConnectionInfo?: { PodmanSocket?: { Path?: string } } }[];
				const socket = info[0]?.ConnectionInfo?.PodmanSocket?.Path;
				if (socket?.startsWith('/')) sockets.push(socket);
			}
		} catch {
			/* Standard or configured sockets still work without tooling. */
		}
	}
	const seen = new Set<string>(),
		result: SocketCandidate[] = [];
	for (const socket of sockets) {
		try {
			const canonical = await realpath(socket);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			if ((await stat(canonical)).isSocket())
				result.push({ address: `unix://${canonical}` });
		} catch (error) {
			if (
				['EACCES', 'EPERM'].includes(
					(error as NodeJS.ErrnoException).code ?? '',
				)
			)
				result.push({ address: `unix://${socket}` });
		}
	}
	return result;
}

/** Resolves one saved connection, proving its SSH endpoint belongs to a local
 * machine and that the forwarded socket serves the requested root mode. */
export async function localPodmanConnection(
	name: string,
	runner: EngineProcess,
): Promise<{ address: string; machineName?: string }> {
	const options = { deadlineMs: 5000, maxBytes: 1024 * 1024 };
	const connections = JSON.parse(
		await runner.run(
			'podman',
			['system', 'connection', 'list', '--format', 'json'],
			options,
		),
	) as { Name: string; URI: string }[];
	const connection = connections.find((c) => c.Name === name);
	if (!connection)
		throw new EngineCommandError(
			'not-running',
			'selected Podman connection missing',
		);
	if (connection.URI.startsWith('unix://'))
		return { address: `unix://${unixSocketPath(connection.URI)}` };
	const uri = new URL(connection.URI);
	if (
		uri.protocol !== 'ssh:' ||
		!['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)
	)
		throw new EngineCommandError(
			'remote-engine',
			'remote Podman connection refused',
		);
	const machines = JSON.parse(
		await runner.run(
			'podman',
			['machine', 'list', '--format', 'json'],
			options,
		),
	) as { Name: string; Running?: boolean }[];
	const machine = machines.find((m) =>
		[m.Name, `${m.Name}-root`].includes(name),
	);
	if (!machine)
		throw new EngineCommandError(
			'remote-engine',
			'connection is not a local machine',
		);
	const info = JSON.parse(
		await runner.run('podman', ['machine', 'inspect', machine.Name], options),
	) as {
		Rootful?: boolean;
		SSHConfig?: { Port?: number };
		ConnectionInfo?: { PodmanSocket?: { Path?: string } };
	}[];
	if (Number(uri.port) !== info[0]?.SSHConfig?.Port)
		throw new EngineCommandError(
			'remote-engine',
			'connection does not belong to local machine',
		);
	if (info[0]?.Rootful !== name.endsWith('-root'))
		throw new EngineCommandError(
			'unsupported-engine-mode',
			'connection is not the forwarded machine socket',
		);
	const socket = info[0]?.ConnectionInfo?.PodmanSocket?.Path;
	if (!socket?.startsWith('/'))
		throw new EngineCommandError(
			'not-running',
			'local machine socket unavailable',
		);
	return { address: `unix://${socket}`, machineName: machine.Name };
}
