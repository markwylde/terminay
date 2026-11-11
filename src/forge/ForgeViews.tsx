/**
 * Pull request and issue views (ADR-0105): the list, the detail pane, and
 * the Start work and Review with agent panels. These draw what they are given;
 * `ForgeHome` and `ProjectForgeTab` fetch and act.
 */

import {
	CircleCheck,
	CircleDot,
	CircleSlash,
	CircleX,
	ExternalLink,
	GitBranch,
	GitBranchPlus,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Loader,
	MessageSquare,
	RefreshCw,
	Sparkles,
	X,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
	claimedProjects,
	defaultIssueBranch,
	emptyReason,
	type ForgeChecksView,
	type ForgeClaimView,
	type ForgeGroup,
	type ForgeKind,
	type ForgeListItemView,
	type ForgeProjectOption,
	type ForgeReference,
	type ForgeRepositoryFocus,
	type ForgeScopeOption,
	type ForgeSourceOutcomeView,
	type ForgeSummaryView,
	type ForgeViewPreferences,
	type ForgeWorktreeMatchView,
	forgeName,
	groupByRepository,
	ISSUE_SCOPES,
	ISSUE_STATES,
	itemKey,
	labelColor,
	linkify,
	orderedChecks,
	PULL_REQUEST_SCOPES,
	PULL_REQUEST_STATES,
	pullRequestActions,
	relativeTime,
	reviewPrompt,
	sortByUpdated,
	startWorkAvailability,
	startWorkPrompt,
	updatedAgo,
	worktreeChipLabel,
} from './forgeModel.ts';
import { startWorkPlanState } from './forgeActions.ts';
import './forge.css';

// ── What the views act through ─────────────────────────────────────────

export type ForgeTerminalChoice =
	| Readonly<{ kind: 'none' }>
	| Readonly<{ kind: 'shell' }>
	| Readonly<{ kind: 'launcher'; launcherId: string; prompt: string }>;

export type ForgeWorktreeRequest = Readonly<{
	projectId: string;
	repository: Readonly<{ origin: string; owner: string; name: string }>;
	branch: string;
	base: 'default' | 'track';
	remoteBranch?: string;
	reuseExisting?: boolean;
}>;

export type ForgeWorktreePlan = Readonly<{
	path: string | null;
	branchValid: boolean;
	branchExists: boolean;
	checkedOutAt: string | null;
	error?: Readonly<{ code: string; message: string }>;
}>;

export type ForgeActionResult =
	| Readonly<{ ok: true }>
	| Readonly<{ ok: false; message: string; code?: string }>;

export type ForgeWorktreeTarget =
	| Readonly<{ match: ForgeWorktreeMatchView }>
	| Readonly<{ create: ForgeWorktreeRequest }>;

export interface ForgeActions {
	/** Select a matched worktree's project and folder. */
	openWorktree(match: ForgeWorktreeMatchView): void;
	/** Ask the server where a worktree would go, changing nothing. */
	planWorktree(request: ForgeWorktreeRequest): Promise<ForgeWorktreePlan>;
	/**
	 * Use a matched worktree, or create one (using the existing worktree when
	 * the server says the branch is checked out there), select its folder,
	 * and open a terminal in it as chosen.
	 */
	openInWorktree(target: ForgeWorktreeTarget, terminal: ForgeTerminalChoice): Promise<ForgeActionResult>;
	openExternal(url: string): void;
	openSettings(): void;
}

export type ForgeLauncherOption = Readonly<{ id: string; label: string }>;

export type ForgeEnvironment = Readonly<{
	/** Every open project, in tab order. */
	projects: readonly ForgeProjectOption[];
	/** Each open project's claimed repositories. */
	claims: ReadonlyMap<string, readonly ForgeClaimView[]>;
	/** Launchers that accept an initial prompt. */
	launchers: readonly ForgeLauncherOption[];
	canWrite: boolean;
	displayNames: ReadonlyMap<string, string>;
	actions: ForgeActions;
}>;

// ── Small pieces ───────────────────────────────────────────────────────

export function StateMark({ kind, state }: Readonly<{ kind: ForgeKind; state: ForgeSummaryView['state'] }>) {
	const label = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }[state];
	const icon =
		kind === 'issue' ? (
			state === 'closed' ? (
				<CircleSlash size={16} aria-hidden="true" />
			) : (
				<CircleDot size={16} aria-hidden="true" />
			)
		) : state === 'merged' ? (
			<GitMerge size={16} aria-hidden="true" />
		) : state === 'draft' ? (
			<GitPullRequestDraft size={16} aria-hidden="true" />
		) : state === 'closed' ? (
			<GitPullRequestClosed size={16} aria-hidden="true" />
		) : (
			<GitPullRequest size={16} aria-hidden="true" />
		);
	return (
		<span className={`forge-state forge-state--${state}`} title={label} role="img" aria-label={label}>
			{icon}
		</span>
	);
}

