import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DaemonOptions } from '../args.js';
import {
	type ContainerLayout,
	containerLayout,
	containerReleaseLabel,
	IMAGE_RELEASE_DEFAULT,
	isContainerManaged,
	readPendingUpgrade,
	readStagedRecord,
	rollBackPending,
	runningRelease,
	selectRelease,
} from '../container.js';
import {
	createDockerClient,
	DOCKER_PROBE_TIMEOUT_MS,
	type DockerApi,
	type DockerContainer,
	type DockerEndpoint,
	type DockerImage,
	type DockerMount,
	dockerSocketPath,
	probeDockerSocket,
} from '../docker.js';
import {
	type ImageReference,
	parseImageReference,
	resolveTargetImage,
	type TargetImage,
} from '../imageReference.js';
import { readArchiveManifest } from '../manifest.js';
import { writeUpgradeOutcome } from '../outcome.js';
import {
	compareVersions,
	type InstalledRelease,
	NoChannelError,
	resolveUpgradeTarget,
} from '../plan.js';
import { UpgradeError, type UpgradeResult } from './upgrade.js';

/**
 * `daemon upgrade --recreate` — replace the container with one on a newer
 * image.
 *
 * An in-place upgrade moves the server release and leaves the image's
 * operating system as it was. Recreating moves the whole image, and it is the
 * mode that costs something: the container stops, so every terminal in it
 * ends. It also needs the one thing a container is not normally given, the
 * engine's socket, so it exists only where an operator mounted that socket and
 * the account the server runs as may open it.
 *
 * A container cannot outlive its own removal, so the work is split in two.
 * This command, running in the container that is about to go, decides what to
 * move to, pulls it, and starts a short-lived helper container from the *new*
 * image. The helper (`terminay container-recreate`, below) then stops this
 * container, creates its replacement from what the engine says this one was
 * configured with, waits for the replacement's health check, and removes the
 * old one — or, when the replacement is not healthy, removes the replacement
 * and starts the old container again under its own name. Either way it writes
 * the outcome record on the data volume, where whichever server ends up
 * running reads it.
 *
 * What is installed is still not the client's choice: the target is the
 * container's own image reference, pulled again or moved to the newest release
 * on the installed channel, and nothing else.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** The old container keeps this name until its replacement is healthy. */
export const PREVIOUS_SUFFIX = '-terminay-previous';
/** One at a time: a second helper cannot take the name of the first. */
export const HELPER_SUFFIX = '-terminay-recreate';
export const HELPER_COMMAND = 'container-recreate';
const HELPER_LABEL = 'com.terminay.recreate-helper-for';

const HEALTH_TIMEOUT_MS = 120_000;
/** How long a container with no health check must stay up to count. */
const SETTLE_MS = 10_000;
/** A helper that has not ended this container by now is not going to. */
const HANDOVER_TIMEOUT_MS = 10 * 60_000;

export interface RecreateDependencies {
	readonly env?: Environment;
	/** The engine to talk to. Defaults to the socket the environment names. */
	readonly docker?: DockerApi;
	/** Skips the socket probe, for an engine that is not behind a socket. */
	readonly socket?: Awaited<ReturnType<typeof probeDockerSocket>>;
	readonly probeTimeoutMs?: number;
	/** Where `/proc` is. Relocated by the tests. */
	readonly procRoot?: string;
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly healthTimeoutMs?: number;
	readonly settleMs?: number;
	readonly handoverTimeoutMs?: number;
}

function reasonOf(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\s+/gu, ' ').slice(0, 512);
}

/** A release label as the outcome record and the server's status carry it. */
function label(value: string): string {
	const trimmed = value.trim().slice(0, 128);
	return trimmed.length === 0 ? 'unknown' : trimmed;
}

const SOCKET_REFUSALS = Object.freeze({
	absent:
		'no Docker socket is mounted into this container. Recreate needs the container started with `--volume /var/run/docker.sock:/var/run/docker.sock`.',
	'not-a-socket':
		'the Docker socket path in this container is not a socket, which is what an engine leaves when the path it was asked to mount did not exist on the host.',
	denied:
		'the Docker socket is mounted, but the account this server runs as may not open it. Start the container with `--group-add <gid>` naming the group that owns the socket.',
	unresponsive:
		'the Docker socket is mounted, but no Docker daemon answered on it.',
});

/**
 * Ids this process might be running under, most trustworthy first.
 *
 * The engine bind-mounts a few files from the container's own directory, whose
 * path carries the full id, and a cgroup v1 path carries it too; neither can
 * be changed from `docker run`. The hostname is the short id only by default
 * — `--hostname` replaces it — so it is the last thing tried, and every
 * candidate is checked against the engine before it is believed.
 */
