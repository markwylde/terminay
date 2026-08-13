import type {
	ExtensionAction,
	ExtensionInstallPreviewDto,
} from '@terminay/client-core';
import { useMemo, useState } from 'react';
import type { ExtensionSummaryDto } from './uiModel';

export function ExtensionManager({
	extensions,
	serverName,
	onPreview,
	onPreviewPackageFile,
	onInstall,
	onUpdate,
	onAction,
}: Readonly<{
	embedded?: boolean;
	extensions: readonly ExtensionSummaryDto[];
	serverName: string;
	revision: number;
	onPreview: (spec: string) => Promise<ExtensionInstallPreviewDto>;
	onPreviewPackageFile: (file: File) => Promise<ExtensionInstallPreviewDto>;
	onInstall: (digest: string) => Promise<void>;
	onUpdate: (id: string, digest: string) => Promise<void>;
	onAction: (action: ExtensionAction, id: string) => Promise<void>;
}>) {
	const [query, setQuery] = useState('');
	const [npmPackage, setNpmPackage] = useState('');
	const [preview, setPreview] = useState<ExtensionInstallPreviewDto | null>(null);
	const [previewUpdateId, setPreviewUpdateId] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState('');
	const [completion, setCompletion] = useState('');
	const [busy, setBusy] = useState(false);
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return extensions.filter((item) =>
			`${item.displayName} ${item.packageName} ${item.description}`
				.toLowerCase()
				.includes(normalized),
		);
	}, [extensions, query]);

	const previewPackage = async (spec = npmPackage, updateId: string | null = null) => {
		setBusy(true);
		setPreviewError('');
		setCompletion('');
		try {
			setPreview(await onPreview(spec));
			setPreviewUpdateId(updateId);
		} catch (error) {
			setPreviewError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	const act = async (action: ExtensionAction, id: string) => {
		setBusy(true);
		try {
			await onAction(action, id);
		} finally {
			setBusy(false);
		}
	};
	const previewFile = async (file: File | undefined) => {
		if (file === undefined) return;
		setBusy(true); setPreviewError('');
		try { setCompletion(''); setPreview(await onPreviewPackageFile(file)); setPreviewUpdateId(null); }
		catch (error) { setPreviewError(error instanceof Error ? error.message : String(error)); }
		finally { setBusy(false); }
	};
	const confirmPreview = async () => {
		if (preview === null) return;
		setBusy(true);
		setPreviewError('');
		try {
			await (previewUpdateId === null
				? onInstall(preview.previewDigest)
				: onUpdate(previewUpdateId, preview.previewDigest));
			setPreview(null);
			setPreviewUpdateId(null);
			setCompletion(`${preview.packageName}@${preview.version} was ${previewUpdateId === null ? 'installed' : 'updated'} on ${serverName}.`);
		} catch (error) {
			setPreviewError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="extension-settings" aria-busy={busy}>
			<section className="settings-section">
				<h3 className="settings-section-title">Security</h3>
				<div className="settings-group">
					<div className="settings-row settings-row--stacked extension-trust-row" role="note">
						<span className="settings-row-label">Third-party extensions are trusted code</span>
						<span className="settings-row-description">
							They run on {serverName} and can access files and networks available to that server account.
						</span>
					</div>
				</div>
			</section>

			<section className="settings-section">
				<h3 className="settings-section-title">Install from npm</h3>
				<div className="settings-group">
					<form
						className="settings-row extension-install-row"
						onSubmit={(event) => {
							event.preventDefault();
							void previewPackage();
						}}
					>
						<div className="settings-row-info">
							<label className="settings-row-label" htmlFor="extension-package">Package</label>
							<span className="settings-row-description">Enter a public npm package name and optional version.</span>
						</div>
						<div className="settings-row-control extension-install-control">
							<input
								id="extension-package"
								className="settings-input-text"
								value={npmPackage}
								onChange={(event) => setNpmPackage(event.target.value)}
								placeholder="package-name@version"
							/>
							<button type="submit" className="settings-secondary-button" disabled={busy || npmPackage.trim() === ''}>Preview</button>
						</div>
					</form>
				</div>
				{previewError ? <p className="settings-inline-error" role="alert">{previewError}</p> : null}
			</section>

			<section className="settings-section">
				<h3 className="settings-section-title">Install package file</h3>
				<div className="settings-group">
					<label className="settings-row extension-package-file-row">
						<span className="settings-row-info"><span className="settings-row-label">npm pack archive</span><span className="settings-row-description">Upload a .tgz package (maximum 12 MiB) to {serverName}.</span></span>
						<span className="settings-row-control"><span className="settings-secondary-button" aria-hidden="true">Choose package file…</span><input className="extension-package-file-input" type="file" accept=".tgz,application/gzip" disabled={busy} onChange={(event) => { const file=event.currentTarget.files?.[0]; event.currentTarget.value=''; void previewFile(file); }} /></span>
					</label>
				</div>
			</section>

			{preview === null ? null : (
				<ExtensionPreview
					preview={preview}
					serverName={serverName}
					update={previewUpdateId !== null}
					onCancel={() => {
						setPreview(null);
						setPreviewUpdateId(null);
					}}
					onConfirm={confirmPreview}
				/>
			)}
			{completion ? <div className="settings-status-message" role="status">{completion}</div> : null}

			<section className="settings-section">
				<div className="settings-section-title-row">
					<h3 className="settings-section-title">Connection providers</h3>
					<input
						type="search"
						className="settings-search-input extension-search-input"
						aria-label="Search extensions"
						placeholder="Search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
				<div className="extension-card-list">
					{filtered.map((extension) => (
						<ExtensionCard
							key={extension.id}
							extension={extension}
							busy={busy}
							onInstall={() => void previewPackage(extension.packageName)}
							onUpdate={() => void previewPackage(`${extension.packageName}@latest`, extension.id)}
							onAction={(action) => void act(action, extension.id)}
						/>
					))}
					{filtered.length === 0 ? <p className="settings-empty-state">No matching extensions.</p> : null}
				</div>
			</section>
		</div>
	);
}

function ExtensionCard({ extension, busy, onInstall, onUpdate, onAction }: Readonly<{
	extension: ExtensionSummaryDto;
	busy: boolean;
	onInstall: () => void;
	onUpdate: () => void;
	onAction: (action: ExtensionAction) => void;
}>) {
	return (
		<article className="settings-group extension-card">
			<div className="settings-row extension-card-heading">
				<div className="settings-row-info">
					<span className="settings-row-label extension-card-title">
						{extension.displayName}
						{extension.official ? <span className="settings-chip">Official</span> : null}
					</span>
					<span className="settings-row-description">{extension.description}</span>
				</div>
				<span className={`extension-state extension-state--${extension.state}`}>{extension.state}</span>
			</div>
			<div className="settings-row">
				<div className="settings-row-info">
					<span className="settings-row-label">{extension.packageName}</span>
					<span className="settings-row-description">
						{extension.version === undefined ? 'Not installed' : `Version ${extension.version}`}
						{extension.provenance === undefined ? '' : ` · ${extension.provenance}`}
					</span>
				</div>
				<div className="settings-row-control settings-inline-actions">
					{extension.state === 'available' ? (
						<button type="button" className="settings-primary-button" disabled={busy} onClick={onInstall}>Install</button>
					) : (
						<button type="button" className="settings-secondary-button" disabled={busy} onClick={() => onAction(extension.state === 'disabled' ? 'enable' : 'disable')}>{extension.state === 'disabled' ? 'Enable' : 'Disable'}</button>
					)}
					{extension.version === undefined ? null : (
						<>
							<button type="button" className="settings-secondary-button" disabled={busy} onClick={onUpdate}>Update</button>
							<button type="button" className="settings-secondary-button" disabled={busy} onClick={() => onAction('restart')}>Restart</button>
							<button type="button" className="settings-secondary-button" disabled={busy} onClick={() => onAction('rollback')}>Rollback</button>
							<button type="button" className="settings-danger-button" disabled={busy || extension.dependants.length > 0} onClick={() => onAction('remove')}>Uninstall</button>
						</>
					)}
				</div>
			</div>
			{extension.permissions.length === 0 ? null : (
				<div className="settings-group-footer extension-card-footer">
					<span className="settings-row-description">Permissions</span>
					<div className="settings-chip-row">{extension.permissions.map((permission) => <span className="settings-chip" key={permission}>{permission}</span>)}</div>
				</div>
			)}
		</article>
	);
}

function ExtensionPreview({ preview, serverName, update, onCancel, onConfirm }: Readonly<{
	preview: ExtensionInstallPreviewDto;
	serverName: string;
	update: boolean;
	onCancel: () => void;
	onConfirm: () => Promise<void>;
}>) {
	return (
		<section className="settings-section" aria-label="Extension installation preview">
			<h3 className="settings-section-title">Review {preview.packageName}@{preview.version}</h3>
			<div className="settings-group">
				<div className="settings-row settings-row--stacked">
					<span className="settings-row-label">Trusted code confirmation</span>
					<span className="settings-row-description">Review this exact package before running it on {serverName}.</span>
				</div>
				<PreviewRow label="Publisher" value={preview.publisher ?? 'Not provided'} />
				<PreviewRow label="Source" value={preview.source === 'uploaded' ? `Uploaded package${preview.filename ? ` · ${preview.filename}` : ''} · Unverified` : 'npmjs.com'} />
				<PreviewRow label="Integrity" value={preview.integrity} />
				<PreviewRow label="Provenance" value={preview.provenance ?? 'Unavailable'} />
				<PreviewRow label="Audit" value={`${preview.audit.critical} critical · ${preview.audit.high} high · ${preview.audit.moderate} moderate · ${preview.audit.low} low`} />
				<div className="settings-group-footer">
					<span />
					<div className="settings-inline-actions">
						<button type="button" className="settings-secondary-button" onClick={onCancel}>Cancel</button>
						<button type="button" className="settings-primary-button" onClick={() => void onConfirm()}>{update ? 'Update' : 'Install'} on {serverName}</button>
					</div>
				</div>
			</div>
		</section>
	);
}

function PreviewRow({ label, value }: Readonly<{ label: string; value: string }>) {
	return (
		<div className="settings-row">
			<div className="settings-row-info"><span className="settings-row-label">{label}</span></div>
			<div className="settings-row-control extension-preview-value">{value}</div>
		</div>
	);
}
