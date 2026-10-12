/**
 * What the window knows about each attached server's own upgrade (ADR-0062).
 *
 * The server decides what is installed and publishes its status; this only
 * arranges that status for the header, the connection menu, and the
 * confirmation. Everything is kept per connection, keyed by its profile, so
 * one server's status never describes another, and Local is left out before
 * anything is read: it is updated with Terminay Desktop.
 *
 * An upgrade restarts the server, which replaces the connection's client. What
 * this window was following therefore lives here rather than beside a client,
 * so the outcome that arrives on the new connection is recognised as the end
 * of the upgrade the old one watched begin, and is told once.
 */

import type {
	ServerUpgradeMode,
	ServerUpgradeStatus,
} from '@terminay/client-core';
import type { ConnectionPhase } from '../shared/connections/connectionRegistry';

/**
 * How long a server may be gone after an upgrade began before the window says
 * it did not come back. The connection layer retries without a deadline of its
 * own, so this is the one the outcome is held to. It is a single deadline
 * armed when the connection drops, never a poll (ADR-0028).
 */
export const SERVER_UPGRADE_RETURN_DEADLINE_MS = 5 * 60_000;

type UpgradeStatusStore = Readonly<{
	status: ServerUpgradeStatus | undefined;
	subscribe: (
		listener: (status: ServerUpgradeStatus | undefined) => void,
	) => () => void;
}>;

/** One attached server the window may show an upgrade for. */
export type ServerUpgradeSource = Readonly<{
	profileId: string;
	/** Known once the server has said hello; what its memory is kept under. */
	serverId?: string;
	label: string;
	phase: ConnectionPhase;
	/** Absent while the connection is down, or when the server publishes no
	 * upgrade status at all. */
	client?: Readonly<{ store: UpgradeStatusStore }>;
}>;

type LocalCandidate = Readonly<{
	profileId: string;
	serverId?: string;
	/** Desktop's description of the window's own connection. */
	hostContext?: Readonly<{
		profile?: Readonly<{ isLocal?: boolean }>;
		profiles?: readonly Readonly<{
			id: string;
			isLocal?: boolean;
			serverId?: string;
		}>[];
	}>;
}>;

/**
 * Whether a connection is this machine's own embedded server. Decided from
 * what the host says about its profiles, never from the status the server
 * reports, so Local shows no server upgrade whatever it publishes.
 */
export function isLocalConnection(
	connection: LocalCandidate,
	profiles: readonly Readonly<{
		id: string;
		isLocal?: boolean;
		serverId?: string;
	}>[],
): boolean {
	// Desktop says which profile its window is showing; a Desktop window that
	// is told of none is showing Local, as its label is.
	const host = connection.hostContext;
	if (host !== undefined && host.profile?.isLocal !== false) return true;
	return [...profiles, ...(host?.profiles ?? [])].some(
		(profile) =>
			profile.isLocal === true &&
			(profile.id === connection.profileId ||
				(profile.serverId !== undefined &&
					profile.serverId === connection.serverId)),
	);
}

/** The attached servers an upgrade may be shown for: every one but Local. */
export function serverUpgradeSources(
	connections: readonly (LocalCandidate &
		Readonly<{
			label: string;
			phase: ConnectionPhase;
			context?: Readonly<{
				serverUpgradeClient?: Readonly<{ store: UpgradeStatusStore }>;
			}>;
		}>)[],
	profiles: Parameters<typeof isLocalConnection>[1],
): readonly ServerUpgradeSource[] {
	return connections
		.filter((connection) => !isLocalConnection(connection, profiles))
		.map((connection) => ({
			profileId: connection.profileId,
			label: connection.label,
			phase: connection.phase,
			...(connection.serverId === undefined
				? {}
				: { serverId: connection.serverId }),
			...(connection.context?.serverUpgradeClient === undefined
				? {}
				: { client: connection.context.serverUpgradeClient }),
		}));
}

