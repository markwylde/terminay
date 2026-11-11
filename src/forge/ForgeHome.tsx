/**
 * Home's Pull Requests and Issues sections, and a project's Git tab
 * (ADR-0105). These fetch on demand through the forge client and draw with
 * `ForgeViews`.
 */

import type { ForgeClientListRequest, TerminayForgeClient } from '@terminay/client-core';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
	DEFAULT_FORGE_GIT_PANE_LAYOUT,
	FORGE_GIT_PANES_KEY,
	type ForgeClaimView,
	type ForgeGitPaneId,
	type ForgeGitPaneLayout,
	type ForgeHomeFocus,
	type ForgeKind,
	type ForgeListItemView,
	type ForgeReference,
	type ForgeRepositoryFocus,
	type ForgeViewPreferences,
	itemKey,
	preferencesKey,
	projectPullRequestGroups,
	readGitPaneLayout,
	readPreferences,
} from './forgeModel.ts';
import { House, RefreshCw } from 'lucide-react';
import {
	SidebarPanelStack,
	type SidebarPanelStackItem,
} from '../components/sidebar/SidebarPanelStack.tsx';
import {
	type ForgeEnvironment,
	ForgeDetailPane,
	ForgeListPane,
	ForgeSidebarRow,
} from './ForgeViews.tsx';
import { useForgeChanges, useForgeDetail, useForgeList } from './useForge.ts';

const HOME_PAGE_SIZE = 50;

function recallPreferences(kind: ForgeKind): ForgeViewPreferences {
	try {
		return readPreferences(kind, globalThis.localStorage?.getItem(preferencesKey(kind)));
	} catch {
		return readPreferences(kind, null);
	}
}

function rememberPreferences(kind: ForgeKind, preferences: ForgeViewPreferences): void {
	try {
		globalThis.localStorage?.setItem(preferencesKey(kind), JSON.stringify(preferences));
	} catch {
		/* a device that cannot remember starts from the default next time */
	}
}

export type ForgeSourceInfo = Readonly<{
	sourceId: string;
	extensionId: string;
	displayName: string;
	kinds: readonly ForgeKind[];
	allReach: 'readable' | 'owners';
	settings?: Readonly<{ pullRequestsOnHome: boolean; issuesOnHome: boolean; projectTabs: boolean }>;
}>;

/** The server's forge sources, asked once and again on `forge.changed`. */
export function useForgeSources(client: TerminayForgeClient | undefined): readonly ForgeSourceInfo[] {
	const [sources, setSources] = useState<readonly ForgeSourceInfo[]>([]);
	const load = useCallback(() => {
		if (client === undefined) {
			setSources([]);
			return;
		}
		client
			.sources()
			.then((value) => {
				const list = (value as unknown as { sources?: ForgeSourceInfo[] }).sources;
				setSources(Array.isArray(list) ? list : []);
			})
			.catch(() => setSources([]));
	}, [client]);
	useEffect(load, [load]);
	useForgeChanges(client, load);
	return sources;
}

/** Each open project's claimed repositories, asked when the projects change and on `forge.changed`. */
export function useForgeClaims(
	client: TerminayForgeClient | undefined,
	projectIds: readonly string[],
): ReadonlyMap<string, readonly ForgeClaimView[]> {
	const [claims, setClaims] = useState<ReadonlyMap<string, readonly ForgeClaimView[]>>(() => new Map());
	const [revision, setRevision] = useState(0);
	const key = projectIds.join('\u0000');
	useForgeChanges(client, () => setRevision((value) => value + 1));
	useEffect(() => {
		if (client === undefined || projectIds.length === 0) {
			setClaims(new Map());
			return;
		}
		let current = true;
		void Promise.all(
			projectIds.map(async (projectId) => {
				try {
					const value = (await client.claims(projectId)) as unknown as { claims?: ForgeClaimView[] };
					return [projectId, Array.isArray(value.claims) ? value.claims : []] as const;
				} catch {
					return [projectId, [] as ForgeClaimView[]] as const;
				}
			}),
		).then((entries) => {
			if (current) setClaims(new Map(entries));
		});
		return () => {
			current = false;
		};
	}, [client, key, revision]);
	return claims;
}

export type ForgeHomeAvailability = Readonly<{
	/** False for a client bound to one project: Home has no forge sections. */
	unbound: boolean;
	counts: Readonly<{ pullRequests: number | null; issues: number | null }>;
}>;