export function ChecksChip({ checks }: Readonly<{ checks: ForgeChecksView | undefined }>) {
	if (checks === undefined || checks.total === 0) return null;
	const tone = checks.failed > 0 ? 'bad' : checks.pending > 0 ? 'run' : 'ok';
	const text =
		checks.failed > 0
			? `${checks.failed} failed`
			: checks.pending > 0
				? `${checks.pending} running`
				: `${checks.passed}/${checks.total}`;
	const label =
		checks.failed > 0
			? `${checks.failed} of ${checks.total} checks failed`
			: checks.pending > 0
				? `${checks.pending} of ${checks.total} checks running`
				: `${checks.passed} of ${checks.total} checks passed`;
	return (
		<span className={`forge-chip forge-chip--${tone}`} title={label} data-forge-checks={tone}>
			{tone === 'bad' ? (
				<CircleX size={11} aria-hidden="true" />
			) : tone === 'run' ? (
				<Loader size={11} aria-hidden="true" />
			) : (
				<CircleCheck size={11} aria-hidden="true" />
			)}
			{text}
		</span>
	);
}

function Labels({ labels }: Readonly<{ labels: ForgeSummaryView['labels'] }>) {
	return (
		<>
			{labels.map((label) => {
				const color = labelColor(label.color);
				return (
					<span
						key={label.name}
						className="forge-label"
						style={color === undefined ? undefined : { borderColor: `${color}66`, color }}
					>
						{label.name}
					</span>
				);
			})}
		</>
	);
}

/** Body text with https links as links; never markup. */
export function ForgeText({ text, onOpenLink }: Readonly<{ text: string; onOpenLink: (url: string) => void }>) {
	return (
		<>
			{linkify(text).map((part, index) =>
				part.url === undefined ? (
					<span key={index}>{part.text}</span>
				) : (
					<a
						key={index}
						href={part.url}
						onClick={(event) => {
							event.preventDefault();
							onOpenLink(part.url as string);
						}}
					>
						{part.text}
					</a>
				),
			)}
		</>
	);
}

function Segmented({
	label,
	options,
	value,
	onChange,
}: Readonly<{ label: string; options: readonly ForgeScopeOption[]; value: string; onChange: (value: string) => void }>) {
	return (
		<span className="forge-field">
			<span className="forge-field__label">{label}</span>
			<fieldset className="forge-seg" aria-label={label}>
				{options.map((option) => (
					<button
						key={option.id}
						type="button"
						
						aria-pressed={option.id === value}
						className={option.id === value ? 'forge-seg__on' : undefined}
						onClick={() => onChange(option.id)}
					>
						{option.label}
					</button>
				))}
			</fieldset>
		</span>
	);
}

// ── The list ───────────────────────────────────────────────────────────

export type ForgeListPaneProps = Readonly<{
	kind: ForgeKind;
	preferences: ForgeViewPreferences;
	onPreferencesChange: (next: ForgeViewPreferences) => void;
	items: readonly ForgeListItemView[];
	sources: readonly ForgeSourceOutcomeView[];
	noAccounts: boolean;
	loading: boolean;
	settled: boolean;
	error?: string;
	fetchedAt?: number;
	nextCursor?: string;
	loadingMore?: boolean;
	now: number;
	selectedKey?: string;
	onSelect: (entry: ForgeListItemView) => void;
	onRefresh: () => void;
	onLoadMore: () => void;
	onOpenSettings: () => void;
	/** Shown under All when some source reaches only its owners. */
	ownersReachNote?: string;
	repositoryFilter?: ForgeRepositoryFocus;
	onClearRepositoryFilter?: () => void;
	projectTitle: (projectId: string) => string | undefined;
	projectOrder: readonly string[];
	displayNames: ReadonlyMap<string, string>;
}>;

