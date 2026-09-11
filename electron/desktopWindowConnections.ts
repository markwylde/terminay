import type {
	TerminayHostConnectionAttachment,
	TerminayHostConnectionProfile,
	TerminayHostConnectionStatus,
	TerminayWorkspaceComposition,
} from '@terminay/protocol';

/** Non-secret profile metadata the host is allowed to name in the bridge. It
 * deliberately excludes origins, credentials, and pairing material. */
export type DesktopConnectionProfileRecord = Readonly<{
	id: string;
	isLocal: boolean;
	label: string;
	serverId?: string;
}>;

/** One live connection owned by main. The renderer holds only its opaque
 * connection id; the transport, credential, and MessagePort stay here. */
export type DesktopConnectionLane = Readonly<{
	/** Stable server identity this lane's byte endpoint is bound to. */
	serverId: string;
	close: () => Promise<void> | void;
}>;

export type DesktopWindowConnectionsOptions = Readonly<{
	/** The profile whose bundle this window runs. Never rebound by attach. */
	primaryProfileId: string;
	/** Server identity of the primary connection. */
	primaryServerId: string;
	listProfiles: () => readonly DesktopConnectionProfileRecord[];
	/**
	 * Open this profile's transport and hand the renderer its byte endpoint.
	 * Everything credential-bearing happens inside this callback, in main.
	 * `onLost` is invoked if the lane dies without an explicit detach.
	 */
	openLane: (
		profile: DesktopConnectionProfileRecord,
		connectionId: string,
		onLost: () => void,
	) => Promise<DesktopConnectionLane>;
	/** Publish `connections.changed` to the bound document. */
	onChanged?: (profiles: readonly TerminayHostConnectionProfile[]) => void;
	/** Persist this window's composition as device-local presentation state. */
	persistComposition?: (composition: TerminayWorkspaceComposition) => void;
	composition?: TerminayWorkspaceComposition;
}>;

type AttachedRecord = {
	connectionId: string;
	profileId: string;
	serverId?: string;
	status: TerminayHostConnectionStatus;
	lane?: DesktopConnectionLane;
};

let attachSequence = 0;

/**
 * Per-window bookkeeping for one primary connection plus an attached set.
 *
 * A window's primary stays the profile it was bound with (Local for a normal
 * Desktop window); `attach` never rebinds it. Every attached connection is
 * torn down with the window.
 */
export class DesktopWindowConnections {
	private readonly attached = new Map<string, AttachedRecord>();
	private currentComposition: TerminayWorkspaceComposition | undefined;
	private disposed = false;

	constructor(private readonly options: DesktopWindowConnectionsOptions) {
		this.currentComposition = options.composition;
	}

	get composition(): TerminayWorkspaceComposition | undefined {
		return this.currentComposition;
	}

	/** The sanitized profile list the `connections.list` action answers with. */
	list(): readonly TerminayHostConnectionProfile[] {
		const profiles = this.options
			.listProfiles()
			.map((profile) => this.sanitize(profile));
		return Object.freeze(profiles);
	}

	async attach(profileId: string): Promise<TerminayHostConnectionAttachment> {
		if (this.disposed) throw new Error('This window is closed.');
		if (profileId === this.options.primaryProfileId)
			throw new Error('The primary connection is already attached.');
		const existing = this.attached.get(profileId);
		if (existing !== undefined)
			return Object.freeze({
				connectionId: existing.connectionId,
				profileId,
				...(existing.serverId === undefined
					? {}
					: { serverId: existing.serverId }),
			});
		const profile = this.options
			.listProfiles()
			.find((candidate) => candidate.id === profileId);
		if (profile === undefined)
			throw new Error('That connection profile is no longer available.');
		attachSequence += 1;
		const connectionId = `connection:${attachSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const record: AttachedRecord = {
			connectionId,
			profileId,
			status: 'connecting',
			...(profile.serverId === undefined ? {} : { serverId: profile.serverId }),
		};
		this.attached.set(profileId, record);
		this.publish();
		try {
			const lane = await this.options.openLane(profile, connectionId, () =>
				this.markLost(profileId, connectionId),
			);
			if (this.disposed || this.attached.get(profileId) !== record) {
				await lane.close();
				throw new Error('That connection was detached while it opened.');
			}
			record.lane = lane;
			record.serverId = lane.serverId;
			record.status = 'connected';
			this.publish();
			return Object.freeze({
				connectionId,
				profileId,
				serverId: lane.serverId,
			});
		} catch (error) {
			if (this.attached.get(profileId) === record) {
				this.attached.delete(profileId);
				this.publish();
			}
			throw error;
		}
	}

	async detach(profileId: string): Promise<void> {
		if (profileId === this.options.primaryProfileId)
			throw new Error('The primary connection cannot be detached.');
		const record = this.attached.get(profileId);
		if (record === undefined) return;
		this.attached.delete(profileId);
		await closeQuietly(record.lane);
		this.publish();
	}

	/** Store the window's composition. Profiles that are not attached, or not
	 * reachable, stay in the record: the renderer greys their tabs. */
	writeComposition(composition: TerminayWorkspaceComposition): void {
		this.currentComposition = composition;
		this.options.persistComposition?.(composition);
	}

	/** Release every attached connection with the window. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const records = [...this.attached.values()];
		this.attached.clear();
		for (const record of records) await closeQuietly(record.lane);
	}

	private markLost(profileId: string, connectionId: string): void {
		const record = this.attached.get(profileId);
		if (record === undefined || record.connectionId !== connectionId) return;
		if (record.status === 'offline') return;
		record.status = 'offline';
		record.lane = undefined;
		this.publish();
	}

	private sanitize(
		profile: DesktopConnectionProfileRecord,
	): TerminayHostConnectionProfile {
		const isPrimary = profile.id === this.options.primaryProfileId;
		const record = this.attached.get(profile.id);
		const status: TerminayHostConnectionStatus = isPrimary
			? 'connected'
			: (record?.status ?? 'offline');
		const serverId = isPrimary
			? this.options.primaryServerId
			: (record?.serverId ?? profile.serverId);
		return Object.freeze({
			id: profile.id,
			isLocal: profile.isLocal,
			label: profile.label,
			status,
			attached: isPrimary || record !== undefined,
			...(serverId === undefined ? {} : { serverId }),
		});
	}

	private publish(): void {
		if (this.disposed) return;
		try {
			this.options.onChanged?.(this.list());
		} catch {
			// Status publication is observability for the bound document. It must
			// never destabilize an attach, detach, or window teardown path.
		}
	}
}

async function closeQuietly(lane: DesktopConnectionLane | undefined) {
	if (lane === undefined) return;
	try {
		await lane.close();
	} catch {
		// A lane whose transport already failed needs no further teardown.
	}
}