/** A server's latest status, and whether it can be asked for anything now. */
export type ServerUpgradeEntry = Readonly<{
	profileId: string;
	label: string;
	status: ServerUpgradeStatus;
	/** False while the connection is down: nothing can be sent. */
	reachable: boolean;
}>;

/** The end of an upgrade this window watched, told once and then dismissed. */
export type ServerUpgradeNotice = Readonly<{
	id: string;
	profileId: string;
	tone: 'success' | 'failure';
	text: string;
}>;

export type ServerUpgradeBoardSnapshot = Readonly<{
	/** In connection order; only servers that have published a status. */
	entries: readonly ServerUpgradeEntry[];
	notices: readonly ServerUpgradeNotice[];
}>;

export function upgradeSucceededText(label: string, version: string): string {
	return `${label} is now on ${version}.`;
}

export function upgradeFailedText(
	label: string,
	from: string,
	reason: string | undefined,
): string {
	const why =
		reason === undefined ? '' : `: ${reason.trim().replace(/[.\s]+$/, '')}`;
	return `Upgrading ${label} failed${why}. ${from} is running again.`;
}

export function upgradeLostText(label: string): string {
	return `${label} did not come back after the upgrade.`;
}

/**
 * What this device remembers of one server's upgrade between documents.
 *
 * A server that restarts takes the workspace away with it: the window shows
 * its reconnecting screen in the workspace's place, and a browser may load
 * the document afresh. Whatever was following the upgrade is gone by the time
 * the outcome arrives, so the fact that it was followed is kept here.
 */
export type RememberedServerUpgrade = Readonly<{
	/** An upgrade this device saw begin, or began, and has not seen end. */
	following?: Readonly<{
		/** The server's own time for the start, when its status gave one. */
		startedAt?: number;
		/** The version it was running. */
		from?: string;
	}>;
	/** The times of the outcomes this device has already been shown. */
	seen: readonly number[];
}>;

export type ServerUpgradeMemory = Readonly<{
	read: (serverId: string) => RememberedServerUpgrade;
	write: (serverId: string, remembered: RememberedServerUpgrade) => void;
}>;

const MEMORY_STORAGE_KEY = 'terminay.view.server-upgrades.v1';
/** Bounded so a long-lived profile cannot accumulate servers it has left. */
const MAX_REMEMBERED_SERVERS = 32;
const MAX_REMEMBERED_OUTCOMES = 8;
/** An upgrade is over, one way or the other, long before this. A marker left
 * behind by one whose end was never seen must not claim a later outcome. */
export const SERVER_UPGRADE_MEMORY_MAX_AGE_MS = 24 * 60 * 60_000;

const NOTHING_REMEMBERED: RememberedServerUpgrade = Object.freeze({
	seen: Object.freeze([]),
});

/**
 * Per-device memory in this origin's storage, keyed by server. Best-effort, as
 * all view state is: storage that is missing, full, or disabled is a normal
 * condition, and a device that cannot remember only misses being told.
 */
