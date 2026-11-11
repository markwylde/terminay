/**
 * Settings › Extensions for an extension with forge sources (ADR-0105):
 * its accounts, which repositories it covers, and where pull requests and
 * issues appear. Every value lives on the server; this only asks and writes.
 */

import type { ForgeClientSettings, TerminayForgeClient } from '@terminay/client-core';
import { useCallback, useEffect, useState } from 'react';

export type ForgeAccountView = Readonly<{
	origin: string;
	login: string;
	credentialSource: string;
	state: 'ready' | 'rejected';
	owners: readonly string[];
	removable: boolean;
}>;

export type ForgeSettingsSource = Readonly<{
	sourceId: string;
	extensionId: string;
	displayName: string;
	allReach: 'readable' | 'owners';
	settings: ForgeClientSettings;
}>;

export type ForgeSettingsData = Readonly<{
	sources: readonly ForgeSettingsSource[];
	accounts: readonly ForgeAccountView[];
	accountErrors: readonly string[];
	owners: readonly string[];
	settings: ForgeClientSettings;
}>;

const CREDENTIAL_LABELS: Readonly<Record<string, string>> = {
	'cli-config': 'From the CLI login',
	cli: 'From the CLI',
	environment: 'From the environment',
	'sign-in': 'Signed in here',
};

/** Read what Settings shows for one extension; undefined when it has no forge source. */
export async function loadForgeSettings(
	client: TerminayForgeClient,
	extensionId: string,
	fresh = false,
): Promise<ForgeSettingsData | undefined> {
	const sourcesValue = (await client.sources()) as unknown as { sources?: ForgeSettingsSource[] };
	const sources = (sourcesValue.sources ?? []).filter((source) => source.extensionId === extensionId);
	const first = sources[0];
	if (first === undefined) return undefined;
	const [accountsValue, ownersValue] = await Promise.all([
		client.accounts(fresh) as unknown as Promise<{
			sources?: Array<{ extensionId: string; accounts: ForgeAccountView[]; error?: string }>;
		}>,
		(client.owners() as unknown as Promise<{ owners?: Record<string, string[]> }>).catch(
			(): { owners?: Record<string, string[]> } => ({ owners: {} }),
		),
	]);
	const mine = (accountsValue.sources ?? []).filter((source) => source.extensionId === extensionId);
	return {
		sources,
		accounts: mine.flatMap((source) => source.accounts),
		accountErrors: mine.flatMap((source) => (source.error === undefined ? [] : [source.error])),
		owners: ownersValue.owners?.[extensionId] ?? [],
		settings: first.settings,
	};
}