export function ForgeListPane(props: ForgeListPaneProps) {
	const { kind, preferences, onPreferencesChange, items, now } = props;
	const scopes = kind === 'pullRequest' ? PULL_REQUEST_SCOPES : ISSUE_SCOPES;
	const states = kind === 'pullRequest' ? PULL_REQUEST_STATES : ISSUE_STATES;
	const noun = kind === 'pullRequest' ? 'pull requests' : 'issues';
	const reason = props.settled ? emptyReason(items.length, props.noAccounts ? 0 : 1, props.sources) : undefined;
	const groups: ForgeGroup[] =
		preferences.group === 'repo'
			? groupByRepository(items)
			: [{ key: 'all', sourceId: '', origin: '', owner: '', name: '', items: sortByUpdated(items) }];
	const updated = updatedAgo(props.fetchedAt, now);
	const failedNote =
		reason?.kind === 'failed' ? (
			<div className="forge-failure" role="alert" data-forge-failure="true">
				<span>
					{reason.sources
						.map((source) => `${forgeName(source.sourceId, props.displayNames)}${source.origin === undefined ? '' : ` (${source.origin})`} could not be reached${source.error === undefined ? '' : `: ${source.error}`}`)
						.join(' · ')}
				</span>
				<button type="button" className="forge-btn forge-btn--small" onClick={props.onRefresh}>
					Retry
				</button>
			</div>
		) : null;
	return (
		<div className="forge-list" data-forge-list={kind}>
			<div className="forge-toolbar">
				<fieldset className="forge-chips" aria-label="Scope">
					{scopes.map((scope) => (
						<button
							key={scope.id}
							type="button"
							
							aria-pressed={scope.id === preferences.scope}
							className={`forge-scope${scope.id === preferences.scope ? ' forge-scope--on' : ''}`}
							data-forge-scope={scope.id}
							onClick={() => onPreferencesChange({ ...preferences, scope: scope.id })}
						>
							{scope.label}
						</button>
					))}
				</fieldset>
				<Segmented
					label="State"
					options={states}
					value={preferences.state}
					onChange={(state) => onPreferencesChange({ ...preferences, state })}
				/>
				<Segmented
					label="Group"
					options={[
						{ id: 'repo', label: 'Repo' },
						{ id: 'none', label: 'None' },
					]}
					value={preferences.group}
					onChange={(group) => onPreferencesChange({ ...preferences, group: group === 'none' ? 'none' : 'repo' })}
				/>
				<span className="forge-toolbar__end">
					{updated === undefined ? null : <span className="forge-faint" data-forge-updated="true">{updated}</span>}
					<button
						type="button"
						className="forge-icon-btn"
						aria-label="Refresh"
						title="Refresh"
						disabled={props.loading}
						onClick={props.onRefresh}
					>
						<RefreshCw size={14} aria-hidden="true" className={props.loading ? 'forge-spin' : undefined} />
					</button>
				</span>
			</div>
			{props.repositoryFilter === undefined ? null : (
				<div className="forge-filter" data-forge-repository-filter="true">
					<span>
						Showing <b>{props.repositoryFilter.owner}/{props.repositoryFilter.name}</b>
					</span>
					<button
						type="button"
						className="forge-icon-btn"
						aria-label="Show every repository"
						title="Show every repository"
						onClick={props.onClearRepositoryFilter}
					>
						<X size={13} aria-hidden="true" />
					</button>
				</div>
			)}
			{preferences.scope === 'all' && props.ownersReachNote !== undefined ? (
				<p className="forge-note" data-forge-owners-note="true">
					{props.ownersReachNote}
				</p>
			) : null}
			<div className="forge-list__body" aria-busy={props.loading}>
				{items.length > 0 ? failedNote : null}
				{props.error !== undefined && items.length === 0 ? (
					<div className="forge-empty" role="alert">
						<p>Could not load {noun}: {props.error}</p>
						<button type="button" className="forge-btn" onClick={props.onRefresh}>
							Retry
						</button>
					</div>
				) : reason?.kind === 'noAccounts' ? (
					<div className="forge-empty" data-forge-empty="noAccounts">
						<p>No forge account is set up.</p>
						<p className="forge-faint">
							Sign in to Gitea or GitHub, or add an account in Settings › Extensions.
						</p>
						<button type="button" className="forge-btn" onClick={props.onOpenSettings}>
							Open Settings › Extensions
						</button>
					</div>
				) : reason?.kind === 'failed' && items.length === 0 ? (
					<div className="forge-empty" data-forge-empty="failed">
						{failedNote}
					</div>
				) : reason?.kind === 'noMatches' ? (
					<div className="forge-empty" data-forge-empty="noMatches">
						<p>No {noun} match this scope.</p>
					</div>
				) : !props.settled && props.loading ? (
					<div className="forge-empty forge-faint">Loading {noun}…</div>
				) : null}
				{groups.map((group) =>
					group.items.length === 0 ? null : (
						<section key={group.key} className="forge-group" aria-label={group.key === 'all' ? noun : `${group.owner}/${group.name}`}>
							{group.key === 'all' ? null : (
								<div className="forge-group__head" data-forge-group={`${group.owner}/${group.name}`}>
									<span className="forge-faint">{forgeName(group.sourceId, props.displayNames)}</span>
									<b>
										{group.owner}/{group.name}
									</b>
									<span className="forge-count">{group.items.length}</span>
								</div>
							)}
							<ul className="forge-rows">
								{group.items.map((entry) => (
									<ForgeRow
										key={itemKey(entry.item.reference)}
										entry={entry}
										showRepository={group.key === 'all'}
										selected={props.selectedKey === itemKey(entry.item.reference)}
										now={now}
										onSelect={props.onSelect}
										projectTitle={props.projectTitle}
										projectOrder={props.projectOrder}
									/>
								))}
							</ul>
						</section>
					),
				)}
				{props.nextCursor === undefined ? null : (
					<div className="forge-more">
						<button type="button" className="forge-btn" disabled={props.loadingMore} onClick={props.onLoadMore}>
							{props.loadingMore ? 'Loading…' : 'Load more'}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

export function ForgeRow({
	entry,
	showRepository,
	selected,
	now,
	onSelect,
	projectTitle,
	projectOrder,
	compact = false,
}: Readonly<{
	entry: ForgeListItemView;
	showRepository: boolean;
	selected: boolean;
	now: number;
	onSelect: (entry: ForgeListItemView) => void;
	projectTitle: (projectId: string) => string | undefined;
	projectOrder: readonly string[];
	compact?: boolean;
}>) {
	const { item } = entry;
	const chip = worktreeChipLabel(entry.worktrees, projectTitle, projectOrder);
	return (
		<li>
			<button
				type="button"
				className={`forge-row${selected ? ' forge-row--selected' : ''}${compact ? ' forge-row--compact' : ''}`}
				aria-current={selected ? 'true' : undefined}
				data-forge-row={item.reference.number}
				onClick={() => onSelect(entry)}
			>
				<StateMark kind={item.reference.kind} state={item.state} />
				<span className="forge-row__main">
					<span className="forge-row__title">{item.title}</span>
					<span className="forge-row__meta">
						<span className="forge-mono">#{item.reference.number}</span>
						{showRepository ? (
							<span>
								{item.reference.owner}/{item.reference.name}
							</span>
						) : null}
						{compact && item.pullRequest !== undefined ? (
							<span className="forge-mono forge-row__branch">{item.pullRequest.headBranch}</span>
						) : (
							<span>{item.author}</span>
						)}
						{chip === undefined ? null : (
							<span className="forge-chip forge-chip--worktree" data-forge-worktree-chip="true">
								<GitBranch size={11} aria-hidden="true" />
								{chip}
							</span>
						)}
						{compact && item.pullRequest !== undefined ? null : <Labels labels={item.labels} />}
					</span>
				</span>
				<span className="forge-row__end">
					<ChecksChip checks={item.pullRequest?.checks} />
					{compact ? null : <span>{relativeTime(item.updatedAt, now)}</span>}
				</span>
			</button>
		</li>
	);
}

// ── The detail pane ────────────────────────────────────────────────────

export type ForgeDetailPaneProps = Readonly<{
	entry: ForgeListItemView;
	body?: string;
	comments?: ReadonlyArray<Readonly<{ author: string; createdAt: string; body: string }>>;
	loading: boolean;
	error?: string;
	environment: ForgeEnvironment;
	now: number;
	onReload?: () => void;
	onClose?: () => void;
}>;

export function ForgeDetailPane({ entry, body, comments, loading, error, environment, now, onReload, onClose }: ForgeDetailPaneProps) {
	const { item } = entry;
	const kind = item.reference.kind;
	const forge = forgeName(entry.sourceId, environment.displayNames);
	const projects = claimedProjects(item.reference, environment.projects, environment.claims);
	const projectTitle = (projectId: string) =>
		environment.projects.find((project) => project.projectId === projectId)?.title;
	const [panel, setPanel] = useState<'none' | 'review' | 'startWork'>('none');
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string>();
	const [projectId, setProjectId] = useState<string | undefined>(projects[0]?.projectId);
	const [matchIndex, setMatchIndex] = useState(0);
	const referenceKey = itemKey(item.reference);
	useEffect(() => {
		setPanel('none');
		setActionError(undefined);
		setMatchIndex(0);
	}, [referenceKey]);
	useEffect(() => {
		if (projectId === undefined || !projects.some((project) => project.projectId === projectId))
			setProjectId(projects[0]?.projectId);
	}, [projectId, projects]);

	const run = async (work: () => Promise<{ ok: boolean; message?: string } | undefined>) => {
		setBusy(true);
		setActionError(undefined);
		try {
			const result = await work();
			if (result !== undefined && !result.ok) setActionError(result.message ?? 'That did not work.');
		} catch (cause) {
			setActionError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};
	const repository = { origin: item.reference.origin, owner: item.reference.owner, name: item.reference.name };
	const match = entry.worktrees[matchIndex] ?? entry.worktrees[0];
	const chooser =
		projects.length > 1 ? (
			<label className="forge-field">
				<span className="forge-field__label">Project</span>
				<select className="forge-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
					{projects.map((project) => (
						<option key={project.projectId} value={project.projectId}>
							{project.title}
						</option>
					))}
				</select>
			</label>
		) : null;
	const matchChooser =
		entry.worktrees.length > 1 ? (
			<label className="forge-field">
				<span className="forge-field__label">Worktree</span>
				<select
					className="forge-select"
					value={matchIndex}
					onChange={(event) => setMatchIndex(Number(event.target.value))}
				>
					{entry.worktrees.map((candidate, index) => (
						<option key={`${candidate.projectId}:${candidate.worktreeId}`} value={index}>
							{projectTitle(candidate.projectId) ?? candidate.projectId} · {candidate.branch}
						</option>
					))}
				</select>
			</label>
		) : null;

	let actions: ReactNode;
	if (kind === 'pullRequest') {
		const state = pullRequestActions(entry, projects, environment.canWrite, environment.launchers.length > 0);
		actions = (
			<>
				{matchChooser}
				{entry.worktrees.length === 0 ? chooser : null}
				<div className="forge-actions">
					{entry.worktrees.length > 0 ? (
						<ActionButton
							primary
							icon={<GitBranch size={14} aria-hidden="true" />}
							label="Open worktree"
							state={state.openWorktree}
							disabled={busy}
							onClick={() => match !== undefined && environment.actions.openWorktree(match)}
						/>
					) : (
						<ActionButton
							primary
							icon={<GitBranchPlus size={14} aria-hidden="true" />}
							label="Check out in new worktree"
							state={state.checkOut}
							disabled={busy || projectId === undefined}
							onClick={() =>
								void run(() =>
									environment.actions.openInWorktree(
										{
											create: {
												projectId: projectId as string,
												repository,
												branch: item.pullRequest?.headBranch ?? '',
												base: 'track',
												remoteBranch: item.pullRequest?.headBranch ?? '',
												reuseExisting: true,
											},
										},
										{ kind: 'none' },
									),
								)
							}
						/>
					)}
					<ActionButton
						icon={<Sparkles size={14} aria-hidden="true" />}
						label="Review with agent"
						state={state.review}
						disabled={busy}
						onClick={() => setPanel(panel === 'review' ? 'none' : 'review')}
					/>
					<ActionButton
						icon={<ExternalLink size={14} aria-hidden="true" />}
						label={`Open on ${forge}`}
						state={{ enabled: true }}
						onClick={() => environment.actions.openExternal(item.url)}
					/>
				</div>
				{panel === 'review' ? (
					<ReviewPanel
						item={item}
						launchers={environment.launchers}
						busy={busy}
						onCancel={() => setPanel('none')}
						onConfirm={(launcherId, prompt) =>
							void run(async () => {
								const result = await environment.actions.openInWorktree(
									match !== undefined
										? { match }
										: {
												create: {
													projectId: projectId as string,
													repository,
													branch: item.pullRequest?.headBranch ?? '',
													base: 'track',
													remoteBranch: item.pullRequest?.headBranch ?? '',
													reuseExisting: true,
												},
											},
									{ kind: 'launcher', launcherId, prompt },
								);
								if (result.ok) setPanel('none');
								return result;
							})
						}
					/>
				) : null}
			</>
		);
	} else {
		const availability = startWorkAvailability(projects, environment.canWrite);
		actions = (
			<>
				<div className="forge-actions">
					<ActionButton
						primary
						icon={<GitBranchPlus size={14} aria-hidden="true" />}
						label="Start work"
						state={availability}
						disabled={busy}
						onClick={() => setPanel(panel === 'startWork' ? 'none' : 'startWork')}
					/>
					<ActionButton
						icon={<ExternalLink size={14} aria-hidden="true" />}
						label={`Open on ${forge}`}
						state={{ enabled: true }}
						onClick={() => environment.actions.openExternal(item.url)}
					/>
				</div>
				{panel === 'startWork' && availability.enabled ? (
					<StartWorkPanel
						item={item}
						body={body ?? ''}
						projects={projects}
						launchers={environment.launchers}
						actions={environment.actions}
						onDone={() => setPanel('none')}
						onCancel={() => setPanel('none')}
					/>
				) : null}
			</>
		);
	}

	const facts = item.pullRequest;
	return (
		<aside className="forge-detail" aria-label={`${kind === 'pullRequest' ? 'Pull request' : 'Issue'} #${item.reference.number}`} data-forge-detail={item.reference.number}>
			<div className="forge-detail__head">
				<StateMark kind={kind} state={item.state} />
				<span className="forge-muted">
					{item.reference.owner}/{item.reference.name}
				</span>
				<span className="forge-mono forge-faint">#{item.reference.number}</span>
				<span className="forge-toolbar__end">
					{onReload === undefined ? null : (
						<button type="button" className="forge-icon-btn" aria-label="Reload" title="Reload" onClick={onReload}>
							<RefreshCw size={13} aria-hidden="true" className={loading ? 'forge-spin' : undefined} />
						</button>
					)}
					{onClose === undefined ? null : (
						<button type="button" className="forge-icon-btn" aria-label="Close" title="Close" onClick={onClose}>
							<X size={13} aria-hidden="true" />
						</button>
					)}
				</span>
			</div>
			<h3 className="forge-detail__title">{item.title}</h3>
			<dl className="forge-kv">
				{facts === undefined ? null : (
					<>
						<dt>Branch</dt>
						<dd className="forge-mono">
							{facts.headOwner.toLowerCase() === item.reference.owner.toLowerCase() ? '' : `${facts.headOwner}:`}
							{facts.headBranch} → {facts.baseBranch}
						</dd>
					</>
				)}
				<dt>Author</dt>
				<dd>{item.author}</dd>
				<dt>Updated</dt>
				<dd>{relativeTime(item.updatedAt, now)}</dd>
				{item.labels.length === 0 ? null : (
					<>
						<dt>Labels</dt>
						<dd className="forge-wrap">
							<Labels labels={item.labels} />
						</dd>
					</>
				)}
				{kind === 'pullRequest' ? (
					<>
						<dt>Worktree</dt>
						<dd>
							{entry.worktrees.length === 0 ? (
								<span className="forge-faint">Not checked out</span>
							) : (
								<span className="forge-chip forge-chip--worktree">
									<GitBranch size={11} aria-hidden="true" />
									{worktreeChipLabel(entry.worktrees, projectTitle, environment.projects.map((project) => project.projectId))}
								</span>
							)}
						</dd>
					</>
				) : null}
			</dl>
			{facts?.checks === undefined || facts.checks.total === 0 ? null : (
				<div className="forge-checks" data-forge-checks-list="true">
					<span className="forge-section-label">Checks</span>
					{orderedChecks(facts.checks).map((check) => (
						<div key={check.name} className={`forge-check forge-check--${check.state}`} data-forge-check={check.state}>
							{check.state === 'failed' ? (
								<CircleX size={14} aria-hidden="true" />
							) : check.state === 'pending' ? (
								<Loader size={14} aria-hidden="true" />
							) : check.state === 'skipped' ? (
								<CircleSlash size={14} aria-hidden="true" />
							) : (
								<CircleCheck size={14} aria-hidden="true" />
							)}
							{check.url === undefined ? (
								<span>{check.name}</span>
							) : (
								<a
									href={check.url}
									onClick={(event) => {
										event.preventDefault();
										environment.actions.openExternal(check.url as string);
									}}
								>
									{check.name}
								</a>
							)}
						</div>
					))}
					{(facts.checks.items?.length ?? 0) === 0 ? (
						<span className="forge-faint">
							{facts.checks.passed} passed · {facts.checks.failed} failed · {facts.checks.pending} running
						</span>
					) : null}
				</div>
			)}
			{actions}
			{actionError === undefined ? null : (
				<div className="forge-failure" role="alert">
					{actionError}
				</div>
			)}
			{error !== undefined ? (
				<div className="forge-failure" role="alert">
					Could not load the description: {error}
				</div>
			) : body === undefined ? (
				loading ? <p className="forge-faint">Loading…</p> : null
			) : body.trim().length === 0 ? (
				<p className="forge-faint">No description.</p>
			) : (
				<div className="forge-body" data-forge-body="true">
					<ForgeText text={body} onOpenLink={environment.actions.openExternal} />
				</div>
			)}
			{comments === undefined || comments.length === 0 ? null : (
				<div className="forge-comments">
					<span className="forge-section-label">
						<MessageSquare size={12} aria-hidden="true" /> Recent comments
					</span>
					{comments.map((comment, index) => (
						<div key={index} className="forge-comment">
							<div className="forge-faint">
								<b>{comment.author}</b> · {relativeTime(comment.createdAt, now)}
							</div>
							<div className="forge-body">
								<ForgeText text={comment.body} onOpenLink={environment.actions.openExternal} />
							</div>
						</div>
					))}
				</div>
			)}
		</aside>
	);
}

function ActionButton({
	icon,
	label,
	state,
	primary = false,
	disabled = false,
	onClick,
}: Readonly<{
	icon: ReactNode;
	label: string;
	state: { enabled: boolean; reason?: string };
	primary?: boolean;
	disabled?: boolean;
	onClick: () => void;
}>) {
	const reasonId = useId();
	return (
		<span className="forge-action">
			<button
				type="button"
				className={`forge-btn${primary ? ' forge-btn--primary' : ''}`}
				disabled={!state.enabled || disabled}
				aria-describedby={state.reason === undefined ? undefined : reasonId}
				title={state.reason}
				data-forge-action={label}
				onClick={onClick}
			>
				{icon}
				{label}
			</button>
			{state.enabled || state.reason === undefined ? null : (
				<span id={reasonId} className="forge-reason" data-forge-reason={label}>
					{state.reason}
				</span>
			)}
		</span>
	);
}

// ── Review with agent ──────────────────────────────────────────────────

export function ReviewPanel({
	item,
	launchers,
	busy,
	onConfirm,
	onCancel,
}: Readonly<{
	item: ForgeSummaryView;
	launchers: readonly ForgeLauncherOption[];
	busy: boolean;
	onConfirm: (launcherId: string, prompt: string) => void;
	onCancel: () => void;
}>) {
	const [launcherId, setLauncherId] = useState(launchers[0]?.id ?? '');
	const [prompt, setPrompt] = useState(() => reviewPrompt(item));
	return (
		<form
			className="forge-panel"
			data-forge-panel="review"
			onSubmit={(event) => {
				event.preventDefault();
				onConfirm(launcherId, prompt);
			}}
		>
			<span className="forge-section-label">Review with agent</span>
			<label className="forge-field forge-field--stack">
				<span className="forge-field__label">Agent</span>
				<select className="forge-select" value={launcherId} onChange={(event) => setLauncherId(event.target.value)}>
					{launchers.map((launcher) => (
						<option key={launcher.id} value={launcher.id}>
							{launcher.label}
						</option>
					))}
				</select>
			</label>
			<label className="forge-field forge-field--stack">
				<span className="forge-field__label">Prompt</span>
				<textarea className="forge-textarea" rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
			</label>
			<div className="forge-actions">
				<button type="submit" className="forge-btn forge-btn--primary" disabled={busy || launcherId === '' || prompt.trim().length === 0}>
					{busy ? 'Starting…' : 'Start review'}
				</button>
				<button type="button" className="forge-btn" onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}

// ── Start work ─────────────────────────────────────────────────────────

const SHELL_ONLY = '';

export function StartWorkPanel({
	item,
	body,
	projects,
	launchers,
	actions,
	onDone,
	onCancel,
}: Readonly<{
	item: ForgeSummaryView;
	body: string;
	projects: readonly ForgeProjectOption[];
	launchers: readonly ForgeLauncherOption[];
	actions: Pick<ForgeActions, 'planWorktree' | 'openInWorktree'>;
	onDone: () => void;
	onCancel: () => void;
}>) {
	const [projectId, setProjectId] = useState(projects[0]?.projectId ?? '');
	const [branch, setBranch] = useState(() => defaultIssueBranch(item.reference.number, item.title));
	const [launcherId, setLauncherId] = useState(launchers[0]?.id ?? SHELL_ONLY);
	const [prompt, setPrompt] = useState(() => startWorkPrompt(item, body));
	const [plan, setPlan] = useState<ForgeWorktreePlan>();
	const [planFor, setPlanFor] = useState('');
	const [useExisting, setUseExisting] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const repository = { origin: item.reference.origin, owner: item.reference.owner, name: item.reference.name };
	const request = (reuseExisting: boolean): ForgeWorktreeRequest => ({
		projectId,
		repository,
		branch: branch.trim(),
		base: 'default',
		...(reuseExisting ? { reuseExisting: true } : {}),
	});
	const planKey = `${projectId}\u0000${branch.trim()}`;
	// Ask where the worktree goes when the panel opens and when the branch or
	// project settles; the answer for an older name is dropped.
	useEffect(() => {
		if (projectId === '' || branch.trim().length === 0) return;
		let current = true;
		const key = planKey;
		void actions
			.planWorktree(request(false))
			.then((next) => {
				if (!current) return;
				setPlan(next);
				setPlanFor(key);
				setUseExisting(false);
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [actions, planKey]);
	const shownPlan = planFor === planKey ? plan : undefined;
	const planState = startWorkPlanState(shownPlan, useExisting);
	const branchInvalid = shownPlan !== undefined && !shownPlan.branchValid;

	const confirm = async () => {
		setBusy(true);
		setError(undefined);
		try {
			const terminal: ForgeTerminalChoice =
				launcherId === SHELL_ONLY ? { kind: 'shell' } : { kind: 'launcher', launcherId, prompt };
			const result = await actions.openInWorktree({ create: request(planState.reuseExisting) }, terminal);
			if (result.ok) onDone();
			else {
				setError(result.message);
				if (result.code === 'branchExists') setPlan((previous) => (previous === undefined ? previous : { ...previous, branchExists: true }));
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className="forge-panel"
			data-forge-panel="startWork"
			onSubmit={(event) => {
				event.preventDefault();
				void confirm();
			}}
		>
			<span className="forge-section-label">Start work</span>
			{projects.length > 1 ? (
				<label className="forge-field forge-field--stack">
					<span className="forge-field__label">Project</span>
					<select className="forge-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
						{projects.map((project) => (
							<option key={project.projectId} value={project.projectId}>
								{project.title}
							</option>
						))}
					</select>
				</label>
			) : null}
			<label className="forge-field forge-field--stack">
				<span className="forge-field__label">Branch</span>
				<input
					className="forge-input forge-mono"
					value={branch}
					spellCheck={false}
					aria-invalid={branchInvalid}
					onChange={(event) => setBranch(event.target.value)}
					data-forge-branch="true"
				/>
			</label>
			<div className="forge-faint forge-path" data-forge-planned-path="true">
				{planState.note}
			</div>
			{planState.offerExisting ? (
				<div className="forge-offer" data-forge-existing-branch="true">
					<span>
						Branch <b className="forge-mono">{branch.trim()}</b> already exists.
					</span>
					<label className="forge-check-label">
						<input type="checkbox" checked={useExisting} onChange={(event) => setUseExisting(event.target.checked)} />
						Use it
					</label>
				</div>
			) : null}
			<label className="forge-field forge-field--stack">
				<span className="forge-field__label">Open with</span>
				<select className="forge-select" value={launcherId} onChange={(event) => setLauncherId(event.target.value)} data-forge-launcher="true">
					{launchers.map((launcher) => (
						<option key={launcher.id} value={launcher.id}>
							{launcher.label}
						</option>
					))}
					<option value={SHELL_ONLY}>Shell only</option>
				</select>
			</label>
			{launcherId === SHELL_ONLY ? null : (
				<label className="forge-field forge-field--stack">
					<span className="forge-field__label">Prompt</span>
					<textarea className="forge-textarea" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
				</label>
			)}
			{error === undefined ? null : (
				<div className="forge-failure" role="alert" data-forge-start-error="true">
					{error}
				</div>
			)}
			<div className="forge-actions">
				<button
					type="submit"
					className="forge-btn forge-btn--primary"
					disabled={busy || projectId === '' || branch.trim().length === 0 || planState.blocked || (launcherId !== SHELL_ONLY && prompt.trim().length === 0)}
				>
					{busy ? 'Starting…' : error === undefined ? 'Start work' : 'Retry'}
				</button>
				<button type="button" className="forge-btn" onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}

/** Display names for sources, from `forge.sources`. */
export function displayNamesOf(
	sources: ReadonlyArray<Readonly<{ sourceId: string; displayName: string }>>,
): Map<string, string> {
	return new Map(sources.map((source) => [source.sourceId, source.displayName]));
}

export function referenceOf(entry: ForgeListItemView): ForgeReference {
	return entry.item.reference;
}
