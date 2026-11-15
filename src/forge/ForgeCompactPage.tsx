/**
 * Home › Pull Requests and Issues on a compact workspace: the compact section
 * page. The scopes are the tabs (the same state as the wide scope chips);
 * State, grouping, the repository, the account, and Refresh are in the sheet.
 * A scope's count is shown once this tab has received that scope's result for
 * the current State, repository, and account; nothing is fetched to show a
 * count.
 */

import { GitBranch, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { CompactSectionPage } from '../workspace/compact/CompactSectionPage';
import {
	CompactChip,
	CompactEmpty,
	CompactGroupHeader,
	CompactRow,
} from '../workspace/compact/CompactRow';
import {
	SheetRow,
	SheetSegment,
	SheetSelect,
} from '../workspace/compact/CompactSheet';
import {
	appliedOptions,
	type CompactTab,
} from '../workspace/compact/compactSectionModel';
import {
	defaultPreferences,
	type ForgeAccountOption,
	type ForgeAccountRef,
	type ForgeKind,
	type ForgeListItemView,
	type ForgeRepositoryFocus,
	type ForgeViewPreferences,
	forgeName,
	groupByRepository,
	ISSUE_STATES,
	itemKey,
	PULL_REQUEST_STATES,
	relativeTime,
	sameAccount,
	sortByUpdated,
	updatedAgo,
	worktreeChipLabel,
} from './forgeModel.ts';
import { ChecksChip, StateMark } from './ForgeViews.tsx';

const SHORT_SCOPES: Readonly<
	Record<ForgeKind, readonly Readonly<{ id: string; label: string }>[]>
> = {
	pullRequest: [
		{ id: 'reviewRequested', label: 'Review' },
		{ id: 'authored', label: 'Mine' },
		{ id: 'involved', label: 'Involved' },
		{ id: 'all', label: 'All' },
	],
	issue: [
		{ id: 'assigned', label: 'Assigned' },
		{ id: 'authored', label: 'Created' },
		{ id: 'mentioned', label: 'Mentioned' },
		{ id: 'all', label: 'All' },
	],
};

/** The key a scope's result is counted under. */
export function forgeCountKey(
	scope: string,
	state: string,
	repository: ForgeRepositoryFocus | undefined,
	account = '',
): string {
	return [
		scope,
		state,
		repository === undefined
			? ''
			: `${repository.origin}/${repository.owner}/${repository.name}`,
		account,
	].join('\u0001');
}

export type ForgeScopeCount = Readonly<{ count: number; more: boolean }>;

export function ForgeCompactPage(
	props: Readonly<{
		kind: ForgeKind;
		preferences: ForgeViewPreferences;
		onPreferencesChange: (next: ForgeViewPreferences) => void;
		items: readonly ForgeListItemView[];
		counts: ReadonlyMap<string, ForgeScopeCount>;
		repository: ForgeRepositoryFocus | undefined;
		onRepository: (repository: ForgeRepositoryFocus | undefined) => void;
		/** Accounts that serve this list; the control shows from two. */
		accountOptions: readonly ForgeAccountOption[];
		/** The account the list is narrowed to; null is All accounts. */
		account: ForgeAccountRef | null;
		onAccountChange: (account: ForgeAccountRef | null) => void;
		loading: boolean;
		settled: boolean;
		noAccounts: boolean;
		error?: string;
		fetchedAt?: number;
		nextCursor?: string;
		loadingMore: boolean;
		now: number;
		notes: ReactNode;
		onSelect: (entry: ForgeListItemView) => void;
		onRefresh: () => void;
		onLoadMore: () => void;
		onOpenSettings: () => void;
		projectTitle: (projectId: string) => string | undefined;
		projectOrder: readonly string[];
		displayNames: ReadonlyMap<string, string>;
	}>,
) {
	const { kind, preferences, onPreferencesChange, items, now } = props;
	const noun = kind === 'pullRequest' ? 'pull requests' : 'issues';
	const defaults = defaultPreferences(kind);
	const states = kind === 'pullRequest' ? PULL_REQUEST_STATES : ISSUE_STATES;
	const stateLabel =
		states.find((state) => state.id === preferences.state)?.label ??
		preferences.state;
	const accountKey =
		props.account === null
			? ''
			: `${props.account.sourceId}\u0000${props.account.origin}`;
	const chosenAccount =
		props.account === null
			? undefined
			: props.accountOptions.find((option) =>
					sameAccount(option.account, props.account),
				);
	const tabs: CompactTab[] = SHORT_SCOPES[kind].map((scope) => {
		const seen = props.counts.get(
			forgeCountKey(scope.id, preferences.state, props.repository, accountKey),
		);
		return {
			id: scope.id,
			label: scope.label,
			attention: scope.id === 'reviewRequested',
			...(seen === undefined ? {} : { count: seen.count }),
		};
	});
	const countLabels = new Map(
		SHORT_SCOPES[kind].map((scope) => {
			const seen = props.counts.get(
				forgeCountKey(scope.id, preferences.state, props.repository, accountKey),
			);
			return [scope.id, seen?.more === true ? `${seen.count}+` : undefined];
		}),
	);
	const applied = appliedOptions([
		preferences.state !== defaults.state && {
			id: 'state',
			label: stateLabel,
			reset: () =>
				onPreferencesChange({ ...preferences, state: defaults.state }),
		},
		props.repository !== undefined && {
			id: 'repository',
			label: `${props.repository.owner}/${props.repository.name}`,
			reset: () => props.onRepository(undefined),
		},
		props.account !== null && {
			id: 'account',
			label: chosenAccount?.label ?? props.account.origin,
			reset: () => props.onAccountChange(null),
		},
	]);
	// The repositories on offer: those in the list, and the one chosen.
	const repositories = new Map<string, ForgeRepositoryFocus>();
	if (props.repository !== undefined)
		repositories.set(
			`${props.repository.origin}/${props.repository.owner}/${props.repository.name}`,
			props.repository,
		);
	for (const entry of items) {
		const { origin, owner, name } = entry.item.reference;
		repositories.set(`${origin}/${owner}/${name}`, { origin, owner, name });
	}
	const repositoryValue =
		props.repository === undefined
			? ''
			: `${props.repository.origin}/${props.repository.owner}/${props.repository.name}`;

	const grouped = preferences.group === 'repo';
	const groups = grouped
		? groupByRepository(items)
		: [
				{
					key: 'all',
					sourceId: '',
					origin: '',
					owner: '',
					name: '',
					items: sortByUpdated(items),
				},
			];

	const renderRow = (entry: ForgeListItemView) => {
		const { item } = entry;
		const chip = worktreeChipLabel(
			entry.worktrees,
			props.projectTitle,
			props.projectOrder,
		);
		const hasChips =
			chip !== undefined ||
			item.labels.length > 0 ||
			(item.pullRequest?.checks?.total ?? 0) > 0;
		return (
			<CompactRow
				key={itemKey(item.reference)}
				lead={<StateMark kind={item.reference.kind} state={item.state} />}
				title={<span className="cforge__title">{item.title}</span>}
				trailing={relativeTime(item.updatedAt, now)}
				detail={[
					`#${item.reference.number}`,
					item.author,
					grouped
						? undefined
						: `${item.reference.owner}/${item.reference.name}`,
				]
					.filter(Boolean)
					.join(' · ')}
				{...(hasChips
					? {
							chips: (
								<>
									{chip === undefined ? null : (
										<CompactChip tone="info">
											<GitBranch size={11} aria-hidden="true" />
											{chip}
										</CompactChip>
									)}
									{item.labels.slice(0, 3).map((label) => (
										<CompactChip key={label.name}>{label.name}</CompactChip>
									))}
									<ChecksChip checks={item.pullRequest?.checks} />
								</>
							),
						}
					: {})}
				onActivate={() => props.onSelect(entry)}
				rowProps={{ 'data-forge-row': String(item.reference.number) }}
			/>
		);
	};

	let body: ReactNode;
	if (props.error !== undefined && items.length === 0) {
		body = (
			<CompactEmpty
				title={`Could not load ${noun}`}
				action={{ label: 'Retry', onActivate: props.onRefresh }}
			>
				{props.error}
			</CompactEmpty>
		);
	} else if (props.noAccounts) {
		body = (
			<CompactEmpty
				title="No forge account is set up"
				action={{
					label: 'Open Settings › Extensions',
					onActivate: props.onOpenSettings,
				}}
			>
				Sign in to Gitea or GitHub, or add an account in Settings › Extensions.
			</CompactEmpty>
		);
	} else if (!props.settled && props.loading && items.length === 0) {
		body = <CompactEmpty title={`Loading ${noun}…`} />;
	} else if (items.length === 0 && chosenAccount !== undefined) {
		body = (
			<CompactEmpty
				title={`No ${noun} for ${chosenAccount.login} on ${chosenAccount.host}`}
				action={{
					label: 'Show all accounts',
					onActivate: () => props.onAccountChange(null),
				}}
			/>
		);
	} else if (items.length === 0) {
		const isDefault =
			preferences.scope === defaults.scope &&
			preferences.state === defaults.state &&
			props.repository === undefined;
		body = (
			<CompactEmpty
				title={`No ${noun} here`}
				{...(isDefault
					? {}
					: {
							action: {
								label: 'Show all',
								onActivate: () => {
									onPreferencesChange({
										...preferences,
										scope: defaults.scope,
										state: defaults.state,
									});
									props.onRepository(undefined);
								},
							},
						})}
			/>
		);
	} else {
		body = (
			<div aria-busy={props.loading}>
				{groups.map((group) =>
					group.items.length === 0 ? null : (
						<section
							key={group.key}
							aria-label={
								group.key === 'all' ? noun : `${group.owner}/${group.name}`
							}
						>
							{group.key === 'all' ? null : (
								<CompactGroupHeader
									label={`${group.owner}/${group.name}`}
									count={`${forgeName(group.sourceId, props.displayNames)} · ${group.items.length}`}
								/>
							)}
							{group.items.map(renderRow)}
						</section>
					),
				)}
				{props.nextCursor === undefined ? null : (
					<div className="cforge__more">
						<button
							type="button"
							className="csheet__button"
							disabled={props.loadingMore}
							onClick={props.onLoadMore}
						>
							{props.loadingMore ? 'Loading…' : 'Load more'}
						</button>
					</div>
				)}
			</div>
		);
	}

	const updated = updatedAgo(props.fetchedAt, now);
	return (
		<CompactSectionPage
			section={kind === 'pullRequest' ? 'pull-requests' : 'issues'}
			title={kind === 'pullRequest' ? 'Pull Requests' : 'Issues'}
			{...(props.settled
				? {
						summary: `${items.length}${props.nextCursor === undefined ? '' : '+'}`,
					}
				: {})}
			tabs={tabs.map((tab) => {
				const label = countLabels.get(tab.id);
				return label === undefined ? tab : { ...tab, countLabel: label };
			})}
			selectedTab={preferences.scope}
			onSelectTab={(scope) => onPreferencesChange({ ...preferences, scope })}
			applied={applied}
			banner={props.notes}
			sheet={{
				title: kind === 'pullRequest' ? 'Pull Requests' : 'Issues',
				canReset: applied !== undefined || preferences.group !== defaults.group,
				onReset: () => {
					onPreferencesChange({
						...preferences,
						state: defaults.state,
						group: defaults.group,
					});
					props.onRepository(undefined);
					if (props.account !== null) props.onAccountChange(null);
				},
				content: (
					<>
						<SheetSegment
							label="State"
							value={preferences.state}
							options={states.map((state) => ({
								value: state.id,
								label: state.label,
							}))}
							onChange={(state) =>
								onPreferencesChange({ ...preferences, state })
							}
						/>
						<SheetSegment
							label="Group"
							value={preferences.group}
							options={[
								{ value: 'repo', label: 'Repository' },
								{ value: 'none', label: 'None' },
							]}
							onChange={(group) =>
								onPreferencesChange({ ...preferences, group })
							}
						/>
						<SheetSelect
							label="Repository"
							value={repositoryValue}
							options={[
								{ value: '', label: 'Every repository' },
								...[...repositories].map(([key, repository]) => ({
									value: key,
									label: `${repository.owner}/${repository.name}`,
								})),
							]}
							onChange={(key) =>
								props.onRepository(
									key === '' ? undefined : repositories.get(key),
								)
							}
						/>
						{props.accountOptions.length < 2 ? null : (
							<SheetSelect
								label="Account"
								value={
									chosenAccount === undefined
										? ''
										: String(props.accountOptions.indexOf(chosenAccount))
								}
								options={[
									{ value: '', label: 'All accounts' },
									...props.accountOptions.map((option, position) => ({
										value: String(position),
										label: option.label,
									})),
								]}
								onChange={(value) =>
									props.onAccountChange(
										value === ''
											? null
											: (props.accountOptions[Number(value)]?.account ?? null),
									)
								}
							/>
						)}
						<SheetRow label={updated ?? 'Not loaded yet'}>
							<button
								type="button"
								className="csheet__button"
								disabled={props.loading}
								onClick={props.onRefresh}
								data-forge-refresh="true"
							>
								<RefreshCw
									size={14}
									aria-hidden="true"
									className={props.loading ? 'forge-spin' : undefined}
								/>
								Refresh
							</button>
						</SheetRow>
					</>
				),
			}}
		>
			{body}
		</CompactSectionPage>
	);
}
