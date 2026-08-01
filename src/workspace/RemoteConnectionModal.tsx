import type { FormEvent } from 'react';
import { useState } from 'react';

export type ManagedDesktopConnection = Readonly<{
	id: string;
	isLocal?: boolean;
	label: string;
	origin: string;
	selected: boolean;
	status: string;
}>;

export function RemoteConnectionModal({
	error,
	isOpening,
	notice,
	onClose,
	onForget,
	onPairingPinChange,
	onRename,
	onRevoke,
	onSelect,
	onSubmit,
	onUrlChange,
	pairingPin,
	profiles,
	url,
}: {
	error: string | null;
	isOpening: boolean;
	notice: string | null;
	onClose: () => void;
	onForget: (profileId: string) => Promise<void>;
	onPairingPinChange: (value: string) => void;
	onRename: (profileId: string, label: string) => Promise<void>;
	onRevoke: (profileId: string) => Promise<void>;
	onSelect: (profileId: string) => Promise<void>;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	onUrlChange: (value: string) => void;
	pairingPin: string;
	profiles: readonly ManagedDesktopConnection[];
	url: string;
}) {
	const [rename, setRename] = useState<ManagedDesktopConnection>();
	const [renameLabel, setRenameLabel] = useState('');
	const [confirm, setConfirm] = useState<{
		action: 'forget' | 'revoke';
		profile: ManagedDesktopConnection;
	}>();
	const [actionError, setActionError] = useState<string>();
	const [busy, setBusy] = useState<string>();

	const run = async (key: string, operation: () => Promise<void>) => {
		setBusy(key);
		setActionError(undefined);
		try {
			await operation();
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

	return (
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="connection-manager-modal"
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="remote-connection-modal-title"
			>
				<header className="connection-manager-modal__header">
					<h2 id="remote-connection-modal-title">Connections</h2>
					<p>
						Switch servers or manage the connections available to this Desktop.
						Local is always available and cannot be removed.
					</p>
				</header>

				<section
					className="connection-manager-modal__profiles"
					aria-labelledby="desktop-saved-connections"
				>
					<h3 id="desktop-saved-connections">Saved connections</h3>
					<div role="listbox" aria-label="Saved Terminay servers">
						{[...profiles]
							.sort(
								(left, right) =>
									Number(right.isLocal === true) -
										Number(left.isLocal === true) ||
									left.label.localeCompare(right.label),
							)
							.map((profile) => (
								<div
									key={profile.id}
									className={`connection-manager-card${profile.selected ? ' connection-manager-card--current' : ''}`}
									role="option"
									aria-label={`${profile.label} ${profile.status}`}
									aria-selected={profile.selected}
									tabIndex={profile.selected ? 0 : -1}
								>
									<div className="connection-manager-card__identity">
										<div>
											<strong>{profile.label}</strong>
											{profile.isLocal ? (
												<span className="connection-manager-card__fixed">
													Always available
												</span>
											) : profile.selected ? (
												<span className="connection-manager-card__fixed">
													Current
												</span>
											) : null}
										</div>
										<span>{profile.origin}</span>
									</div>
									<span
										className={`connection-manager-card__status connection-manager-card__status--${profile.status}`}
									>
										{profile.status}
									</span>
									<div className="connection-manager-card__actions">
										<button
											type="button"
											disabled={profile.selected || busy !== undefined}
											onClick={() =>
												void run(`select:${profile.id}`, () =>
													onSelect(profile.id),
												)
											}
										>
											{profile.selected ? 'Current server' : 'Switch'}
										</button>
										{!profile.isLocal ? (
											<>
												<button
													type="button"
													disabled={busy !== undefined}
													onClick={() => {
														setRename(profile);
														setRenameLabel(profile.label);
													}}
												>
													Rename
												</button>
												<button
													type="button"
													disabled={busy !== undefined}
													onClick={() =>
														setConfirm({ action: 'forget', profile })
													}
												>
													Forget
												</button>
												<button
													type="button"
													className="danger"
													disabled={busy !== undefined}
													onClick={() =>
														setConfirm({ action: 'revoke', profile })
													}
												>
													Revoke access
												</button>
											</>
										) : null}
									</div>
								</div>
							))}
					</div>
				</section>

				<details
					className="connection-manager-modal__add"
					open={profiles.length <= 1}
				>
					<summary>Add a remote server</summary>
					<form onSubmit={onSubmit}>
						<p className="file-explorer-name-modal-description">
							Paste a Terminay Server URL. For Remote Access, enter the
							server&apos;s six-digit pairing PIN.
						</p>
						<label>
							<span>Pairing URL</span>
							<input
								type="text"
								value={url}
								onChange={(event) => onUrlChange(event.target.value)}
								placeholder="https://…"
								autoComplete="off"
								spellCheck={false}
							/>
						</label>
						<label>
							<span>Remote Access pairing PIN (if required)</span>
							<input
								type="text"
								value={pairingPin}
								onChange={(event) =>
									onPairingPinChange(
										event.target.value.replace(/\D/g, '').slice(0, 6),
									)
								}
								inputMode="numeric"
								autoComplete="one-time-code"
								spellCheck={false}
							/>
						</label>
						<div className="project-edit-actions">
							<button
								type="submit"
								disabled={isOpening || url.trim().length === 0}
							>
								{isOpening ? 'Connecting…' : 'Connect'}
							</button>
						</div>
					</form>
				</details>

				{rename !== undefined ? (
					<form
						aria-label="Rename connection"
						className="connection-manager-modal__subpanel"
						onSubmit={(event) => {
							event.preventDefault();
							void run('rename', async () => {
								await onRename(rename.id, renameLabel);
								setRename(undefined);
							});
						}}
					>
						<label>
							<span>Connection name</span>
							<input
								value={renameLabel}
								onChange={(event) => setRenameLabel(event.target.value)}
								autoFocus
							/>
						</label>
						<div className="project-edit-actions">
							<button type="button" onClick={() => setRename(undefined)}>
								Cancel
							</button>
							<button type="submit" disabled={busy !== undefined}>
								Save name
							</button>
						</div>
					</form>
				) : null}

				{confirm !== undefined ? (
					<section
						aria-label={`Confirm ${confirm.action}`}
						className="connection-manager-modal__subpanel"
					>
						<strong>
							{confirm.action === 'revoke'
								? `Revoke access for ${confirm.profile.label}?`
								: `Forget ${confirm.profile.label}?`}
						</strong>
						<p>
							{confirm.action === 'revoke'
								? 'This removes the saved Desktop credential and disconnects the server.'
								: 'This removes the local profile without claiming to revoke server access.'}
						</p>
						<div className="project-edit-actions">
							<button type="button" onClick={() => setConfirm(undefined)}>
								Cancel
							</button>
							<button
								type="button"
								className="danger"
								disabled={busy !== undefined}
								onClick={() =>
									void run(confirm.action, async () => {
										if (confirm.action === 'revoke') {
											await onRevoke(confirm.profile.id);
										} else {
											await onForget(confirm.profile.id);
										}
										setConfirm(undefined);
									})
								}
							>
								Confirm {confirm.action}
							</button>
						</div>
					</section>
				) : null}

				{error ? <p className="remote-pin-modal__error">{error}</p> : null}
				{actionError ? (
					<p className="remote-pin-modal__error" role="alert">
						{actionError}
					</p>
				) : null}
				{notice ? (
					<p role="status" className="file-explorer-name-modal-description">
						{notice}
					</p>
				) : null}
				<footer className="connection-manager-modal__footer">
					<button type="button" className="btn btn-secondary" onClick={onClose}>
						Done
					</button>
				</footer>
			</section>
		</div>
	);
}