/** Whether Home offers the sections, and their badges; asked on show and on `forge.changed`. */
export function useForgeHomeAvailability(
	client: TerminayForgeClient | undefined,
	visible: boolean,
): ForgeHomeAvailability | undefined {
	const [state, setState] = useState<ForgeHomeAvailability>();
	const [revision, setRevision] = useState(0);
	useForgeChanges(client, () => setRevision((value) => value + 1));
	useEffect(() => {
		if (client === undefined) {
			setState(undefined);
			return;
		}
		if (!visible) return;
		let current = true;
		client
			.counts()
			.then((counts) => {
				if (current) setState({ unbound: true, counts });
			})
			.catch((error: unknown) => {
				if (!current) return;
				// Refused: this client is bound to a project, so Home has no forge sections.
				const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : String(error);
				setState(
					/forbidden|unbound|bound/iu.test(text)
						? { unbound: false, counts: { pullRequests: null, issues: null } }
						: { unbound: true, counts: { pullRequests: null, issues: null } },
				);
			});
		return () => {
			current = false;
		};
	}, [client, revision, visible]);
	return state;
}

// ── Home ───────────────────────────────────────────────────────────────

export type ForgeHomeSectionProps = Readonly<{
	client: TerminayForgeClient;
	kind: ForgeKind;
	environment: ForgeEnvironment;
	sources: readonly ForgeSourceInfo[];
	/** A request from a project tab to show a repository and maybe an item. */
	focus?: ForgeHomeFocus;
	visible: boolean;
}>;

type Selection = Readonly<{ sourceId: string; reference: ForgeReference }>;

export function ForgeHomeSection({ client, kind, environment, sources, focus, visible }: ForgeHomeSectionProps) {
	const [preferences, setPreferences] = useState(() => recallPreferences(kind));
	const [filter, setFilter] = useState<ForgeRepositoryFocus>();
	const [selection, setSelection] = useState<Selection>();
	const [now, setNow] = useState(() => Date.now());
	const appliedNonce = focus?.kind === kind ? focus.nonce : undefined;
	useEffect(() => {
		if (focus === undefined || focus.kind !== kind) return;
		setFilter(focus.repository);
		if (focus.item !== undefined && focus.sourceId !== undefined)
			setSelection({ sourceId: focus.sourceId, reference: focus.item });
		else setSelection(undefined);
	}, [appliedNonce]);
	const request = useMemo<ForgeClientListRequest>(
		() => ({
			kind,
			scope: preferences.scope as ForgeClientListRequest['scope'],
			state: preferences.state as ForgeClientListRequest['state'],
			purpose: 'home',
			pageSize: HOME_PAGE_SIZE,
			...(filter === undefined ? {} : { repositories: [{ origin: filter.origin, owner: filter.owner, name: filter.name }] }),
		}),
		[filter, kind, preferences.scope, preferences.state],
	);
	const list = useForgeList(client, request, visible);
	// The relative times are worked out when an answer arrives or the view is shown.
	useEffect(() => setNow(Date.now()), [list.fetchedAt, visible]);
	const selectedKey = selection === undefined ? undefined : itemKey(selection.reference);
	const listed = list.items.find((entry) => itemKey(entry.item.reference) === selectedKey);
	const detail = useForgeDetail(client, selection?.sourceId, selection?.reference, list.fetchedAt ?? 0);
	const entry: ForgeListItemView | undefined =
		listed !== undefined
			? { ...listed, worktrees: detail.detail === undefined ? listed.worktrees : detail.worktrees }
			: selection !== undefined && detail.detail !== undefined
				? { sourceId: selection.sourceId, item: detail.detail.summary, worktrees: detail.worktrees }
				: undefined;
	const ownersReach = sources.filter((source) => source.allReach === 'owners' && source.kinds.includes(kind));
	const ownersReachNote =
		ownersReach.length === 0
			? undefined
			: `${ownersReach.map((source) => source.displayName).join(' and ')}: All covers repositories owned by your account and its organisations. Others' repositories you work on appear under Involved.`;
	const projectTitle = (projectId: string) =>
		environment.projects.find((project) => project.projectId === projectId)?.title;
	const title = kind === 'pullRequest' ? 'Pull Requests' : 'Issues';
	return (
		<div className="forge-home" data-forge-home={kind}>
			<div className="forge-home__head">
				<h2>{title}</h2>
				<p className="forge-faint">
					{list.settled
						? `${list.items.length}${list.nextCursor === undefined ? '' : '+'} ${kind === 'pullRequest' ? 'pull requests' : 'issues'}`
						: ' '}
				</p>
			</div>
			<div className={`forge-home__grid${entry === undefined ? '' : ' forge-home__grid--detail'}`}>
				<ForgeListPane
					kind={kind}
					preferences={preferences}
					onPreferencesChange={(next) => {
						setPreferences(next);
						rememberPreferences(kind, next);
					}}
					items={list.items}
					sources={list.sources}
					noAccounts={list.noAccounts}
					loading={list.loading}
					settled={list.settled}
					{...(list.error === undefined ? {} : { error: list.error })}
					{...(list.fetchedAt === undefined ? {} : { fetchedAt: list.fetchedAt })}
					{...(list.nextCursor === undefined ? {} : { nextCursor: list.nextCursor })}
					loadingMore={list.loadingMore}
					now={now}
					{...(selectedKey === undefined ? {} : { selectedKey })}
					onSelect={(next) => setSelection({ sourceId: next.sourceId, reference: next.item.reference })}
					onRefresh={list.refresh}
					onLoadMore={list.loadMore}
					onOpenSettings={environment.actions.openSettings}
					{...(ownersReachNote === undefined ? {} : { ownersReachNote })}
					{...(filter === undefined ? {} : { repositoryFilter: filter })}
					onClearRepositoryFilter={() => setFilter(undefined)}
					projectTitle={projectTitle}
					projectOrder={environment.projects.map((project) => project.projectId)}
					displayNames={environment.displayNames}
				/>
				{entry === undefined ? (
					selection !== undefined && detail.error !== undefined ? (
						<aside className="forge-detail">
							<div className="forge-failure" role="alert">
								{detail.error}
							</div>
						</aside>
					) : null
				) : (
					<ForgeDetailPane
						entry={entry}
						{...(detail.detail === undefined ? {} : { body: detail.detail.body, comments: detail.detail.comments })}
						loading={detail.loading}
						{...(detail.error === undefined ? {} : { error: detail.error })}
						environment={environment}
						now={now}
						onReload={detail.reload}
						onClose={() => setSelection(undefined)}
					/>
				)}
			</div>
		</div>
	);
}