export function createServerUpgradeMemory(
	storage:
		| Pick<Storage, 'getItem' | 'setItem'>
		| undefined = readLocalStorage(),
	now: () => number = Date.now,
): ServerUpgradeMemory {
	const readAll = (): Record<string, unknown> => {
		try {
			const raw = storage?.getItem(MEMORY_STORAGE_KEY);
			if (raw === null || raw === undefined) return {};
			const parsed: unknown = JSON.parse(raw);
			return typeof parsed === 'object' &&
				parsed !== null &&
				!Array.isArray(parsed)
				? { ...(parsed as Record<string, unknown>) }
				: {};
		} catch {
			return {};
		}
	};
	return Object.freeze({
		read: (serverId) => {
			const entry = readAll()[serverId];
			if (typeof entry !== 'object' || entry === null)
				return NOTHING_REMEMBERED;
			const { following, seen } = entry as {
				following?: unknown;
				seen?: unknown;
			};
			const marker =
				typeof following === 'object' && following !== null
					? (following as {
							notedAt?: unknown;
							startedAt?: unknown;
							from?: unknown;
						})
					: undefined;
			const live =
				marker !== undefined &&
				typeof marker.notedAt === 'number' &&
				now() - marker.notedAt >= 0 &&
				now() - marker.notedAt < SERVER_UPGRADE_MEMORY_MAX_AGE_MS;
			return {
				seen: Array.isArray(seen)
					? seen.filter((at): at is number => typeof at === 'number' && at >= 0)
					: [],
				...(live
					? {
							following: {
								...(typeof marker.startedAt === 'number'
									? { startedAt: marker.startedAt }
									: {}),
								...(typeof marker.from === 'string'
									? { from: marker.from }
									: {}),
							},
						}
					: {}),
			};
		},
		write: (serverId, remembered) => {
			try {
				const all = readAll();
				// Re-inserting moves this server to the end, so the bound evicts
				// the one least recently written rather than an arbitrary one.
				delete all[serverId];
				if (remembered.following !== undefined || remembered.seen.length > 0)
					all[serverId] = {
						seen: remembered.seen.slice(-MAX_REMEMBERED_OUTCOMES),
						...(remembered.following === undefined
							? {}
							: { following: { ...remembered.following, notedAt: now() } }),
					};
				storage?.setItem(
					MEMORY_STORAGE_KEY,
					JSON.stringify(
						Object.fromEntries(
							Object.entries(all).slice(-MAX_REMEMBERED_SERVERS),
						),
					),
				);
			} catch {
				/* A device that cannot remember still works. */
			}
		},
	});
}

function readLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}

type Tracked = {
	source: ServerUpgradeSource;
	/** The server this record's state, and its memory, belong to. */
	serverId: string | undefined;
	client: ServerUpgradeSource['client'];
	unsubscribe: (() => void) | undefined;
	status: ServerUpgradeStatus | undefined;
	/** This window saw the upgrade begin, or began it. */
	following: boolean;
	followedFrom: string | undefined;
	/** The server's time for the start; an outcome older than it is not its. */
	startedAt: number | undefined;
	/** The server is expected to restart. False once it says, still running,
	 * that no upgrade is: an ordinary disconnect is then not a lost server. */
	expectsRestart: boolean;
	/** The connection went away while following; set to the client it had. */
	dropped: boolean;
	droppedClient: ServerUpgradeSource['client'];
	deadline: unknown;
	/** Every outcome this window has been shown, by its time, so a status that
	 * is published again, or read again after a reconnect, is not news. */
	seenOutcomes: Set<number>;
};

const EMPTY_BOARD: ServerUpgradeBoardSnapshot = Object.freeze({
	entries: Object.freeze([]),
	notices: Object.freeze([]),
});

