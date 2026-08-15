import type {
	ConnectionProfile,
	ConnectionProfileStore,
} from '@terminay/client-core';
import { useState } from 'react';

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
			pairingPin: string;
			pairingUrl: string;
		}>,
	) => Promise<void> | void;
	readonly onRename?: (
		profile: ConnectionProfile,
		label: string,
	) => Promise<void> | void;
	readonly onForget?: (profile: ConnectionProfile) => Promise<void> | void;
	readonly embedded?: boolean;
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
	onRename,
	onForget,
	embedded = false,
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
	const [pairingPin, setPairingPin] = useState('');
	const [pairingUrl, setPairingUrl] = useState('');
	const snapshot = profileStore?.snapshot();
	const profiles = snapshot?.profiles.filter(
		(profile) => profile.archived !== true,
	);
	const visibleConnections = profiles ?? connections;
	const currentId = snapshot?.currentProfileId ?? activeConnectionId;
	const profileActions =
		canPair && onPairingHandoff !== undefined ? (
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

	return (
		<main
			className={`shared-production-route shared-connections${embedded ? ' shared-connections--embedded' : ''}`}
			data-shared-route-body="connections"
		>
			{!embedded && (
				<header>
					<p className="shared-connections__eyebrow">Workspace</p>
					<h1>Connections</h1>
					<p>Choose and manage the Terminay server for this workspace.</p>
				</header>
			)}
			{state === 'loading' && (
				<p role="status" aria-busy="true">
					Loading connections…
				</p>
			)}
			{state === 'empty' && (
				<>
					<p role="status">No saved servers are available.</p>
					{profileActions}
				</>
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
			{state === 'ready' && (
				<>
					<div role="listbox" aria-label="Saved Terminay servers">
						{visibleConnections.length === 0 && (
							<div className="shared-connections__empty">
								<strong>No saved servers yet</strong>
								<span>
									Add a server with its pairing link. You can return here to
									open it whenever you need it.
								</span>
							</div>
						)}
						{visibleConnections.map((connection) => {
							const profile = profileStore?.get(connection.id);
							const local = profile?.isLocal === true;
							const isCurrent = connection.id === currentId;
							return (
								<div
									key={connection.id}
									role="option"
									aria-label={`${connection.label} ${connection.status}`}
									aria-selected={isCurrent}
									tabIndex={isCurrent ? 0 : -1}
									className={`shared-production-route__card shared-connection-card${isCurrent ? ' shared-connection-card--current' : ''}`}
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
						})}
					</div>
					{profileActions}
				</>
			)}
			{busy !== undefined && (
				<p role="status" aria-busy="true">
					Applying connection action…
				</p>
			)}
			{message !== undefined && <p role="status">{message}</p>}
			{actionError !== undefined && <p role="alert">{actionError}</p>}
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
					<label>
						Connection name
						<input
							value={renameLabel}
							onChange={(event) => setRenameLabel(event.target.value)}
						/>
					</label>
					<button type="submit">Save name</button>
					<button type="button" onClick={() => setRename(undefined)}>
						Cancel
					</button>
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
					<button type="button" onClick={confirmDestructiveAction}>
						Confirm {confirm.action}
					</button>
					<button type="button" onClick={() => setConfirm(undefined)}>
						Cancel
					</button>
				</section>
			)}
			{showPair && (
				<form
					aria-label="Add connection"
					className="shared-connections__action-panel"
					onSubmit={(event) => {
						event.preventDefault();
						const value = pairingUrl;
						if (!/^\d{6}$/u.test(pairingPin)) {
							setMessage('Enter the six-digit pairing PIN.');
							return;
						}
						void mutate(
							'pair',
							async () => {
								await onPairingHandoff?.({ pairingPin, pairingUrl: value });
								setPairingUrl('');
								setPairingPin('');
								setShowPair(false);
							},
							'Opening pairing…',
						);
					}}
				>
					<label>
						Pairing URL
						<input
							type="url"
							value={pairingUrl}
							onChange={(event) => setPairingUrl(event.target.value)}
							required
						/>
					</label>
					<label>
						Pairing PIN
						<input
							inputMode="numeric"
							maxLength={6}
							value={pairingPin}
							onChange={(event) => setPairingPin(event.target.value)}
							required
						/>
					</label>
					<button type="submit">Continue pairing</button>
					<button type="button" onClick={() => setShowPair(false)}>
						Cancel
					</button>
				</form>
			)}
		</main>
	);
}