export async function ownContainerCandidates(
	env: Environment,
	procRoot = '/proc',
): Promise<readonly string[]> {
	const found: string[] = [];
	const add = (id: string | undefined) => {
		if (id !== undefined && !found.includes(id)) found.push(id);
	};
	const mountinfo = await readFile(`${procRoot}/self/mountinfo`, 'utf8').catch(
		() => '',
	);
	for (const match of mountinfo.matchAll(/\/containers\/([a-f0-9]{64})\//gu))
		add(match[1]);
	const cgroup = await readFile(`${procRoot}/self/cgroup`, 'utf8').catch(
		() => '',
	);
	for (const match of cgroup.matchAll(/(?:[/-])([a-f0-9]{64})(?:\.scope)?$/gmu))
		add(match[1]);
	const hostname = env.HOSTNAME?.trim();
	if (hostname !== undefined && /^[a-f0-9]{12,64}$/u.test(hostname))
		add(hostname);
	return found;
}

/** The mount that puts `path` in the container, the most specific one. */
function mountOf(
	mounts: readonly DockerMount[] | null | undefined,
	path: string,
): DockerMount | undefined {
	let best: DockerMount | undefined;
	for (const mount of mounts ?? []) {
		const destination = mount.Destination;
		if (destination === undefined) continue;
		const covers =
			destination === path ||
			path.startsWith(
				destination.endsWith('/') ? destination : `${destination}/`,
			);
		if (
			covers &&
			(best?.Destination === undefined ||
				destination.length > best.Destination.length)
		)
			best = mount;
	}
	return best;
}

/** A mount written the way `--volume` takes it, at the place it already is. */
function bindOf(mount: DockerMount): string | undefined {
	const source = mount.Type === 'volume' ? mount.Name : mount.Source;
	if (
		source === undefined ||
		source.length === 0 ||
		mount.Destination === undefined
	)
		return undefined;
	return `${source}:${mount.Destination}${mount.RW === false ? ':ro' : ''}`;
}

function isThisServer(container: DockerContainer, dataRoot: string): boolean {
	return (
		(container.Config.Env ?? []).includes('TERMINAY_MANAGED_BY=container') &&
		mountOf(container.Mounts, dataRoot) !== undefined
	);
}

export const containerName = (container: DockerContainer): string =>
	container.Name.replace(/^\//u, '');

/**
 * Why this container cannot be recreated, when it cannot.
 *
 * One function, asked by the check, by the command, and again by the helper,
 * so a mode is never offered that the helper would then refuse.
 */
export function recreateRefusal(
	container: DockerContainer,
	dataRoot: string,
): string | undefined {
	const reference = parseImageReference(container.Config.Image ?? '');
	if (reference.kind === 'pinned') return reference.reason;
	if (container.HostConfig.AutoRemove === true) {
		return 'this container was started with `--rm`, so stopping it removes it and there would be nothing to go back to. Recreate is refused; upgrade in place, or start it without `--rm`.';
	}
	if ((container.HostConfig.NetworkMode ?? '').startsWith('container:')) {
		return 'this container shares another container’s network, which is named by an id a replacement cannot be relied on to keep. Recreate is refused; upgrade in place.';
	}
	const data = mountOf(container.Mounts, dataRoot);
	if (data === undefined || bindOf(data) === undefined) {
		return 'the data root of this container is not on a volume, so a replacement would start with a new identity and no paired devices. Recreate is refused.';
	}
	return undefined;
}

interface Self {
	readonly docker: DockerApi;
	readonly socketPath: string;
	readonly layout: ContainerLayout;
	readonly dataRoot: string;
	readonly container: DockerContainer;
	readonly image: DockerImage;
	readonly reference: Exclude<ImageReference, { kind: 'pinned' }>;
	readonly socketBind: string;
	readonly dataBind: string;
}

type Described =
	| { readonly ok: true; readonly self: Self }
	| { readonly ok: false; readonly reason: string };

/**
 * Find this container through the socket and decide whether it could be
 * recreated. Reads only; nothing is pulled, created, or written.
 */
async function describeSelf(
	env: Environment,
	dependencies: RecreateDependencies,
): Promise<Described> {
	const no = (reason: string): Described => ({ ok: false, reason });
	if (!isContainerManaged(env)) {
		return no(
			'`--recreate` replaces a container, and this server is not running in the official image. Use `daemon upgrade` on its own.',
		);
	}
	const socketPath = dockerSocketPath(env);
	const probe =
		dependencies.socket ??
		(dependencies.docker !== undefined
			? ({ usable: true } as const)
			: await probeDockerSocket(
					socketPath,
					dependencies.probeTimeoutMs ?? DOCKER_PROBE_TIMEOUT_MS,
				));
	if (!probe.usable) return no(SOCKET_REFUSALS[probe.cause]);
	const docker = dependencies.docker ?? createDockerClient(socketPath);
	const layout = containerLayout(env);
	const dataRoot = dirname(layout.prefix);

	let container: DockerContainer | undefined;
	for (const candidate of await ownContainerCandidates(
		env,
		dependencies.procRoot,
	)) {
		const inspected = await docker.inspectContainer(candidate);
		// An id, never a name: a hostname set to another container's name must
		// not make that container the one that gets replaced.
		if (
			inspected?.Id.startsWith(candidate) === true &&
			isThisServer(inspected, dataRoot)
		) {
			container = inspected;
			break;
		}
	}
	if (container === undefined) {
		return no(
			'the Docker daemon behind the mounted socket does not know this container, so it is not the one that runs it.',
		);
	}

	const refusal = recreateRefusal(container, dataRoot);
	if (refusal !== undefined) return no(refusal);
	const reference = parseImageReference(container.Config.Image ?? '');
	if (reference.kind === 'pinned') return no(reference.reason);

	const socketMount = mountOf(container.Mounts, socketPath);
	const socketBind =
		socketMount === undefined ? undefined : bindOf(socketMount);
	if (socketBind === undefined) {
		return no(
			'the Docker socket in this container is not a mount the helper container could be given.',
		);
	}
	const dataBind = bindOf(mountOf(container.Mounts, dataRoot) as DockerMount);
	// The replacement's configuration is this container's minus what its image
	// defined, so the image has to be there to subtract.
	const image = await docker.inspectImage(container.Image);
	if (image === undefined || dataBind === undefined) {
		return no(
			'the image this container was created from is no longer on this machine, so what the container added to it cannot be told apart from what the image set.',
		);
	}
	return {
		ok: true,
		self: Object.freeze({
			docker,
			socketPath,
			layout,
			dataRoot,
			container,
			image,
			reference,
			socketBind,
			dataBind,
		}),
	};
}

/**
 * Whether `--check` may list `recreate`. Never throws: an engine that cannot
 * be asked is one the mode is not offered for.
 */
export async function recreateOffered(
	env: Environment,
	dependencies: RecreateDependencies = {},
): Promise<boolean> {
	try {
		return (await describeSelf(env, dependencies)).ok;
	} catch {
		return false;
	}
}

const same = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function withoutKeys<T>(
	own: Readonly<Record<string, T>> | null | undefined,
	inherited: Readonly<Record<string, T>> | null | undefined,
): Record<string, T> {
	const kept: Record<string, T> = {};
	for (const [key, value] of Object.entries(own ?? {})) {
		if (
			inherited == null ||
			!(key in inherited) ||
			!same(inherited[key], value)
		)
			kept[key] = value;
	}
	return kept;
}

function endpointConfig(
	endpoint: DockerEndpoint,
	generated: readonly string[],
): Record<string, unknown> {
	const aliases = (endpoint.Aliases ?? []).filter(
		(alias) => !generated.includes(alias),
	);
	const present = (value: object | null | undefined): value is object =>
		value != null && Object.keys(value).length > 0;
	return {
		...(aliases.length > 0 ? { Aliases: aliases } : {}),
		...(present(endpoint.Links) ? { Links: endpoint.Links } : {}),
		...(present(endpoint.IPAMConfig)
			? { IPAMConfig: endpoint.IPAMConfig }
			: {}),
		...(present(endpoint.DriverOpts)
			? { DriverOpts: endpoint.DriverOpts }
			: {}),
	};
}

export interface Replacement {
	/** The body of the create request. */
	readonly spec: Readonly<Record<string, unknown>>;
	/** Networks beyond the first, joined after the container is created. */
	readonly networks: readonly {
		readonly name: string;
		readonly endpoint: Readonly<Record<string, unknown>>;
	}[];
}

/**
 * The replacement's configuration: what the operator gave the old container,
 * on the new image.
 *
 * An inspected container reports its image's settings and the operator's
 * merged together. Carrying all of it across would pin the new container to
 * the old image's defaults — its build revision, its entrypoint, its health
 * check — so everything the old *image* defined is subtracted first: an
 * environment variable or label is kept only where it is absent from the old
 * image or differs from it, and a command, entrypoint, user, working
 * directory, stop signal, or health check only where it is not the old
 * image's. What is left is what was asked for on `docker run`, and the new
 * image supplies the rest.
 *
 * The host side is taken whole: binds, mounts, published ports, restart
 * policy, capabilities, and every network with its aliases and fixed
 * addresses. A volume the engine created for the image's `VOLUME` is named
 * explicitly, so the replacement gets the same one rather than a new, empty
 * one.
 */
export function buildReplacement(
	container: DockerContainer,
	image: DockerImage,
	reference: string,
): Replacement {
	const config = container.Config;
	const inherited = image.Config ?? {};
	const shortId = container.Id.slice(0, 12);
	const hostConfig = container.HostConfig;
	const mode = hostConfig.NetworkMode ?? 'default';

	const inheritedEnv = new Set(inherited.Env ?? []);
	const env = (config.Env ?? []).filter((entry) => !inheritedEnv.has(entry));

	const binds = [...(hostConfig.Binds ?? [])];
	const bound = new Set([
		...binds.map((bind) => bind.split(':')[1]),
		...(hostConfig.Mounts ?? []).map((mount) => mount.Target),
	]);
	for (const mount of container.Mounts ?? []) {
		if (mount.Type !== 'volume' || bound.has(mount.Destination)) continue;
		const bind = bindOf(mount);
		if (bind !== undefined) binds.push(bind);
	}

	const carried: Record<string, unknown> = {};
	for (const key of [
		'Cmd',
		'Entrypoint',
		'User',
		'WorkingDir',
		'StopSignal',
		'Healthcheck',
		'Shell',
	]) {
		const value = config[key];
		if (value != null && value !== '' && !same(value, inherited[key]))
			carried[key] = value;
	}
	for (const key of [
		'Tty',
		'OpenStdin',
		'StdinOnce',
		'StopTimeout',
		'Domainname',
	]) {
		const value = config[key];
		if (value != null && value !== '' && value !== false) carried[key] = value;
	}
	const exposed = withoutKeys(
		config.ExposedPorts as Record<string, unknown> | undefined,
		inherited.ExposedPorts as Record<string, unknown> | undefined,
	);
	const volumes = withoutKeys(
		config.Volumes as Record<string, unknown> | undefined,
		inherited.Volumes as Record<string, unknown> | undefined,
	);

	// The engine's own name for a container is its short id. One the operator
	// chose is kept; the generated one would name a container that is gone.
	const generated = [shortId];
	const hostname = config.Hostname;
	const ownsNetwork = mode !== 'host' && !mode.startsWith('container:');
	if (
		ownsNetwork &&
		hostname !== undefined &&
		hostname.length > 0 &&
		hostname !== shortId
	)
		carried.Hostname = hostname;

	const attached = Object.entries(container.NetworkSettings?.Networks ?? {});
	const networked = ownsNetwork && mode !== 'none' && attached.length > 0;
	// Before API 1.44 a container is created on one network and joined to the
	// rest, and that still works after it, so that is the order used.
	const first = networked
		? (attached.find(([name]) => name === mode) ??
			attached.find(([name]) => name === 'bridge' && mode === 'default') ??
			attached[0])
		: undefined;

	return Object.freeze({
		spec: Object.freeze({
			...carried,
			Image: reference,
			Env: env,
			Labels: withoutKeys(config.Labels, inherited.Labels),
			...(Object.keys(exposed).length > 0 ? { ExposedPorts: exposed } : {}),
			...(Object.keys(volumes).length > 0 ? { Volumes: volumes } : {}),
			HostConfig: {
				...hostConfig,
				Binds: binds,
				// Inspect reports a link as `/target:/this/alias`; create takes
				// `target:alias`.
				...(hostConfig.Links == null
					? {}
					: {
							Links: hostConfig.Links.map((link) => {
								const [target = '', alias = ''] = link.split(':');
								return `${target.replace(/^\//u, '')}:${alias.slice(alias.lastIndexOf('/') + 1)}`;
							}),
						}),
			},
			...(first === undefined
				? {}
				: {
						NetworkingConfig: {
							EndpointsConfig: {
								[first[0]]: endpointConfig(first[1], generated),
							},
						},
					}),
		}),
		networks: networked
			? attached
					.filter((entry) => entry !== first)
					.map(([name, endpoint]) => ({
						name,
						endpoint: endpointConfig(endpoint, generated),
					}))
			: [],
	});
}

/**
 * The container that carries out the replacement.
 *
 * It is given what the old container had and no more: the same account and
 * supplementary groups, which is how the old container came to be able to open
 * the socket, the same socket mount, and the data volume for the outcome
 * record. It has no network, because the only thing it talks to is the socket.
 * It runs the new image's own CLI — the release built into that image, not
 * whichever release the data volume marks — so a damaged staged release cannot
 * be what performs the replacement.
 */
export function helperSpec(
	self: Pick<
		Self,
		'container' | 'socketBind' | 'dataBind' | 'socketPath' | 'dataRoot'
	>,
	target: TargetImage,
	labels: { readonly from: string; readonly to: string },
): Readonly<Record<string, unknown>> {
	const { Config: config, HostConfig: hostConfig } = self.container;
	const user = config.User;
	return Object.freeze({
		Image: target.reference,
		Entrypoint: [`${IMAGE_RELEASE_DEFAULT}/bin/terminay`],
		Cmd: [
			HELPER_COMMAND,
			self.container.Id,
			target.reference,
			labels.from,
			labels.to,
		],
		Env: [
			`TERMINAY_DATA_ROOT=${self.dataRoot}`,
			`DOCKER_HOST=unix://${self.socketPath}`,
		],
		...(typeof user === 'string' && user.length > 0 ? { User: user } : {}),
		WorkingDir: '/',
		Labels: { [HELPER_LABEL]: self.container.Id },
		HostConfig: {
			AutoRemove: true,
			NetworkMode: 'none',
			Binds: [self.socketBind, self.dataBind],
			...(hostConfig.GroupAdd == null ? {} : { GroupAdd: hostConfig.GroupAdd }),
			...(hostConfig.SecurityOpt == null
				? {}
				: { SecurityOpt: hostConfig.SecurityOpt }),
			...(hostConfig.UsernsMode === undefined || hostConfig.UsernsMode === ''
				? {}
				: { UsernsMode: hostConfig.UsernsMode }),
		},
	});
}

export async function runRecreate(
	options: DaemonOptions,
	context: { readonly write: (line: string) => void },
	dependencies: RecreateDependencies = {},
): Promise<UpgradeResult> {
	const { write } = context;
	const env = dependencies.env ?? process.env;
	if (
		options.publicHost !== undefined ||
		options.advertiseAddress !== undefined ||
		options.allowDowngrade
	) {
		throw new UpgradeError(
			'`--recreate` moves the container to the newer image of the reference it was created from, and takes no other upgrade flag.',
		);
	}

	const described = await describeSelf(env, dependencies);
	if (!described.ok) throw new UpgradeError(described.reason);
	const { self } = described;
	const { docker, layout, container, reference } = self;
	const name = containerName(container);

	const running = await runningRelease(layout);
	const fromLabel = label(containerReleaseLabel(running.manifest));

	// A reference that names a release moves to the newest release on the
	// installed channel; one that moves is simply pulled again.
	let target: TargetImage;
	if (reference.kind === 'version') {
		const staged =
			running.staged === undefined
				? undefined
				: await readStagedRecord(layout, running.staged);
		const installed: InstalledRelease = {
			channel: running.manifest.channel,
			version: running.manifest.version,
			revision: running.manifest.revision,
			...(staged?.publishedAt === undefined
				? {}
				: { publishedAt: staged.publishedAt }),
		};
		let available: Awaited<ReturnType<typeof resolveUpgradeTarget>>;
		try {
			available = await resolveUpgradeTarget(undefined, installed, {
				architecture: running.manifest.architecture,
				...(dependencies.repository === undefined
					? {}
					: { repository: dependencies.repository }),
				...(dependencies.apiBase === undefined
					? {}
					: { apiBase: dependencies.apiBase }),
				...(dependencies.webBase === undefined
					? {}
					: { webBase: dependencies.webBase }),
			});
		} catch (error) {
			if (error instanceof NoChannelError) {
				throw new UpgradeError(
					'this image was built locally, so it has no release channel to follow. Build or pull a newer image and recreate the container yourself.',
				);
			}
			throw error;
		}
		if (available.channel !== 'tag') {
			throw new UpgradeError(
				`this container runs the image tagged ${reference.tag}, but the server in it follows the ${available.channel} channel, which has no image tag of that kind to move to.`,
			);
		}
		if (compareVersions(available.version, reference.version) < 0) {
			throw new UpgradeError(
				`refusing to move the container from the image tagged ${reference.tag} down to ${available.version}.`,
			);
		}
		target = resolveTargetImage(
			container.Config.Image ?? '',
			available.version,
		);
	} else {
		target = resolveTargetImage(container.Config.Image ?? '');
	}
	const toLabel = label(
		reference.kind === 'version' ? target.tag.replace(/^v/u, '') : target.tag,
	);

	// From here something was attempted, so a refusal is on the record for the
	// server that keeps running to report.
	const refuse = async (reason: string): Promise<never> => {
		await writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: toLabel,
			outcome: 'rolled-back',
			reason,
		}).catch(() => undefined);
		throw new UpgradeError(reason);
	};

	if ((await readPendingUpgrade(layout)) !== undefined) {
		throw new UpgradeError(
			'an upgrade is already in progress in this container.',
		);
	}
	if (
		(await docker.inspectContainer(`${name}${HELPER_SUFFIX}`)) !== undefined
	) {
		throw new UpgradeError(
			'this container is already being recreated on a newer image.',
		);
	}
	if (
		(await docker.inspectContainer(`${name}${PREVIOUS_SUFFIX}`)) !== undefined
	) {
		await refuse(
			`a container named ${name}${PREVIOUS_SUFFIX} is left from an earlier recreate that did not finish. Remove it, or start it under its own name again, and then retry; nothing was changed.`,
		);
	}

	write(`Pulling ${target.reference} …`);
	let pulled: DockerImage | undefined;
	try {
		await docker.pullImage(target.repository, target.tag);
		pulled = await docker.inspectImage(target.reference);
	} catch (error) {
		await refuse(
			`the image ${target.reference.slice(0, 160)} could not be pulled, so nothing was changed: ${reasonOf(error)}`,
		);
	}
	if (pulled === undefined) {
		await refuse(
			`the image ${target.reference.slice(0, 160)} was pulled but the Docker daemon does not have it, so nothing was changed.`,
		);
	}
	if (pulled?.Id === container.Image) {
		write(
			`This container already runs the newest image of ${target.reference}. Nothing to do.`,
		);
		return Object.freeze({
			from: running.manifest.version,
			to: running.manifest.version,
			rolledBack: false,
			upToDate: true,
		});
	}

	let helper: string | undefined;
	try {
		helper = await docker.createContainer(
			`${name}${HELPER_SUFFIX}`,
			helperSpec(self, target, { from: fromLabel, to: toLabel }),
		);
		await docker.startContainer(helper);
	} catch (error) {
		if (helper !== undefined)
			await docker
				.removeContainer(helper, { force: true })
				.catch(() => undefined);
		await refuse(
			`the helper that replaces the container could not be started, so nothing was changed: ${reasonOf(error)}`,
		);
	}

	write(
		`Recreating ${name} on ${target.reference}. This container stops now, and every terminal in it ends.`,
	);
	// Nothing below is needed for the replacement to happen: the helper stops
	// this container, and this process with it. It stays only so the server
	// that started it goes on saying an upgrade is in progress until it is
	// stopped, and so a helper that gave up without touching the container is
	// reported as a failure. One blocking call with a deadline, not a poll
	// (ADR-0028 decision 3).
	const ended = await docker
		.waitContainer(
			helper as string,
			dependencies.handoverTimeoutMs ?? HANDOVER_TIMEOUT_MS,
		)
		.catch(() => undefined);
	if (ended === undefined || ended === 0) {
		return Object.freeze({
			from: running.manifest.version,
			to: toLabel,
			rolledBack: false,
			upToDate: false,
		});
	}
	throw new UpgradeError(
		'the container was not recreated. The reason is recorded and shown as the last upgrade outcome.',
	);
}

/**
 * Start the replacement and hear whether it becomes healthy.
 *
 * Returns nothing on success and the reason on failure. Event-driven: the
 * engine's event stream for this one container is opened before the container
 * is started, so its health verdict and its ending are told to this process as
 * they happen and none can be missed. One inspect straight after the start
 * covers a container that had already reached a verdict by then. A single
 * one-shot deadline bounds the whole wait. Nothing here asks again on a timer.
 *
 * A container whose health check was switched off has no verdict to give, so
 * it is judged by whether it is still running after one short one-shot grace
 * period: a `die` inside it is a failure, and its passing is success.
 */
async function startAndAwaitHealthy(
	docker: DockerApi,
	id: string,
	dependencies: RecreateDependencies,
): Promise<string | undefined> {
	const timeoutMs = dependencies.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
	const settleMs = dependencies.settleMs ?? SETTLE_MS;
	type Verdict =
		| { readonly kind: 'healthy' }
		| { readonly kind: 'unhealthy' }
		| { readonly kind: 'failed'; readonly reason: string };
	let settle: (verdict: Verdict) => void = () => undefined;
	const verdict = new Promise<Verdict>((resolve) => {
		settle = resolve;
	});
	const failed = (reason: string) => settle({ kind: 'failed', reason });

	const watch = await docker.watchContainer(id, (event) => {
		if (event.action === 'health_status: healthy') settle({ kind: 'healthy' });
		else if (event.action === 'health_status: unhealthy')
			settle({ kind: 'unhealthy' });
		else if (event.action === 'die')
			failed(
				`it exited with status ${event.exitCode ?? 'unknown'} before it was healthy`,
			);
		else if (event.action === 'destroy')
			failed('it disappeared after it was started');
	});
	// Without the stream nothing would say how the container fared, so its
	// ending is itself a failure rather than a reason to start asking.
	void watch.ended.then((error) =>
		failed(
			`the Docker daemon stopped reporting on it before it was healthy${error === undefined ? '' : `: ${reasonOf(error)}`}`,
		),
	);
	const deadline = setTimeout(
		() =>
			failed(
				`it did not report healthy within ${Math.round(timeoutMs / 1000)} seconds`,
			),
		timeoutMs,
	);
	let grace: ReturnType<typeof setTimeout> | undefined;
	const unhealthy = (state: NonNullable<DockerContainer['State']>): string => {
		const last = state.Health?.Log?.at(-1)?.Output?.trim();
		return `its health check failed${last === undefined || last.length === 0 ? '' : `: ${reasonOf(last)}`}`;
	};
	try {
		await docker.startContainer(id);
		const state = (await docker.inspectContainer(id))?.State;
		const health = state?.Health?.Status;
		if (state == null) failed('it disappeared after it was started');
		else if (health === 'healthy') settle({ kind: 'healthy' });
		else if (health === 'unhealthy') failed(unhealthy(state));
		else if (state.Running !== true && state.Restarting !== true)
			failed(
				`it exited with status ${state.ExitCode ?? 'unknown'} before it was healthy`,
			);
		else if (health === undefined || health === 'none' || health === '')
			grace = setTimeout(() => settle({ kind: 'healthy' }), settleMs);

		const outcome = await verdict;
		if (outcome.kind === 'healthy') return undefined;
		if (outcome.kind === 'failed') return outcome.reason;
		// The event says the check failed; what the check printed is in the
		// container's state, read once to say why.
		const final = (await docker.inspectContainer(id).catch(() => undefined))
			?.State;
		return final == null ? 'its health check failed' : unhealthy(final);
	} finally {
		clearTimeout(deadline);
		clearTimeout(grace);
		watch.close();
	}
}

/**
 * Leave the data volume as a container that starts from nothing expects it.
 *
 * The old container was stopped rather than restarted, so its entrypoint never
 * settled what it had in flight. An unconfirmed in-place upgrade is undone
 * here, before the outcome of this recreate is written: left for the new
 * container's entrypoint, it would be undone there and recorded over it.
 */
async function settleDataVolume(layout: ContainerLayout): Promise<void> {
	await rm(layout.restartMarker, { force: true }).catch(() => undefined);
	await rm(layout.serverPidPath, { force: true }).catch(() => undefined);
	const pending = await readPendingUpgrade(layout).catch(() => undefined);
	if (pending !== undefined) {
		await rollBackPending(
			layout,
			pending,
			`the container was recreated before ${pending.to} reported ready`,
		).catch(() => undefined);
	}
}

/** The release a container on this image and this volume will start. */
async function selectedLabel(
	layout: ContainerLayout,
): Promise<string | undefined> {
	try {
		const selected = await selectRelease(layout);
		return label(
			containerReleaseLabel(await readArchiveManifest(selected.root)),
		);
	} catch {
		return undefined;
	}
}

/**
 * The hidden `terminay container-recreate <container> <image> <from> <to>`
 * command, run in the helper container on the new image.
 *
 * Its arguments come from the command above, which is the only thing that
 * starts it. They are still checked against the engine: the container must be
 * a Terminay server on this data volume that may be recreated, and the image
 * it moves to is a reference, never a path or an option.
 */
export async function runContainerRecreateHelper(
	argv: readonly string[],
	dependencies: RecreateDependencies = {},
	log: (line: string) => void = (line) =>
		process.stderr.write(`terminay: ${line}\n`),
): Promise<number> {
	const env = dependencies.env ?? process.env;
	const [oldId, reference, from, fallbackTo] = argv;
	if (
		argv.length !== 4 ||
		oldId === undefined ||
		!/^[a-f0-9]{64}$/u.test(oldId) ||
		reference === undefined ||
		parseImageReference(reference).kind === 'pinned' ||
		from === undefined ||
		fallbackTo === undefined
	) {
		log(
			`${HELPER_COMMAND} expects a container id, an image reference, and the two release labels`,
		);
		return 64;
	}
	const layout = containerLayout(env);
	const dataRoot = dirname(layout.prefix);
	const docker =
		dependencies.docker ?? createDockerClient(dockerSocketPath(env));
	const fromLabel = label(from);
	let toLabel = label(fallbackTo);
	const record = (outcome: 'succeeded' | 'rolled-back', reason?: string) =>
		writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: toLabel,
			outcome,
			...(reason === undefined ? {} : { reason }),
		}).catch((error) => {
			log(`the outcome could not be recorded: ${reasonOf(error)}`);
		});

	let old: DockerContainer;
	let replacement: Replacement;
	let name: string;
	try {
		const inspected = await docker.inspectContainer(oldId);
		if (inspected === undefined || inspected.Id !== oldId)
			throw new Error('the container to replace no longer exists');
		if (!isThisServer(inspected, dataRoot))
			throw new Error(
				'the container to replace is not a Terminay server on this data volume',
			);
		const refusal = recreateRefusal(inspected, dataRoot);
		if (refusal !== undefined) throw new Error(refusal);
		const image = await docker.inspectImage(inspected.Image);
		if (image === undefined)
			throw new Error(
				'the image the container was created from is no longer on this machine',
			);
		old = inspected;
		name = containerName(old);
		if (
			(await docker.inspectContainer(`${name}${PREVIOUS_SUFFIX}`)) !== undefined
		)
			throw new Error(
				`a container named ${name}${PREVIOUS_SUFFIX} is left from an earlier recreate`,
			);
		replacement = buildReplacement(old, image, reference);
	} catch (error) {
		const reason = `the container was not recreated and nothing was changed: ${reasonOf(error)}`;
		log(reason);
		await record('rolled-back', reason);
		return 1;
	}

	let renamed = false;
	let created: string | undefined;
	try {
		log(`stopping ${name}`);
		await docker.stopContainer(old.Id);
		await docker.renameContainer(old.Id, `${name}${PREVIOUS_SUFFIX}`);
		renamed = true;
		await settleDataVolume(layout);
		toLabel = (await selectedLabel(layout)) ?? toLabel;

		log(`creating ${name} from ${reference}`);
		created = await docker.createContainer(name, replacement.spec);
		for (const network of replacement.networks)
			await docker.connectNetwork(network.name, created, network.endpoint);
		// Written before the new server starts, because a server reads the
		// record as it starts and would otherwise come up with nothing to
		// report. Should the replacement not turn out healthy, the record is
		// replaced below before the old container is started again.
		await record('succeeded');
		const unhealthy = await startAndAwaitHealthy(docker, created, dependencies);
		if (unhealthy !== undefined) throw new Error(unhealthy);
	} catch (error) {
		const failure = reasonOf(error);
		log(`the replacement failed: ${failure}; restoring ${name}`);
		const problems: string[] = [];
		if (created !== undefined) {
			await docker
				.removeContainer(created, { force: true })
				.catch((problem) => {
					problems.push(
						`the failed replacement could not be removed (${reasonOf(problem)})`,
					);
				});
		}
		if (renamed) {
			await docker.renameContainer(old.Id, name).catch((problem) => {
				problems.push(
					`the previous container could not be given its name back and is still called ${name}${PREVIOUS_SUFFIX} (${reasonOf(problem)})`,
				);
			});
		}
		// Recorded before the old server starts, so it is what that server
		// reads; a start that then fails is added to it.
		const restored = (): string =>
			`the container recreated on ${reference.slice(0, 160)} was not kept: ${failure}. The previous container was restored${problems.length === 0 ? '' : `, but ${problems.join(', and ')}`}.`;
		await record('rolled-back', restored());
		try {
			await docker.startContainer(old.Id);
		} catch (problem) {
			problems.push(`it could not be started again (${reasonOf(problem)})`);
			await record('rolled-back', restored());
		}
		return 1;
	}

	// The replacement is healthy. The old container goes; its volumes are the
	// replacement's now and are never removed with it.
	await docker.removeContainer(old.Id).catch((error) => {
		log(
			`the previous container is still present as ${name}${PREVIOUS_SUFFIX} and can be removed: ${reasonOf(error)}`,
		);
	});
	log(`${name} now runs ${reference}`);
	return 0;
}
