import type {
	ConnectionProfile,
	ConnectionProfileStore,
} from '@terminay/client-core';
import { type ReactNode, useRef, useState } from 'react';
import {
	PAIRING_CONNECTION_LOST_COPY,
	PairingAttemptStatus,
} from './PairingAttemptStatus';
import { friendlyPairingActionError } from './pairingActionError';
import type { PairingAttemptProgress } from './pairingAttemptState';
import { ServerInstallGuide } from './ServerInstallGuide';
import './SharedProductionRoutes.css';

interface ConnectionSummary {
	readonly id: string;
	readonly label: string;
	readonly status: 'connected' | 'disconnected' | 'reconnecting';
}

/** A remembered server as the host lists it: display metadata only. */
export interface SavedServerSummary {
	readonly id: string;
	readonly label: string;
	readonly isLocal?: boolean;
}

/** One row of the saved-server list, whichever source it came from. */
type ServerRow = Readonly<{
	id: string;
	label: string;
	/** Absent where the listing host cannot speak for the server: what it
	 * knows is whether this window holds a connection, not whether the server
	 * is up. */
	status?: string;
	origin?: string;
	isLocal: boolean;
	profile?: ConnectionProfile;
}>;

let pairingAttemptSequence = 0;

function nextPairingAttemptId(): string {
	pairingAttemptSequence += 1;
	return `pair-${Date.now().toString(36)}-${pairingAttemptSequence.toString(36)}`;
}

export interface SharedConnectionsRouteBodyProps {
	readonly state: 'loading' | 'ready' | 'empty' | 'unavailable' | 'failed';
	readonly connections?: readonly ConnectionSummary[];
	readonly activeConnectionId?: string;
	readonly error?: string;
	readonly onRetry?: () => void;
	readonly profileStore?: ConnectionProfileStore;
	readonly canPair?: boolean;
	readonly canRevoke?: boolean;
	readonly canExpose?: boolean;
	readonly onSelect?: (profile: ConnectionProfile) => Promise<void> | void;
	readonly onRevoke?: (profile: ConnectionProfile) => Promise<void> | void;
	readonly onExpose?: (profile: ConnectionProfile) => Promise<void> | void;
	readonly onPairingHandoff?: (
		input: Readonly<{
			attemptId: string;
			pairingUrl: string;
		}>,
	) => Promise<void> | void;
	/** Abandon an in-flight pairing attempt. Its handoff then rejects. */
	readonly onPairingCancel?: (attemptId: string) => void;
	readonly onPairingProgressDismiss?: () => void;
	/** Desktop is waiting for the exposing computer to approve this code. */
	readonly pairingApproval?: Readonly<{
		deviceName: string;
		matchCode: string;
		expiresAt: string;
	}> | null;
	readonly pairingProgress?: PairingAttemptProgress | null;
	readonly onRename?: (
		profile: ConnectionProfile,
		label: string,
	) => Promise<void> | void;
	readonly onForget?: (profile: ConnectionProfile) => Promise<void> | void;
	/** The host's remembered servers, where the host owns that list and no
	 * profile store exists in this document. */
	readonly servers?: readonly SavedServerSummary[];
	readonly onRenameServer?: (id: string, label: string) => Promise<void> | void;
	/** Remove this device's credential and metadata for a server. It revokes
	 * nothing on the server. */
	readonly onForgetServer?: (id: string) => Promise<void> | void;
	/** The remembered list may have changed; ask the host for it again. */
	readonly onServersChanged?: () => void;
	/** The version of the client, when its host supplies one. It only chooses
	 * which image the install commands name. */
	readonly appVersion?: string;
	readonly embedded?: boolean;
	readonly presentation?: 'page' | 'management';
	readonly exposurePanel?: ReactNode;
}