// ── A project's Git tab ────────────────────────────────────────────────

export type ProjectForgeTabsOptions = Readonly<{
	client: TerminayForgeClient | undefined;
	projectId: string;
	/** This project's claimed repositories. */
	claims: readonly ForgeClaimView[];
	/** The project is in front; its lists are asked for then. */
	visible: boolean;
	/** The selected folder's worktree path, for This worktree. */
	selectedWorktreePath?: string;
	/** A client bound to this project: rows open a detail here, with no Show all on Home. */
	bound: boolean;
	environment: ForgeEnvironment;
	openInHome: (focus: Omit<ForgeHomeFocus, 'nonce'>) => void;
}>;

/**
 * What activating a project tab's row does: for a client bound to the
 * project, open the item here; otherwise go to Home's section for that
 * repository with the item selected.
 */
export function projectRowActivation(
	entry: Pick<ForgeListItemView, 'sourceId' | 'item'>,
	bound: boolean,
):
	| Readonly<{ kind: 'detail'; sourceId: string; reference: ForgeReference }>
	| Readonly<{ kind: 'home'; focus: Omit<ForgeHomeFocus, 'nonce'> }> {
	const { reference } = entry.item;
	if (bound) return { kind: 'detail', sourceId: entry.sourceId, reference };
	return {
		kind: 'home',
		focus: {
			kind: reference.kind,
			repository: { origin: reference.origin, owner: reference.owner, name: reference.name },
			item: reference,
			sourceId: entry.sourceId,
		},
	};
}

function recallGitPaneLayout(): ForgeGitPaneLayout {
	try {
		return readGitPaneLayout(globalThis.localStorage?.getItem(FORGE_GIT_PANES_KEY));
	} catch {
		return DEFAULT_FORGE_GIT_PANE_LAYOUT;
	}
}

function rememberGitPaneLayout(layout: ForgeGitPaneLayout): void {
	try {
		globalThis.localStorage?.setItem(FORGE_GIT_PANES_KEY, JSON.stringify(layout));
	} catch {
		/* a device that cannot remember starts from the default next time */
	}
}

export type ProjectGitPanes = Readonly<{
	items: readonly SidebarPanelStackItem[];
	onHeightsCommit: (heights: Readonly<Record<string, number>>) => void;
	onReorder: (orderedIds: string[]) => void;
}>;

/**
 * A project's Git tab, when a source claims its remote: Issues and Pull
 * Requests sidebar panes that collapse, reorder, and resize like the right
 * sidebar's, laid out the same way on every project of this device.
 */
