import type {
	ConnectionProfile,
	ConnectionProfileStore,
} from '@terminay/client-core';
import { useState, type ReactNode } from 'react';
import './SharedProductionRoutes.css';

interface ConnectionSummary {
	readonly id: string;
	readonly label: string;
	readonly status: 'connected' | 'disconnected' | 'reconnecting';
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
			pairingUrl: string;
		}>,
	) => Promise<void> | void;
	/** Desktop is waiting for the exposing computer to approve this code. */
	readonly pairingApproval?: Readonly<{
		deviceName: string;
		matchCode: string;
		expiresAt: string;
	}> | null;
	readonly onRename?: (
		profile: ConnectionProfile,
		label: string,
	) => Promise<void> | void;
	readonly onForget?: (profile: ConnectionProfile) => Promise<void> | void;
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
	pairingApproval = null,
	onRename,
	onForget,
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
		profile: ConnectionProfile;
	}>();
	const [rename, setRename] = useState<ConnectionProfile>();
	const [renameLabel, setRenameLabel] = useState('');
	const [showPair, setShowPair] = useState(false);
	const [pairingUrl, setPairingUrl] = useState('');
	const [inspectId, setInspectId] = useState<string>();
	const exposureId = '__exposure__';
	const snapshot = profileStore?.snapshot();
	const profiles = snapshot?.profiles.filter(
		(profile) => profile.archived !== true,
	);
	const visibleConnections = profiles ?? connections;
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
	const canShowPair =
		canPair && onPairingHandoff !== undefined;
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
		operation: () => Promise<void> | void,
		success: string,
	) => {
		setBusy(key);
		setActionError(undefined);
		setMessage(undefined);
		try {
			await operation();
			setMessage(success);
			setRevision((value) => value + 1);
		} catch (cause) {
			setActionError(
				cause instanceof Error
					? cause.message
					: 'The connection action failed.',
			);
		} finally {
			setBusy(undefined);
		}
	};

	const confirmDestructiveAction = () => {
		if (profileStore === undefined || confirm === undefined) return;
		const selected = confirm;
		setConfirm(undefined);
		void mutate(
			selected.action,
			async () => {
				if (selected.action === 'revoke') {
					await onRevoke?.(selected.profile);
					profileStore.revoke(selected.profile.id, true);
				} else {
					await onForget?.(selected.profile);
					profileStore.forget(selected.profile.id, true);
				}
			},
			selected.action === 'revoke'
				? 'Server access revoked.'
				: 'Connection profile forgotten.',
		);
	};

	const renderConnectionCard = (
		connection: Readonly<{
			id: string;
			label: string;
			status: string;
		}>,
		asOption = true,
	) => {
		const profile = profileStore?.get(connection.id);
		const local = profile?.isLocal === true;
		const isCurrent = connection.id === currentId;
		const optionProps = asOption
			? {
					role: 'option' as const,
					'aria-label': `${connection.label} ${connection.status}`,
					'aria-selected': isCurrent,
					tabIndex: isCurrent ? 0 : -1,
				}
			: {};
		return (
			<div
				key={connection.id}
				className={`shared-production-route__card shared-connection-card${isCurrent ? ' shared-connection-card--current' : ''}`}
				{...optionProps}
			>
				<div className="shared-connection-card__identity">
					<div className="shared-connection-card__title">
						<strong>{connection.label}</strong>
						{isCurrent && (
							<span className="shared-connection-card__current">
								Current
							</span>
						)}
					</div>
					{profile?.origin && (
						<span className="shared-connection-card__origin">
							{profile.origin}
						</span>
					)}
				</div>
				<span
					className={`shared-connection-card__status shared-connection-card__status--${connection.status}`}
				>
					{connection.status}
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
						{isCurrent
							? 'Reconnect'
							: `Switch to ${connection.label}`}
					</button>
					{profile !== undefined && !local && (
						<button
							className="shared-connection-card__secondary-action"
							disabled={busy !== undefined}
							type="button"
							onClick={() => {
								setRename(profile);
								setRenameLabel(profile.label);
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
								setConfirm({ action: 'forget', profile })
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
									setConfirm({ action: 'revoke', profile })
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
						Add a server with its pairing link. You can return here to
						open it whenever you need it.
					</p>
				</div>
			) : (
				<div className="shared-connections__empty">
					<p className="shared-connections__empty-title">
						No saved servers yet
					</p>
					<p>
						Add a server with its pairing link. You can return here to
						open it whenever you need it.
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
				<p role="status">
					Connection management is unavailable in this host.
				</p>
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
		</>
	);

	const actionPanels = (
		<>
			{rename !== undefined && (
				<form
					aria-label="Rename connection"
					className="shared-connections__action-panel"
					onSubmit={(event) => {
						event.preventDefault();
						const profile = rename;
						void mutate(
							'rename',
							async () => {
								await onRename?.(profile, renameLabel);
								profileStore?.rename(profile.id, renameLabel);
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
								onChange={(event) =>
									setRenameLabel(event.target.value)
								}
							/>
						</label>
					</div>
					<div className="shared-connections__action-panel-actions">
						<button type="submit">Save name</button>
						<button
							type="button"
							onClick={() => setRename(undefined)}
						>
							Cancel
						</button>
					</div>
				</form>
			)}
			{confirm !== undefined && (
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
							: 'Forgetting does not revoke server access.'}
					</p>
					<div className="shared-connections__action-panel-actions">
						<button type="button" onClick={confirmDestructiveAction}>
							Confirm {confirm.action}
						</button>
						<button
							type="button"
							onClick={() => setConfirm(undefined)}
						>
							Cancel
						</button>
					</div>
				</section>
			)}
			{showPair && (
				<form
					aria-label="Add connection"
					className="shared-connections__action-panel"
					onSubmit={(event) => {
						event.preventDefault();
						const value = pairingUrl;
						void mutate(
							'pair',
							async () => {
								await onPairingHandoff?.({ pairingUrl: value });
								setPairingUrl('');
								setShowPair(false);
							},
							'Waiting for approval on the exposing computer…',
						);
					}}
				>
					<div className="shared-connections__action-panel-fields">
						<label>
							Pairing URL
							<input
								type="url"
								value={pairingUrl}
								onChange={(event) =>
									setPairingUrl(event.target.value)
								}
								placeholder="https://"
								required
							/>
						</label>
					</div>
					{pairingApproval ? (
						<div
							className="shared-connections__match-code"
							role="status"
							aria-live="polite"
						>
							<p>
								Confirm this code on the exposing computer to finish pairing{' '}
								<strong>{pairingApproval.deviceName}</strong>.
							</p>
							<p
								className="shared-connections__match-code-value"
							>
								{pairingApproval.matchCode}
							</p>
						</div>
					) : null}
					<div className="shared-connections__action-panel-actions">
						<button type="submit">Continue pairing</button>
						<button
							type="button"
							onClick={() => setShowPair(false)}
						>
							Cancel
						</button>
					</div>
				</form>
			)}
		</>
	);

	if (presentation === 'management') {
		const inspected = visibleConnections.find(
			(connection) => connection.id === inspectedId,
		);
		return (
			<div
				className="settings-shell remote-control-window shared-connections"
				data-shared-route-body="connections"
			>
				<aside
					className="settings-sidebar"
					aria-label="Remote Control"
				>
					<header className="settings-sidebar-header">
						<div className="settings-brand">
							<h1>Remote Control</h1>
							<p className="settings-sidebar-lede">
								Choose and manage the Terminay server for this
								workspace.
							</p>
						</div>
						{canShowPair ? (
							<button
								type="button"
								className="settings-primary-button"
								onClick={() => setShowPair(true)}
							>
								Add connection…
							</button>
						) : null}
					</header>
					<nav className="settings-nav" aria-label="Remote Control sections">
						<div className="settings-nav-section">
							{exposurePanel !== undefined ? (
								<div className="settings-nav-group">
									<div className="settings-nav-group-title">
										This server
									</div>
									<button
										type="button"
										className={`settings-nav-item${showingExposure ? ' settings-nav-item--active' : ''}`}
										aria-pressed={showingExposure}
										onClick={() => {
											setInspectId(exposureId);
											setShowPair(false);
										}}
									>
										<span className="settings-nav-item-inner">
											Exposure
										</span>
									</button>
								</div>
							) : null}
							<div className="settings-nav-group">
								<div className="settings-nav-group-title">
									Servers
								</div>
								<div
									role="listbox"
									aria-label="Saved Terminay servers"
								>
									{visibleConnections.map((connection) => (
										<button
											key={connection.id}
											type="button"
											role="option"
											aria-label={`${connection.label} ${connection.status}`}
											aria-selected={
												connection.id === inspectedId
											}
											className={`settings-nav-item${connection.id === inspectedId ? ' settings-nav-item--active' : ''}`}
											onClick={() => {
												setInspectId(connection.id);
												setShowPair(false);
											}}
										>
											<span className="settings-nav-item-inner">
												{connection.label}
											</span>
										</button>
									))}
								</div>
								{visibleConnections.length === 0 ? (
									<p className="settings-empty-state">
										No saved servers yet.
									</p>
								) : null}
							</div>
						</div>
					</nav>
				</aside>
				<main className="settings-main">
					<div className="settings-content">
						{statusBlocks}
						{state === 'ready' && !showingExposure && emptyCopy}
						{state === 'ready' &&
							showingExposure &&
							!showPair &&
							exposurePanel}
						{state === 'ready' &&
							inspected !== undefined &&
							!showPair &&
							!showingExposure &&
							renderConnectionCard(inspected, false)}
						{actionPanels}
					</div>
				</main>
			</div>
		);
	}

	const pageInner: ReactNode = (
		<>
			{!embedded && (
				<header>
					<p className="shared-connections__eyebrow">Workspace</p>
					<h1>Connections</h1>
					<p>
						Choose and manage the Terminay server for this
						workspace.
					</p>
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