export class ServerUpgradeBoard {
	private readonly tracked = new Map<string, Tracked>();
	private readonly listeners = new Set<() => void>();
	private notices: readonly ServerUpgradeNotice[] = EMPTY_BOARD.notices;
	private order: readonly string[] = [];
	private current: ServerUpgradeBoardSnapshot = EMPTY_BOARD;
	private lostCount = 0;
	private readonly deadlineMs: number;
	private readonly setTimer: (run: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private readonly memory: ServerUpgradeMemory | undefined;

	constructor(
		options: Readonly<{
			deadlineMs?: number;
			/** Where a followed upgrade is remembered between documents. Without
			 * one the board remembers only for as long as it lives. */
			memory?: ServerUpgradeMemory;
			setTimer?: (run: () => void, delayMs: number) => unknown;
			clearTimer?: (handle: unknown) => void;
		}> = {},
	) {
		this.deadlineMs = options.deadlineMs ?? SERVER_UPGRADE_RETURN_DEADLINE_MS;
		this.memory = options.memory;
		this.setTimer =
			options.setTimer ??
			((run, delayMs) => globalThis.setTimeout(run, delayMs));
		this.clearTimer =
			options.clearTimer ??
			((handle) =>
				globalThis.clearTimeout(
					handle as ReturnType<typeof globalThis.setTimeout>,
				));
	}

	get snapshot(): ServerUpgradeBoardSnapshot {
		return this.current;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Bring the board in step with the connections the window holds now. */
	sync(sources: readonly ServerUpgradeSource[]): void {
		const present = new Set(sources.map((source) => source.profileId));
		for (const [profileId, record] of this.tracked) {
			if (present.has(profileId)) continue;
			// Detached for good: its status is no longer this window's to show.
			this.release(record);
			this.tracked.delete(profileId);
		}
		this.order = sources.map((source) => source.profileId);
		for (const source of sources) {
			let record = this.tracked.get(source.profileId);
			if (record === undefined) {
				record = {
					source,
					serverId: undefined,
					client: undefined,
					unsubscribe: undefined,
					status: undefined,
					following: false,
					followedFrom: undefined,
					startedAt: undefined,
					expectsRestart: false,
					dropped: false,
					droppedClient: undefined,
					deadline: undefined,
					seenOutcomes: new Set(),
				};
				this.tracked.set(source.profileId, record);
			}
			record.source = source;
			if (source.serverId !== undefined && source.serverId !== record.serverId)
				this.recall(record, source.serverId);
			if (source.client !== record.client) this.bind(record, source.client);
			this.noteConnection(record);
		}
		this.publish();
	}

	/** This window asked the server to begin. Said separately from the status
	 * because a server can restart before its in-progress status arrives. */
	markStarted(profileId: string): void {
		const record = this.tracked.get(profileId);
		if (record === undefined) return;
		this.follow(record);
		this.noteConnection(record);
		this.publish();
	}

	dismiss(noticeId: string): void {
		const remaining = this.notices.filter((notice) => notice.id !== noticeId);
		if (remaining.length === this.notices.length) return;
		this.notices = Object.freeze(remaining);
		this.publish();
	}

	dispose(): void {
		for (const record of this.tracked.values()) this.release(record);
		this.tracked.clear();
		this.listeners.clear();
	}

	/**
	 * Take up what this device remembers of a server, now that the connection
	 * says which server it is. An upgrade remembered as followed began in a
	 * document that is gone, so whatever this connection says first is the
	 * server's return from it.
	 */
	private recall(record: Tracked, serverId: string): void {
		if (record.serverId !== undefined) {
			// The same connection now reaches a different server. Nothing held
			// about the last one describes it.
			this.settleConnection(record);
			record.status = undefined;
			record.following = false;
			record.followedFrom = undefined;
			record.startedAt = undefined;
			record.expectsRestart = false;
		}
		record.serverId = serverId;
		const remembered = this.memory?.read(serverId);
		record.seenOutcomes = new Set(remembered?.seen ?? []);
		if (remembered?.following === undefined || record.following) return;
		record.following = true;
		record.expectsRestart = true;
		record.followedFrom = remembered.following.from;
		record.startedAt = remembered.following.startedAt;
		record.dropped = true;
		record.droppedClient = undefined;
	}

	private remember(record: Tracked): void {
		if (record.serverId === undefined) return;
		this.memory?.write(record.serverId, {
			seen: [...record.seenOutcomes].sort((left, right) => left - right),
			...(record.following
				? {
						following: {
							...(record.startedAt === undefined
								? {}
								: { startedAt: record.startedAt }),
							...(record.followedFrom === undefined
								? {}
								: { from: record.followedFrom }),
						},
					}
				: {}),
		});
	}

	private bind(record: Tracked, client: ServerUpgradeSource['client']): void {
		record.unsubscribe?.();
		record.unsubscribe = undefined;
		record.client = client;
		if (client === undefined) {
			// A reconnect replaces the client behind the same server. While an
			// upgrade is being followed the row keeps saying so through the gap;
			// otherwise a status nothing is publishing any more is not shown.
			if (!record.following) record.status = undefined;
			return;
		}
		record.unsubscribe = client.store.subscribe((status) => {
			if (record.client !== client) return;
			this.receive(record, status);
			this.publish();
		});
		if (client.store.status === undefined) {
			if (!record.following) record.status = undefined;
		} else this.receive(record, client.store.status);
	}

	private receive(
		record: Tracked,
		status: ServerUpgradeStatus | undefined,
	): void {
		if (status === undefined) {
			if (!record.following) record.status = undefined;
			return;
		}
		record.status = status;
		// Any status from the connection that replaced the dropped one means the
		// server came back, whatever it goes on to say.
		const returned = record.dropped && record.client !== record.droppedClient;
		if (returned) this.settleConnection(record);
		const progress = status.upgrade;
		if (progress.state === 'in-progress') {
			this.follow(record, progress.startedAt);
			return;
		}
		if (progress.state === 'none') {
			if (!record.following) return;
			if (!returned) {
				// Said by the server that was to restart, without restarting: its
				// upgrader has finished. How it ended follows in the next status.
				record.expectsRestart = false;
				return;
			}
			// The outcome was replaced before this window reconnected. The version
			// the server now runs still says how a followed upgrade ended.
			const from = record.followedFrom;
			this.unfollow(record);
			if (from !== undefined && from !== status.version)
				this.tell(
					record,
					`moved:${status.version}`,
					'success',
					upgradeSucceededText(record.source.label, status.version),
				);
			return;
		}
		const unseen = !record.seenOutcomes.has(progress.at);
		// An outcome from before the followed upgrade began is an earlier one's.
		const fresh =
			unseen &&
			(record.startedAt === undefined || progress.at >= record.startedAt);
		record.seenOutcomes.add(progress.at);
		// An outcome already seen belongs to an earlier attempt, and one that
		// arrives unfollowed ended an upgrade this window never watched: the
		// menu row says how it stands, and nothing is announced.
		if (!fresh || !record.following) {
			if (unseen) this.remember(record);
			return;
		}
		this.unfollow(record);
		if (progress.state === 'succeeded')
			this.tell(
				record,
				String(progress.at),
				'success',
				upgradeSucceededText(record.source.label, progress.to),
			);
		else
			this.tell(
				record,
				String(progress.at),
				'failure',
				upgradeFailedText(record.source.label, progress.from, progress.reason),
			);
	}

	private follow(record: Tracked, startedAt?: number): void {
		if (record.following) {
			// Begun here before the server said when: now it has.
			if (startedAt === undefined || record.startedAt !== undefined) return;
			record.startedAt = startedAt;
			this.remember(record);
			return;
		}
		record.following = true;
		record.expectsRestart = true;
		record.followedFrom = record.status?.version;
		record.startedAt = startedAt;
		this.remember(record);
	}

	private unfollow(record: Tracked): void {
		record.following = false;
		record.expectsRestart = false;
		record.followedFrom = undefined;
		record.startedAt = undefined;
		this.settleConnection(record);
		this.remember(record);
	}

	private settleConnection(record: Tracked): void {
		record.dropped = false;
		record.droppedClient = undefined;
		if (record.deadline !== undefined) this.clearTimer(record.deadline);
		record.deadline = undefined;
	}

	/** Notice the connection going away under a followed upgrade, and hold its
	 * return to one deadline. */
	private noteConnection(record: Tracked): void {
		if (!record.following) return;
		const { phase } = record.source;
		if (phase === 'ready' && record.client !== undefined) return;
		if (!record.dropped) {
			record.dropped = true;
			record.droppedClient = record.client;
		}
		// Reached, and refused: it came back, as a server this bundle cannot
		// speak to. The connection's own presentation says which side to update.
		if (phase === 'incompatible') {
			this.unfollow(record);
			return;
		}
		if (!record.expectsRestart) return;
		// The connection layer has stopped trying: that is its own verdict.
		if (phase === 'unreachable') {
			this.lose(record);
			return;
		}
		if (record.deadline !== undefined) return;
		record.deadline = this.setTimer(() => {
			record.deadline = undefined;
			if (!record.following) return;
			// Connected again but silent about its upgrade: it did come back.
			if (
				record.source.phase === 'ready' &&
				record.client !== record.droppedClient
			) {
				this.unfollow(record);
				return;
			}
			this.lose(record);
			this.publish();
		}, this.deadlineMs);
	}

	private lose(record: Tracked): void {
		this.unfollow(record);
		// Whatever it last said is no longer known to be true.
		record.status = undefined;
		this.lostCount += 1;
		this.tell(
			record,
			`lost:${this.lostCount}`,
			'failure',
			upgradeLostText(record.source.label),
		);
	}

	private tell(
		record: Tracked,
		key: string,
		tone: ServerUpgradeNotice['tone'],
		text: string,
	): void {
		const id = `${record.source.profileId}:${key}`;
		if (this.notices.some((notice) => notice.id === id)) return;
		this.notices = Object.freeze([
			...this.notices,
			Object.freeze({ id, profileId: record.source.profileId, tone, text }),
		]);
	}

	private release(record: Tracked): void {
		record.unsubscribe?.();
		record.unsubscribe = undefined;
		if (record.deadline !== undefined) this.clearTimer(record.deadline);
		record.deadline = undefined;
	}

	private publish(): void {
		const entries: ServerUpgradeEntry[] = [];
		for (const profileId of this.order) {
			const record = this.tracked.get(profileId);
			if (record?.status === undefined) continue;
			entries.push(
				Object.freeze({
					profileId,
					label: record.source.label,
					status: record.status,
					reachable:
						record.source.phase === 'ready' && record.client !== undefined,
				}),
			);
		}
		const previous = this.current;
		const unchanged =
			previous.notices === this.notices &&
			previous.entries.length === entries.length &&
			entries.every((entry, index) => {
				const before = previous.entries[index];
				return (
					before !== undefined &&
					before.profileId === entry.profileId &&
					before.label === entry.label &&
					before.status === entry.status &&
					before.reachable === entry.reachable
				);
			});
		if (unchanged) return;
		this.current = Object.freeze({
			entries: Object.freeze(entries),
			notices: this.notices,
		});
		for (const listener of [...this.listeners]) listener();
	}
}

/** What a server's row in the connection menu says and offers. */
export type ServerUpgradeRow = Readonly<{
	profileId: string;
	label: string;
	/** The release the server is running. */
	version: string;
	available?: string;
	/**
	 * `upgrade` offers the action; `upgrading` says one is running and offers
	 * nothing, on every client; `manual` gives the reason and the command an
	 * operator runs on the host; `none` only states what is known.
	 */
	action: 'upgrade' | 'upgrading' | 'manual' | 'none';
	/** False while the connection is down: the action is shown but not live. */
	reachable: boolean;
	reason?: string;
	command?: string;
	/** How the last attempt ended, when it failed and was rolled back. */
	failure?: string;
}>;

/** The row for one server, or `undefined` when it has nothing to say. */
export function serverUpgradeRow(
	entry: ServerUpgradeEntry,
): ServerUpgradeRow | undefined {
	const { status } = entry;
	const available = status.available?.version;
	const progress = status.upgrade;
	if (
		available === undefined &&
		progress.state !== 'in-progress' &&
		progress.state !== 'failed'
	)
		return undefined;
	const manual =
		available !== undefined && !status.canUpgrade
			? status.unavailable
			: undefined;
	const action: ServerUpgradeRow['action'] =
		progress.state === 'in-progress'
			? 'upgrading'
			: available !== undefined && status.canUpgrade && status.modes.length > 0
				? 'upgrade'
				: manual !== undefined
					? 'manual'
					: 'none';
	return Object.freeze({
		profileId: entry.profileId,
		label: entry.label,
		version: status.version,
		action,
		reachable: entry.reachable,
		...(available === undefined ? {} : { available }),
		...(action === 'manual' && manual !== undefined
			? { reason: manual.reason, command: manual.command }
			: {}),
		...(progress.state === 'failed'
			? {
					failure: upgradeFailedText(
						entry.label,
						progress.from,
						progress.reason,
					),
				}
			: {}),
	});
}

export function serverUpgradeRows(
	entries: readonly ServerUpgradeEntry[],
): readonly ServerUpgradeRow[] {
	return entries.flatMap((entry) => serverUpgradeRow(entry) ?? []);
}

/** The version the header's warning names: the active tab's server's, and no
 * other attached server's. */
export function activeServerUpgradeVersion(
	entries: readonly ServerUpgradeEntry[],
	activeProfileId: string | undefined,
): string | undefined {
	if (activeProfileId === undefined) return undefined;
	return entries.find((entry) => entry.profileId === activeProfileId)?.status
		.available?.version;
}

/** Added to the header control's accessible name while its server has one. */
export function upgradeAvailableSuffix(version: string | undefined): string {
	return version === undefined ? '' : `, upgrade to ${version} available`;
}

/** The mode the confirmation opens on: in place whenever it is offered. */
export function preselectedUpgradeMode(
	modes: readonly ServerUpgradeMode[],
): ServerUpgradeMode {
	return modes.includes('in-place') ? 'in-place' : (modes[0] ?? 'in-place');
}

/** What the confirmation says happens to the connection and the terminals. */
export function upgradeConsequenceText(mode: ServerUpgradeMode): string {
	return mode === 'recreate'
		? 'The connection to this server drops while its container is recreated. Every terminal on this server ends.'
		: 'The connection to this server drops briefly while it restarts. Its terminals keep running.';
}

function errorField(cause: unknown, field: 'code' | 'details'): unknown {
	if (typeof cause !== 'object' || cause === null) return undefined;
	const own = (cause as Record<string, unknown>)[field];
	if (own !== undefined) return own;
	// A feature client wraps the protocol error; the refusal is on its cause.
	const inner = (cause as { cause?: unknown }).cause;
	return typeof inner === 'object' && inner !== null
		? (inner as Record<string, unknown>)[field]
		: undefined;
}

/**
 * Whether a failed start may nonetheless have begun: the transport went away
 * after the request was sent, which is what a server restarting to upgrade
 * looks like from here.
 */
export function upgradeStartOutcomeUnknown(cause: unknown): boolean {
	const code = errorField(cause, 'code');
	return code === 'unknown_command_outcome' || code === 'disconnected';
}

/** Why the server refused to begin, in words. */
export function upgradeStartErrorText(cause: unknown): string {
	const details = errorField(cause, 'details');
	const reason =
		typeof details === 'object' && details !== null
			? (details as { reason?: unknown }).reason
			: undefined;
	switch (reason) {
		case 'in-progress':
			return 'An upgrade is already running.';
		case 'none-available':
			return 'This server is already up to date.';
		case 'cannot-upgrade':
			return 'This server cannot upgrade itself. Upgrade it from its host instead.';
		case 'mode-not-offered':
			return 'This server no longer offers that way of upgrading.';
		case 'trigger-failed':
			return 'The server could not start the upgrade.';
		default:
			return 'The upgrade could not be started.';
	}
}

/**
 * Ask a server to begin, and say what came of asking. Resolves with the words
 * for a refusal, or `undefined` once the upgrade is under way — including when
 * the reply was lost to the restart it caused.
 */
export async function requestServerUpgrade(
	client:
		| Readonly<{
				startServerUpgrade: (mode: ServerUpgradeMode) => Promise<unknown>;
		  }>
		| undefined,
	mode: ServerUpgradeMode,
): Promise<string | undefined> {
	if (client === undefined) return 'This server is not connected.';
	try {
		await client.startServerUpgrade(mode);
	} catch (cause) {
		if (!upgradeStartOutcomeUnknown(cause)) return upgradeStartErrorText(cause);
	}
	return undefined;
}