export function useProjectGitTab(options: ProjectForgeTabsOptions): ReactNode | undefined {
	const panes = useProjectGitPanes(options);
	if (panes === undefined) return undefined;
	return (
		<div className="forge-git-tab" data-forge-git-tab="true">
			<SidebarPanelStack items={panes.items} onHeightsCommit={panes.onHeightsCommit} onReorder={panes.onReorder} />
		</div>
	);
}

/** The Git tab's panes, in the device's order, or undefined when nothing is claimed. */
export function useProjectGitPanes(options: ProjectForgeTabsOptions): ProjectGitPanes | undefined {
	const { client, projectId, claims, visible } = options;
	const shown = claims.filter((claim) => claim.projectTabs);
	const pullRequestClaims = shown.filter((claim) => claim.kinds.includes('pullRequest'));
	const issueClaims = shown.filter((claim) => claim.kinds.includes('issue'));
	const base = (kind: ForgeKind, state: 'open' | 'merged', pageSize: number): ForgeClientListRequest => ({
		kind,
		scope: 'all',
		state,
		purpose: 'project',
		projectId,
		pageSize,
	});
	const openPulls = useForgeList(
		client,
		pullRequestClaims.length === 0 ? undefined : base('pullRequest', 'open', 50),
		visible,
	);
	const mergedPulls = useForgeList(
		client,
		pullRequestClaims.length === 0 ? undefined : base('pullRequest', 'merged', 5),
		visible,
	);
	const openIssues = useForgeList(client, issueClaims.length === 0 ? undefined : base('issue', 'open', 50), visible);
	const [detail, setDetail] = useState<Readonly<{ sourceId: string; reference: ForgeReference }>>();
	const [layout, setLayout] = useState<ForgeGitPaneLayout>(recallGitPaneLayout);
	const changeLayout = useCallback((next: (current: ForgeGitPaneLayout) => ForgeGitPaneLayout) => {
		setLayout((current) => {
			const value = next(current);
			rememberGitPaneLayout(value);
			return value;
		});
	}, []);
	if (pullRequestClaims.length === 0 && issueClaims.length === 0) return undefined;

	const selectedWorktreeId =
		options.selectedWorktreePath === undefined
			? undefined
			: openPulls.items
					.flatMap((entry) => entry.worktrees)
					.find((match) => match.projectId === projectId && match.path === options.selectedWorktreePath)?.worktreeId;
	const projectTitle = (id: string) => options.environment.projects.find((project) => project.projectId === id)?.title;
	const projectOrder = options.environment.projects.map((project) => project.projectId);
	const activate = (entry: ForgeListItemView) => {
		const activation = projectRowActivation(entry, options.bound);
		if (activation.kind === 'detail')
			setDetail({ sourceId: activation.sourceId, reference: activation.reference });
		else options.openInHome(activation.focus);
	};
	const detailFor = (kind: ForgeKind) =>
		detail === undefined || detail.reference.kind !== kind ? null : (
			<div className="forge-tab">
				<ProjectForgeDetail
					client={client}
					sourceId={detail.sourceId}
					reference={detail.reference}
					environment={options.environment}
					onClose={() => setDetail(undefined)}
				/>
			</div>
		);
	const rows = (entries: readonly ForgeListItemView[]) => (
		<ul className="forge-side-rows">
			{entries.map((entry) => (
				<ForgeSidebarRow
					key={itemKey(entry.item.reference)}
					entry={entry}
					showRepository={shown.length > 1}
					selected={detail !== undefined && itemKey(detail.reference) === itemKey(entry.item.reference)}
					onSelect={activate}
					projectTitle={projectTitle}
					projectOrder={projectOrder}
				/>
			))}
		</ul>
	);
	const message = (text: ReactNode) => <div className="git-panel__message forge-side-message">{text}</div>;
	const status = (list: { loading: boolean; settled: boolean; error?: string; refresh: () => void }, noun: string) =>
		list.error !== undefined
			? message(
					<span role="alert">
						Could not load {noun}.{' '}
						<button type="button" className="forge-link" onClick={list.refresh}>
							Retry
						</button>
					</span>,
				)
			: !list.settled && list.loading
				? message('Loading…')
				: null;
	const actions = (kind: ForgeKind, relevant: readonly ForgeClaimView[], refresh: () => void, loading: boolean) => (
		<>
			<button
				type="button"
				className="sidebar-pane__action-button"
				aria-label={`Refresh ${kind === 'issue' ? 'issues' : 'pull requests'}`}
				title="Refresh"
				onClick={refresh}
			>
				<RefreshCw size={14} aria-hidden="true" className={loading ? 'forge-spin' : undefined} />
			</button>
			{options.bound || relevant.length === 0 ? null : (
				<button
					type="button"
					className="sidebar-pane__action-button"
					aria-label="Show all on Home"
					title={`Show all on Home · ${relevant.map((claim) => `${claim.owner}/${claim.name}`).join(', ')}`}
					data-forge-show-all={kind}
					onClick={() => {
						const claim = relevant[0] as ForgeClaimView;
						options.openInHome({
							kind,
							repository: { origin: claim.origin, owner: claim.owner, name: claim.name },
						});
					}}
				>
					<House size={14} aria-hidden="true" />
				</button>
			)}
		</>
	);
	const toggle = (id: ForgeGitPaneId) => () =>
		changeLayout((current) => ({ ...current, collapsed: { ...current.collapsed, [id]: !current.collapsed[id] } }));

	const items: SidebarPanelStackItem[] = [];
	for (const id of layout.order) {
		if (id === 'pullRequests' && pullRequestClaims.length > 0) {
			const groups = projectPullRequestGroups(openPulls.items, mergedPulls.items, selectedWorktreeId);
			const refresh = () => {
				openPulls.refresh();
				mergedPulls.refresh();
			};
			items.push({
				id,
				title: 'Pull Requests',
				height: layout.heights.pullRequests,
				collapsed: layout.collapsed.pullRequests,
				onToggleCollapsed: toggle(id),
				...(openPulls.settled ? { count: openPulls.items.length } : {}),
				actions: actions('pullRequest', pullRequestClaims, refresh, openPulls.loading),
				children: detailFor('pullRequest') ?? (
					<div className="forge-side-list" data-forge-project-tab="pullRequest">
						{status(openPulls, 'pull requests')}
						{groups.map((group) =>
							group.items.length === 0 && group.id !== 'open' ? null : (
								<section key={group.id} className="git-panel__group" data-forge-tab-group={group.id}>
									<div className="git-panel__group-header">
										<span>{group.label}</span>
										{group.items.length === 0 ? null : (
											<span className="git-panel__group-count">{group.items.length}</span>
										)}
									</div>
									{group.items.length === 0
										? openPulls.settled && openPulls.error === undefined
											? message('No open pull requests.')
											: null
										: rows(group.items)}
								</section>
							),
						)}
					</div>
				),
			});
		}
		if (id === 'issues' && issueClaims.length > 0) {
			items.push({
				id,
				title: 'Issues',
				height: layout.heights.issues,
				collapsed: layout.collapsed.issues,
				onToggleCollapsed: toggle(id),
				...(openIssues.settled ? { count: openIssues.items.length } : {}),
				actions: actions('issue', issueClaims, openIssues.refresh, openIssues.loading),
				children: detailFor('issue') ?? (
					<div className="forge-side-list" data-forge-project-tab="issue">
						{status(openIssues, 'issues')}
						{openIssues.settled && openIssues.items.length === 0 && openIssues.error === undefined
							? message('No open issues.')
							: rows(openIssues.items)}
					</div>
				),
			});
		}
	}
	return {
		items,
		onHeightsCommit: (heights) =>
			changeLayout((current) => ({
				...current,
				heights: {
					issues: heights.issues ?? current.heights.issues,
					pullRequests: heights.pullRequests ?? current.heights.pullRequests,
				},
			})),
		onReorder: (orderedIds) =>
			changeLayout((current) => {
				const shownIds = orderedIds.filter((id): id is ForgeGitPaneId => id === 'issues' || id === 'pullRequests');
				const rest = current.order.filter((id) => !shownIds.includes(id));
				return { ...current, order: [...shownIds, ...rest] };
			}),
	};
}

function ProjectForgeDetail({
	client,
	sourceId,
	reference,
	environment,
	onClose,
}: Readonly<{
	client: TerminayForgeClient | undefined;
	sourceId: string;
	reference: ForgeReference;
	environment: ForgeEnvironment;
	onClose: () => void;
}>) {
	const detail = useForgeDetail(client, sourceId, reference, 0);
	if (detail.detail === undefined)
		return (
			<div className="forge-side-list">
				{detail.error === undefined ? (
					<div className="git-panel__message">Loading…</div>
				) : (
					<div className="forge-failure" role="alert">
						{detail.error}
					</div>
				)}
				<button type="button" className="forge-link" onClick={onClose}>
					Back
				</button>
			</div>
		);
	return (
		<ForgeDetailPane
			entry={{ sourceId, item: detail.detail.summary, worktrees: detail.worktrees }}
			body={detail.detail.body}
			comments={detail.detail.comments}
			loading={detail.loading}
			environment={environment}
			now={Date.now()}
			onReload={detail.reload}
			onClose={onClose}
		/>
	);
}