export function ForgeExtensionSettings({
	client,
	extensionId,
}: Readonly<{ client: TerminayForgeClient | undefined; extensionId: string }>) {
	const [data, setData] = useState<ForgeSettingsData>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const load = useCallback(
		async (fresh = false) => {
			if (client === undefined) return;
			try {
				setData(await loadForgeSettings(client, extensionId, fresh));
				setError(undefined);
			} catch {
				// A server without forge sources has nothing to show here.
				setData(undefined);
			}
		},
		[client, extensionId],
	);
	useEffect(() => {
		void load();
	}, [load]);
	if (client === undefined || data === undefined) return null;
	const write = async (work: () => Promise<unknown>) => {
		setBusy(true);
		setError(undefined);
		try {
			await work();
			await load(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ForgeSettingsView
			data={data}
			busy={busy}
			{...(error === undefined ? {} : { error })}
			onSettingsChange={(settings) => void write(() => client.setSettings(extensionId, settings))}
			onAddAccount={(origin, token) => write(() => client.addAccount(extensionId, origin, token))}
			onRemoveAccount={(origin) => void write(() => client.removeAccount(extensionId, origin))}
			onRecheck={() => void write(async () => undefined)}
		/>
	);
}

export function ForgeSettingsView({
	data,
	busy,
	error,
	onSettingsChange,
	onAddAccount,
	onRemoveAccount,
	onRecheck,
}: Readonly<{
	data: ForgeSettingsData;
	busy: boolean;
	error?: string;
	onSettingsChange: (settings: ForgeClientSettings) => void;
	onAddAccount: (origin: string, token: string) => Promise<void> | void;
	onRemoveAccount: (origin: string) => void;
	onRecheck: () => void;
}>) {
	const { settings } = data;
	const [adding, setAdding] = useState<string | undefined>(undefined);
	const [token, setToken] = useState('');
	const ownersReach = data.sources.some((source) => source.allReach === 'owners');
	const change = (patch: Partial<ForgeClientSettings>) => onSettingsChange({ ...settings, ...patch });
	const switchRow = (key: 'pullRequestsOnHome' | 'issuesOnHome' | 'projectTabs', label: string, description: string) => (
		<div className="settings-row" data-forge-switch={key}>
			<div className="settings-row-info">
				<span className="settings-row-label">{label}</span>
				<span className="settings-row-description">{description}</span>
			</div>
			<div className="settings-row-control">
				<label className="settings-switch" aria-label={label}>
					<input
						type="checkbox"
						checked={settings[key]}
						disabled={busy}
						onChange={(event) => change({ [key]: event.target.checked })}
					/>
					<span className="settings-slider"></span>
				</label>
			</div>
		</div>
	);
	return (
		<div className="forge-settings" data-forge-settings="true" aria-busy={busy}>
			{error === undefined ? null : (
				<div className="settings-inline-error" role="alert">
					<span>{error}</span>
				</div>
			)}
			<h3 className="settings-section-title">Accounts</h3>
			<div className="settings-group">
				{data.accounts.length === 0 ? (
					<div className="settings-row">
						<span className="settings-row-description">
							No account found. Sign in with the CLI, or add one with a token.
						</span>
					</div>
				) : null}
				{data.accounts.map((account) => (
					<div
						className="settings-row"
						key={account.origin}
						data-forge-account={account.origin}
						data-forge-account-state={account.state}
					>
						<div className="settings-row-info">
							<span className="settings-row-label">
								{account.login} · {new URL(account.origin).host}
							</span>
							<span className="settings-row-description">
								{account.state === 'rejected'
									? 'The server refused this account’s token. Sign in again.'
									: `${CREDENTIAL_LABELS[account.credentialSource] ?? account.credentialSource}${account.owners.length > 1 ? ` · ${account.owners.length - 1} organisation${account.owners.length === 2 ? '' : 's'}` : ''}`}
							</span>
						</div>
						<div className="settings-row-control forge-settings__buttons">
							{account.state === 'rejected' ? (
								<button
									type="button"
									className="settings-secondary-button settings-secondary-button--small"
									disabled={busy}
									onClick={() => {
										setAdding(account.origin);
										setToken('');
									}}
								>
									Sign in
								</button>
							) : null}
							{account.removable ? (
								<button
									type="button"
									className="settings-secondary-button settings-secondary-button--small"
									disabled={busy}
									onClick={() => onRemoveAccount(account.origin)}
								>
									Remove
								</button>
							) : null}
						</div>
					</div>
				))}
				{data.accountErrors.map((message) => (
					<div className="settings-row" key={message}>
						<span className="settings-row-description" role="alert">
							{message}
						</span>
					</div>
				))}
				{adding === undefined ? (
					<div className="settings-row">
						<div className="settings-row-control forge-settings__buttons">
							<button
								type="button"
								className="settings-secondary-button settings-secondary-button--small"
								disabled={busy}
								data-forge-add-account="true"
								onClick={() => {
									setAdding('');
									setToken('');
								}}
							>
								Add account…
							</button>
							<button
								type="button"
								className="settings-secondary-button settings-secondary-button--small"
								disabled={busy}
								onClick={onRecheck}
							>
								Check again
							</button>
						</div>
					</div>
				) : (
					<form
						className="settings-row forge-settings__add"
						data-forge-add-account-form="true"
						onSubmit={(event) => {
							event.preventDefault();
							const origin = adding.trim();
							void Promise.resolve(onAddAccount(origin, token)).then(() => {
								setAdding(undefined);
								setToken('');
							});
						}}
					>
						<label className="forge-field forge-field--stack">
							<span className="settings-row-label">Server</span>
							<input
								className="settings-input-text"
								placeholder="https://git.example.com"
								value={adding}
								onChange={(event) => setAdding(event.target.value)}
							/>
						</label>
						<label className="forge-field forge-field--stack">
							<span className="settings-row-label">Access token</span>
							<input
								className="settings-input-text"
								type="password"
								autoComplete="off"
								value={token}
								onChange={(event) => setToken(event.target.value)}
							/>
						</label>
						<div className="forge-settings__buttons">
							<button
								type="submit"
								className="settings-secondary-button settings-secondary-button--small"
								disabled={busy || !/^https:\/\/[^\s/]+/u.test(adding.trim()) || token.trim().length === 0}
							>
								Add
							</button>
							<button
								type="button"
								className="settings-secondary-button settings-secondary-button--small"
								onClick={() => setAdding(undefined)}
							>
								Cancel
							</button>
						</div>
					</form>
				)}
			</div>
			<h3 className="settings-section-title">Repositories</h3>
			<div className="settings-group" role="radiogroup" aria-label="Repositories">
				{(
					[
						[
							'all',
							ownersReach ? 'Everything my accounts and their organisations own' : 'Everything I can access',
							ownersReach
								? 'Others’ repositories you work on still appear under Involved.'
								: 'Every repository your accounts can read.',
						],
						['openProjects', 'Repositories of open projects', 'Only repositories open as a project here.'],
						['owners', 'Chosen owners', 'Only repositories owned by the users and organisations you choose.'],
					] as const
				).map(([value, label, description]) => (
					<label className="settings-row forge-settings__choice" key={value} data-forge-repositories={value}>
						<input
							type="radio"
							name={`forge-repositories-${data.sources[0]?.extensionId ?? ''}`}
							checked={settings.repositories === value}
							disabled={busy}
							onChange={() => change({ repositories: value })}
						/>
						<span className="settings-row-info">
							<span className="settings-row-label">{label}</span>
							<span className="settings-row-description">{description}</span>
						</span>
					</label>
				))}
				{settings.repositories === 'owners' ? (
					<div className="settings-row forge-settings__owners" data-forge-owner-catalogue="true">
						{data.owners.length === 0 ? (
							<span className="settings-row-description">No owners known yet. Add an account first.</span>
						) : (
							data.owners.map((owner) => (
								<label key={owner} className="forge-check-label">
									<input
										type="checkbox"
										checked={settings.owners.includes(owner)}
										disabled={busy}
										onChange={(event) =>
											change({
												owners: event.target.checked
													? [...settings.owners, owner]
													: settings.owners.filter((candidate) => candidate !== owner),
											})
										}
									/>
									{owner}
								</label>
							))
						)}
					</div>
				) : null}
			</div>
			<h3 className="settings-section-title">Pull requests and issues</h3>
			<div className="settings-group">
				{switchRow('pullRequestsOnHome', 'Pull Requests on Home', 'List pull requests in Home’s sidebar.')}
				{switchRow('issuesOnHome', 'Issues on Home', 'List issues in Home’s sidebar.')}
				{switchRow('projectTabs', 'Project Git tab', 'Show issues and pull requests in a Git tab of a project whose remote this extension claims.')}
			</div>
		</div>
	);
}