/** Host-neutral profile management; pairing credentials are handed off and never retained. */
export function SharedConnectionsRouteBody({
	state,
	connections = [],
	activeConnectionId,
	error,
	onRetry,
	profileStore,
	canPair = false,
	canRevoke = false,
	canExpose = false,
	onSelect,
	onRevoke,
	onExpose,
	onPairingHandoff,
	onPairingCancel,
	onPairingProgressDismiss,
	pairingApproval = null,
	pairingProgress = null,
	onRename,
	onForget,
	servers,
	onRenameServer,
	onForgetServer,
	onServersChanged,
	appVersion,
	embedded = false,
	presentation = 'page',
	exposurePanel,
}: SharedConnectionsRouteBodyProps) {
	const [, setRevision] = useState(0);
	const [busy, setBusy] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [message, setMessage] = useState<string>();
	const [confirm, setConfirm] = useState<{
		action: 'forget' | 'revoke';
		row: ServerRow;
	}>();
	const [rename, setRename] = useState<ServerRow>();
	const [renameLabel, setRenameLabel] = useState('');
	const [showPair, setShowPair] = useState(false);
	const [pairingUrl, setPairingUrl] = useState('');
	const activePairingAttempt = useRef<string | null>(null);
	const cancelledPairingAttempts = useRef(new Set<string>());
	const [inspectId, setInspectId] = useState<string>();
	const exposureId = '__exposure__';
	const snapshot = profileStore?.snapshot();
	const visibleConnections: readonly ServerRow[] =
		snapshot !== undefined
			? snapshot.profiles
					.filter((profile) => profile.archived !== true)
					.map((profile) => ({
						id: profile.id,
						label: profile.label,
						status: profile.status,
						origin: profile.origin,
						isLocal: profile.isLocal === true,
						profile,
					}))
			: servers !== undefined
				? // Local is this computer, not a saved server: Exposure covers it.
					servers
						.filter((server) => server.isLocal !== true)
						.map((server) => ({
							id: server.id,
							label: server.label,
							isLocal: false,
						}))
				: connections.map((connection) => ({ ...connection, isLocal: false }));
	const canRename = (row: ServerRow) =>
		!row.isLocal && (row.profile !== undefined || onRenameServer !== undefined);
	const canForget = (row: ServerRow) =>
		!row.isLocal && (row.profile !== undefined || onForgetServer !== undefined);
	const currentId = snapshot?.currentProfileId ?? activeConnectionId;
	const showingExposure =
		exposurePanel !== undefined &&
		!showPair &&
		(inspectId === exposureId ||
			(inspectId === undefined && visibleConnections.length === 0));
	const inspectedId = showingExposure
		? exposureId
		: inspectId !== undefined &&
				visibleConnections.some((connection) => connection.id === inspectId)
			? inspectId
			: (currentId ?? visibleConnections[0]?.id);
	const canShowPair = canPair && onPairingHandoff !== undefined;
	const profileActions =
		canShowPair && !showPair ? (
			<nav
				className="shared-connections__profile-actions"
				aria-label="Connection profile actions"
			>
				<button type="button" onClick={() => setShowPair(true)}>
					Add connection…
				</button>
			</nav>
		) : null;

	const mutate = async (
		key: string,
		// Returning `false` means the user withdrew the action: nothing is
		// announced, neither success nor failure.
		operation: () => unknown,
		success: string,
	) => {
		setBusy(key);
		setActionError(undefined);
		setMessage(undefined);
		try {
			if ((await operation()) !== false) setMessage(success);
			setRevision((value) => value + 1);
		} catch (cause) {
			setActionError(friendlyPairingActionError(cause));
		} finally {
			setBusy(undefined);
		}
	};

	const confirmDestructiveAction = () => {
		if (confirm === undefined) return;
		const selected = confirm;
		const profile = selected.row.profile;
		setConfirm(undefined);
		void mutate(
			selected.action,
			async () => {
				if (profile === undefined) {
					if (selected.action !== 'forget') return false;
					await onForgetServer?.(selected.row.id);
				} else if (selected.action === 'revoke') {
					await onRevoke?.(profile);
					profileStore?.revoke(profile.id, true);
				} else {
					await onForget?.(profile);
					profileStore?.forget(profile.id, true);
				}
			},
			selected.action === 'revoke'
				? 'Server access revoked.'
				: 'Connection profile forgotten.',
		);
	};

	const renderConnectionCard = (connection: ServerRow) => {
		const profile = connection.profile;
		const local = connection.isLocal;
		const isCurrent = connection.id === currentId;
		const status = connection.status ?? 'saved';
		return (
			<div
				key={connection.id}
				className={`shared-production-route__card shared-connection-card${isCurrent ? ' shared-connection-card--current' : ''}`}
				role="option"
				aria-label={`${connection.label} ${status}`}
				aria-selected={isCurrent}
				tabIndex={isCurrent ? 0 : -1}
			>
				<div className="shared-connection-card__identity">
					<div className="shared-connection-card__title">
						<strong>{connection.label}</strong>
						{isCurrent && (
							<span className="shared-connection-card__current">Current</span>
						)}
					</div>
					{profile?.origin && (
						<span className="shared-connection-card__origin">
							{profile.origin}
						</span>
					)}
				</div>
				<span
					className={`shared-connection-card__status shared-connection-card__status--${status}`}
				>
					{status}
				</span>
				<div className="shared-connection-card__actions">
					<button
						className="shared-connection-card__switch"
						disabled={
							busy !== undefined ||
							profile === undefined ||
							onSelect === undefined
						}
						type="button"
						onClick={() =>
							profile === undefined
								? undefined
								: void mutate(
										`select:${profile.id}`,
										async () => {
											await onSelect?.(profile);
											profileStore?.select(profile.id);
										},
										`Switched to ${connection.label}.`,
									)
						}
					>
						{isCurrent ? 'Reconnect' : `Switch to ${connection.label}`}
					</button>
					{profile !== undefined && !local && (
						<button
							className="shared-connection-card__secondary-action"
							disabled={busy !== undefined}
							type="button"
							onClick={() => {
								setRename(connection);
								setRenameLabel(connection.label);
							}}
						>
							Rename
						</button>
					)}
					{profile !== undefined && !local && (
						<button
							className="shared-connection-card__secondary-action"
							disabled={busy !== undefined}
							type="button"
							onClick={() =>
								setConfirm({ action: 'forget', row: connection })
							}
						>
							Forget
						</button>
					)}
					{profile !== undefined &&
						!local &&
						canRevoke &&
						onRevoke !== undefined && (
							<button
								className="shared-connection-card__danger-action"
								disabled={busy !== undefined}
								type="button"
								onClick={() =>
									setConfirm({ action: 'revoke', row: connection })
								}
							>
								Revoke access
							</button>
						)}
					{profile !== undefined &&
						canExpose &&
						onExpose !== undefined &&
						profile.id === currentId &&
						profile.status === 'connected' && (
							<button
								className="shared-connection-card__secondary-action"
								disabled={busy !== undefined}
								type="button"
								onClick={() =>
									void mutate(
										`expose:${profile.id}`,
										() => onExpose(profile),
										'Server exposure enabled.',
									)
								}
							>
								Expose server
							</button>
						)}
				</div>
			</div>
		);
	};

	const emptyCopy =
		visibleConnections.length === 0 && !showPair ? (
			presentation === 'management' ? (
				<div className="settings-empty-hero">
					<h2>No saved servers yet</h2>
					<p>
						Add a server with its pairing link. You can return here to open it
						whenever you need it.
					</p>
				</div>
			) : (
				<div className="shared-connections__empty">
					<p className="shared-connections__empty-title">
						No saved servers yet
					</p>
					<p>
						Add a server with its pairing link. You can return here to open it
						whenever you need it.
					</p>
				</div>
			)
		) : null;

	const statusBlocks = (
		<>
			{state === 'loading' && (
				<p role="status" aria-busy="true">
					Loading connections…
				</p>
			)}
			{state === 'empty' && (
				<p role="status">No saved servers are available.</p>
			)}
			{state === 'unavailable' && (
				<p role="status">Connection management is unavailable in this host.</p>
			)}
			{state === 'failed' && (
				<div role="alert">
					<p>{error ?? 'Terminay could not load connections.'}</p>
					{onRetry === undefined ? null : (
						<button type="button" onClick={onRetry}>
							Retry connections
						</button>
					)}
				</div>
			)}
			{busy !== undefined && (
				<p role="status" aria-busy="true">
					Applying connection action…
				</p>
			)}
			{message !== undefined && <p role="status">{message}</p>}
			{actionError !== undefined && <p role="alert">{actionError}</p>}
			{pairingProgress === 'connection-lost' && !showPair ? (
				<div role="alert" className="shared-connections__pairing-recovery">
					<p>{PAIRING_CONNECTION_LOST_COPY}</p>
					<button type="button" onClick={onPairingProgressDismiss}>
						Dismiss
					</button>
				</div>
			) : null}
		</>
	);

	const renameForm = rename !== undefined && (
		<form
			aria-label="Rename connection"
			className="shared-connections__action-panel"
			onSubmit={(event) => {
				event.preventDefault();
				const row = rename;
				const label = renameLabel.trim();
				void mutate(
					'rename',
					async () => {
						if (row.profile === undefined)
							await onRenameServer?.(row.id, label);
						else {
							await onRename?.(row.profile, label);
							profileStore?.rename(row.id, label);
						}
						setRename(undefined);
					},
					'Connection renamed.',
				);
			}}
		>
			<div className="shared-connections__action-panel-fields">
				<label>
					Connection name
					<input
						value={renameLabel}
						maxLength={256}
						required
						onChange={(event) => setRenameLabel(event.target.value)}
					/>
				</label>
			</div>
			<div className="shared-connections__action-panel-actions">
				<button type="submit" disabled={renameLabel.trim().length === 0}>
					Save name
				</button>
				<button type="button" onClick={() => setRename(undefined)}>
					Cancel
				</button>
			</div>
		</form>
	);

	const confirmPanel = confirm !== undefined && (
		<section
			aria-label={`Confirm ${confirm.action}`}
			className="shared-production-route__card shared-connections__action-panel"
		>
			<strong>
				{confirm.action === 'revoke'
					? 'Revoke server access?'
					: 'Forget this local profile?'}
			</strong>
			<p>
				{confirm.action === 'revoke'
					? 'This invalidates this device on the server.'
					: `${confirm.row.label} and this device's key for it are removed from this computer. Forgetting does not revoke server access.`}
			</p>
			<div className="shared-connections__action-panel-actions">
				<button
					type="button"
					className="shared-connections__confirm-action"
					onClick={confirmDestructiveAction}
				>
					Confirm {confirm.action}
				</button>
				<button type="button" onClick={() => setConfirm(undefined)}>
					Cancel
				</button>
			</div>
		</section>
	);

	const pairPanel = showPair && (
		<>
			<form
				aria-label="Add connection"
				className="shared-connections__action-panel shared-connections__pair"
				onSubmit={(event) => {
					event.preventDefault();
					const value = pairingUrl;
					const attemptId = nextPairingAttemptId();
					activePairingAttempt.current = attemptId;
					void mutate(
						'pair',
						async () => {
							try {
								await onPairingHandoff?.({
									attemptId,
									pairingUrl: value,
								});
							} catch (cause) {
								// A cancelled attempt rejects by design; that is the
								// user's own decision, not an error to report.
								if (cancelledPairingAttempts.current.delete(attemptId))
									return false;
								throw cause;
							} finally {
								if (activePairingAttempt.current === attemptId)
									activePairingAttempt.current = null;
							}
							if (cancelledPairingAttempts.current.delete(attemptId))
								return false;
							setPairingUrl('');
							setShowPair(false);
							onServersChanged?.();
						},
						'Server added.',
					);
				}}
			>
				<div className="shared-connections__action-panel-fields">
					<label>
						Pairing URL
						<input
							type="url"
							value={pairingUrl}
							onChange={(event) => setPairingUrl(event.target.value)}
							placeholder="https://"
							required
						/>
					</label>
				</div>
				<PairingAttemptStatus
					approval={pairingApproval}
					busy={busy === 'pair'}
					progress={pairingProgress}
				/>
				<div className="shared-connections__action-panel-actions">
					<button type="submit" disabled={busy === 'pair'}>
						{busy === 'pair' ? 'Pairing…' : 'Continue pairing'}
					</button>
					<button
						type="button"
						onClick={() => {
							const attemptId = activePairingAttempt.current;
							if (attemptId !== null && onPairingCancel !== undefined) {
								cancelledPairingAttempts.current.add(attemptId);
								onPairingCancel(attemptId);
							}
							setShowPair(false);
						}}
					>
						Cancel
					</button>
				</div>
			</form>
			<ServerInstallGuide version={appVersion} />
		</>
	);

	if (presentation === 'management') {
		const inspected = visibleConnections.find(
			(connection) => connection.id === inspectedId,
		);
		const inspect = (id: string) => {
			setInspectId(id);
			setShowPair(false);
			setRename(undefined);
			setConfirm(undefined);
		};
		const renderServerDetail = (row: ServerRow) => {
			const profile = row.profile;
			const isCurrent = row.id === currentId;
			const editing =
				rename?.id === row.id || confirm?.row.id === row.id;
			return (
				<section className="remote-control-pane" aria-label={row.label}>
					<header className="remote-control-pane__header">
						<div className="remote-control-pane__title">
							<h2>{row.label}</h2>
							{isCurrent && (
								<span className="shared-connection-card__current">Current</span>
							)}
						</div>
						{row.origin !== undefined && (
							<p className="remote-control-pane__origin">{row.origin}</p>
						)}
						{row.status === undefined ? (
							<p className="remote-control-pane__lede">
								Saved on this computer. Attach it to a window from the
								connection menu.
							</p>
						) : (
							<p className="remote-control-pane__status">
								<span
									className={`remote-control-status-dot remote-control-status-dot--${row.status}`}
									aria-hidden="true"
								/>
								{row.status}
							</p>
						)}
					</header>
					{!editing && (
						<div className="remote-control-pane__actions">
							{profile !== undefined && onSelect !== undefined && (
								<button
									type="button"
									className="settings-secondary-button"
									disabled={busy !== undefined}
									onClick={() =>
										void mutate(
											`select:${profile.id}`,
											async () => {
												await onSelect(profile);
												profileStore?.select(profile.id);
											},
											`Switched to ${row.label}.`,
										)
									}
								>
									{isCurrent ? 'Reconnect' : `Switch to ${row.label}`}
								</button>
							)}
							{profile !== undefined &&
								canExpose &&
								onExpose !== undefined &&
								isCurrent &&
								profile.status === 'connected' && (
									<button
										type="button"
										className="settings-secondary-button"
										disabled={busy !== undefined}
										onClick={() =>
											void mutate(
												`expose:${profile.id}`,
												() => onExpose(profile),
												'Server exposure enabled.',
											)
										}
									>
										Expose server
									</button>
								)}
							{canRename(row) && (
								<button
									type="button"
									className="settings-secondary-button"
									disabled={busy !== undefined}
									onClick={() => {
										setRename(row);
										setRenameLabel(row.label);
									}}
								>
									Rename
								</button>
							)}
							{canForget(row) && (
								<button
									type="button"
									className="settings-secondary-button"
									disabled={busy !== undefined}
									onClick={() => setConfirm({ action: 'forget', row })}
								>
									Forget
								</button>
							)}
							{profile !== undefined &&
								!row.isLocal &&
								canRevoke &&
								onRevoke !== undefined && (
									<button
										type="button"
										className="settings-danger-button"
										disabled={busy !== undefined}
										onClick={() => setConfirm({ action: 'revoke', row })}
									>
										Revoke access
									</button>
								)}
						</div>
					)}
					{rename?.id === row.id && renameForm}
					{confirm?.row.id === row.id && confirmPanel}
				</section>
			);
		};
		return (
			<div
				className="settings-shell remote-control-window shared-connections"
				data-shared-route-body="connections"
			>
				<aside className="settings-sidebar" aria-label="Remote Control">
					<header className="settings-sidebar-header">
						<div className="settings-brand">
							<h1>Remote Control</h1>
							<p className="settings-sidebar-lede">
								Servers this device connects to, and who can connect to this
								one.
							</p>
						</div>
						{canShowPair ? (
							<button
								type="button"
								className="settings-primary-button"
								onClick={() => {
									setShowPair(true);
									setRename(undefined);
									setConfirm(undefined);
								}}
							>
								Add connection…
							</button>
						) : null}
					</header>
					<nav className="settings-nav" aria-label="Remote Control sections">
						<div className="settings-nav-section">
							{exposurePanel !== undefined ? (
								<div className="settings-nav-group">
									<div className="settings-nav-group-title">This server</div>
									<button
										type="button"
										className={`settings-nav-item${showingExposure ? ' settings-nav-item--active' : ''}`}
										aria-pressed={showingExposure}
										onClick={() => inspect(exposureId)}
									>
										<span className="settings-nav-item-inner">Exposure</span>
									</button>
								</div>
							) : null}
							<div className="settings-nav-group">
								<div className="settings-nav-group-title">Servers</div>
								<div role="listbox" aria-label="Saved Terminay servers">
									{visibleConnections.map((connection) => {
										const selected =
											!showPair && connection.id === inspectedId;
										return (
											<button
												key={connection.id}
												type="button"
												role="option"
												aria-label={
													connection.status === undefined
														? connection.label
														: `${connection.label} ${connection.status}`
												}
												aria-selected={selected}
												className={`settings-nav-item${selected ? ' settings-nav-item--active' : ''}`}
												onClick={() => inspect(connection.id)}
											>
												<span className="settings-nav-item-inner">
													{connection.status !== undefined && (
														<span
															className={`remote-control-status-dot remote-control-status-dot--${connection.status}`}
															aria-hidden="true"
														/>
													)}
													<span className="remote-control-nav-label">
														{connection.label}
													</span>
												</span>
											</button>
										);
									})}
								</div>
								{visibleConnections.length === 0 ? (
									<p className="settings-empty-state">No saved servers yet.</p>
								) : null}
							</div>
						</div>
					</nav>
				</aside>
				<main className="settings-main">
					<div className="settings-content">
						<div className="remote-control-notices">{statusBlocks}</div>
						{state === 'ready' && !showingExposure && emptyCopy}
						{state === 'ready' && showingExposure && !showPair && exposurePanel}
						{state === 'ready' &&
							inspected !== undefined &&
							!showPair &&
							!showingExposure &&
							renderServerDetail(inspected)}
						{showPair && (
							<section
								className="remote-control-pane"
								aria-label="Add connection"
							>
								<header className="remote-control-pane__header">
									<div className="remote-control-pane__title">
										<h2>Add connection</h2>
									</div>
									<p className="remote-control-pane__lede">
										Paste the pairing link from a Terminay server.
									</p>
								</header>
								{pairPanel}
							</section>
						)}
					</div>
				</main>
			</div>
		);
	}

	const actionPanels = (
		<>
			{renameForm}
			{confirmPanel}
			{pairPanel}
		</>
	);

	const pageInner: ReactNode = (
		<>
			{!embedded && (
				<header>
					<p className="shared-connections__eyebrow">Workspace</p>
					<h1>Connections</h1>
					<p>Choose and manage the Terminay server for this workspace.</p>
				</header>
			)}
			{statusBlocks}
			{state === 'empty' && profileActions}
			{state === 'ready' && (
				<>
					<div role="listbox" aria-label="Saved Terminay servers">
						{emptyCopy}
						{visibleConnections.map((connection) =>
							renderConnectionCard(connection),
						)}
					</div>
					{profileActions}
				</>
			)}
			{actionPanels}
		</>
	);

	return (
		<main
			className={`shared-production-route shared-connections${embedded ? ' shared-connections--embedded' : ''}`}
			data-shared-route-body="connections"
		>
			{pageInner}
		</main>
	);
}
