/**
 * Pure presentation rules for Home's Pull Requests and Issues sections and a
 * project's forge tabs (ADR-0106). Nothing here fetches; the views ask the
 * server through the forge client and render what these functions decide.
 */

export type ForgeKind = 'pullRequest' | 'issue';
export type ForgeItemState = 'open' | 'draft' | 'merged' | 'closed';

export type ForgeReference = Readonly<{
	kind: ForgeKind;
	origin: string;
	owner: string;
	name: string;
	number: number;
}>;

export type ForgeChecksView = Readonly<{
	passed: number;
	failed: number;
	pending: number;
	skipped: number;
	total: number;
	items?: ReadonlyArray<Readonly<{ name: string; state: 'passed' | 'failed' | 'pending' | 'skipped'; url?: string }>>;
}>;

export type ForgeSummaryView = Readonly<{
	reference: ForgeReference;
	title: string;
	url: string;
	state: ForgeItemState;
	author: string;
	labels: ReadonlyArray<Readonly<{ name: string; color: string }>>;
	comments: number;
	createdAt: string;
	updatedAt: string;
	pullRequest?: Readonly<{
		headBranch: string;
		baseBranch: string;
		headOwner: string;
		headName: string;
		headCommit?: string;
		checks?: ForgeChecksView;
	}>;
}>;

export type ForgeWorktreeMatchView = Readonly<{
	projectId: string;
	worktreeId: string;
	branch: string;
	path?: string;
	repositoryId?: string;
}>;

export type ForgeListItemView = Readonly<{
	sourceId: string;
	item: ForgeSummaryView;
	worktrees: readonly ForgeWorktreeMatchView[];
}>;

export type ForgeScopeOption = Readonly<{ id: string; label: string }>;

export const PULL_REQUEST_SCOPES: readonly ForgeScopeOption[] = [
	{ id: 'reviewRequested', label: 'Needs my review' },
	{ id: 'authored', label: 'Mine' },
	{ id: 'involved', label: 'Involved' },
	{ id: 'all', label: 'All' },
];

export const ISSUE_SCOPES: readonly ForgeScopeOption[] = [
	{ id: 'assigned', label: 'Assigned to me' },
	{ id: 'authored', label: 'Created by me' },
	{ id: 'mentioned', label: 'Mentioned' },
	{ id: 'all', label: 'All' },
];

export const PULL_REQUEST_STATES: readonly ForgeScopeOption[] = [
	{ id: 'open', label: 'Open' },
	{ id: 'merged', label: 'Merged' },
	{ id: 'all', label: 'All' },
];

export const ISSUE_STATES: readonly ForgeScopeOption[] = [
	{ id: 'open', label: 'Open' },
	{ id: 'closed', label: 'Closed' },
	{ id: 'all', label: 'All' },
];

export type ForgeGrouping = 'repo' | 'none';

export type ForgeViewPreferences = Readonly<{
	scope: string;
	state: string;
	group: ForgeGrouping;
}>;

export function defaultPreferences(kind: ForgeKind): ForgeViewPreferences {
	return {
		scope: kind === 'pullRequest' ? 'reviewRequested' : 'assigned',
		state: 'open',
		group: 'repo',
	};
}

/** Read a device's remembered view; anything unreadable is the default. */
export function readPreferences(kind: ForgeKind, raw: string | null | undefined): ForgeViewPreferences {
	const fallback = defaultPreferences(kind);
	if (raw === null || raw === undefined) return fallback;
	try {
		const value = JSON.parse(raw) as Partial<ForgeViewPreferences>;
		const scopes = kind === 'pullRequest' ? PULL_REQUEST_SCOPES : ISSUE_SCOPES;
		const states = kind === 'pullRequest' ? PULL_REQUEST_STATES : ISSUE_STATES;
		return {
			scope: scopes.some((option) => option.id === value.scope) ? (value.scope as string) : fallback.scope,
			state: states.some((option) => option.id === value.state) ? (value.state as string) : fallback.state,
			group: value.group === 'none' ? 'none' : 'repo',
		};
	} catch {
		return fallback;
	}
}

export const preferencesKey = (kind: ForgeKind) => `terminay.forge.${kind}.view.v1`;

export function repositoryKey(reference: Pick<ForgeReference, 'origin' | 'owner' | 'name'>): string {
	return `${reference.origin}\u0000${reference.owner.toLowerCase()}/${reference.name.toLowerCase()}`;
}

export function itemKey(reference: ForgeReference): string {
	return `${reference.kind}\u0000${repositoryKey(reference)}#${reference.number}`;
}

export type ForgeGroup = Readonly<{
	key: string;
	sourceId: string;
	origin: string;
	owner: string;
	name: string;
	items: readonly ForgeListItemView[];
}>;

/** Items grouped by repository, groups in the order their newest item comes. */
export function groupByRepository(items: readonly ForgeListItemView[]): ForgeGroup[] {
	const groups = new Map<string, { key: string; sourceId: string; origin: string; owner: string; name: string; items: ForgeListItemView[] }>();
	for (const entry of sortByUpdated(items)) {
		const key = repositoryKey(entry.item.reference);
		let group = groups.get(key);
		if (group === undefined) {
			group = {
				key,
				sourceId: entry.sourceId,
				origin: entry.item.reference.origin,
				owner: entry.item.reference.owner,
				name: entry.item.reference.name,
				items: [],
			};
			groups.set(key, group);
		}
		group.items.push(entry);
	}
	return [...groups.values()];
}

export function sortByUpdated<T extends { item: { updatedAt: string } }>(items: readonly T[]): T[] {
	return [...items].sort((left, right) => right.item.updatedAt.localeCompare(left.item.updatedAt));
}

/** "Forum" for one matching worktree; "Forum +2" for three. */
export function worktreeChipLabel(
	matches: readonly ForgeWorktreeMatchView[],
	projectTitle: (projectId: string) => string | undefined,
	projectOrder: readonly string[],
): string | undefined {
	if (matches.length === 0) return undefined;
	const ordered = [...matches].sort(
		(left, right) => orderOf(projectOrder, left.projectId) - orderOf(projectOrder, right.projectId),
	);
	const first = ordered[0] as ForgeWorktreeMatchView;
	const title = projectTitle(first.projectId) ?? first.branch;
	return ordered.length === 1 ? title : `${title} +${ordered.length - 1}`;
}

function orderOf(order: readonly string[], projectId: string): number {
	const index = order.indexOf(projectId);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** `issue-<number>-<slug>`, at most 64 characters, never ending in `-`. */
export function defaultIssueBranch(number: number, title: string): string {
	const slug = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	const prefix = `issue-${number}`;
	if (slug.length === 0) return prefix;
	return `${prefix}-${slug}`.slice(0, 64).replace(/-+$/u, '');
}

const PROMPT_BODY_CHARACTERS = 1_200;

/** The editable prompt Start work suggests for a launcher. */
export function startWorkPrompt(item: Pick<ForgeSummaryView, 'reference' | 'title' | 'url'>, body: string): string {
	const excerpt = body.trim().replace(/\s+/gu, ' ').slice(0, PROMPT_BODY_CHARACTERS);
	const quoted = excerpt.length === 0 ? '' : ` The issue says: "${excerpt}${body.trim().length > PROMPT_BODY_CHARACTERS ? '…' : ''}"`;
	return `Work on issue #${item.reference.number}, "${item.title}" (${item.url}).${quoted} Start by reading the issue and the relevant code, then propose and make the change.`;
}

/** The editable prompt Review with agent suggests. */
export function reviewPrompt(item: Pick<ForgeSummaryView, 'reference' | 'title' | 'url'>): string {
	return `Review pull request #${item.reference.number}, "${item.title}" (${item.url}). This worktree has its branch checked out. Read the change against its base branch and report problems, risks, and suggested fixes.`;
}

export type ForgeProjectOption = Readonly<{ projectId: string; title: string }>;

export type PullRequestActionState = Readonly<{
	openWorktree: { enabled: boolean; reason?: string };
	checkOut: { enabled: boolean; reason?: string };
	review: { enabled: boolean; reason?: string };
}>;

/**
 * Which pull request actions apply. `projects` are the open projects whose
 * remotes are claimed for the item's repository.
 */
export function pullRequestActions(
	entry: ForgeListItemView,
	projects: readonly ForgeProjectOption[],
	canWrite: boolean,
	hasPromptLauncher: boolean,
): PullRequestActionState {
	const facts = entry.item.pullRequest;
	const fromFork =
		facts !== undefined &&
		(facts.headOwner.toLowerCase() !== entry.item.reference.owner.toLowerCase() ||
			facts.headName.toLowerCase() !== entry.item.reference.name.toLowerCase());
	const matched = entry.worktrees.length > 0;
	const notOpen = 'Open this repository as a project to check out its pull requests.';
	const fork = 'Pull requests from forks cannot be checked out.';
	const readOnly = 'This connection cannot change worktrees.';
	const closed = entry.item.state === 'merged' || entry.item.state === 'closed';
	const checkOut = !canWrite
		? { enabled: false, reason: readOnly }
		: fromFork
			? { enabled: false, reason: fork }
			: projects.length === 0
				? { enabled: false, reason: notOpen }
				: matched
					? { enabled: false, reason: 'Its branch is already checked out.' }
					: closed
						? { enabled: false, reason: 'This pull request is no longer open.' }
						: { enabled: true };
	const review = !canWrite
		? { enabled: false, reason: readOnly }
		: !hasPromptLauncher
			? { enabled: false, reason: 'No agent that takes a prompt is installed.' }
			: matched
				? { enabled: true }
				: checkOut.enabled
					? { enabled: true }
					: { enabled: false, reason: checkOut.reason ?? notOpen };
	return {
		openWorktree: matched ? { enabled: true } : { enabled: false, reason: 'Its branch is not checked out in an open project.' },
		checkOut,
		review,
	};
}

export function startWorkAvailability(
	projects: readonly ForgeProjectOption[],
	canWrite: boolean,
): { enabled: boolean; reason?: string } {
	if (!canWrite) return { enabled: false, reason: 'This connection cannot change worktrees.' };
	if (projects.length === 0)
		return { enabled: false, reason: 'Open this repository as a project to start work on its issues.' };
	return { enabled: true };
}

/** Failed and pending checks first, as a person opens the list to find them. */
export function orderedChecks(checks: ForgeChecksView | undefined): NonNullable<ForgeChecksView['items']> {
	const order = { failed: 0, pending: 1, passed: 2, skipped: 3 } as const;
	return [...(checks?.items ?? [])].sort((left, right) => order[left.state] - order[right.state]);
}

/** "now", "5m", "3h", "2d", "4w", or a date. */
export function relativeTime(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return '';
	const seconds = Math.max(0, Math.round((now - at) / 1_000));
	if (seconds < 60) return 'now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 35) return `${Math.floor(days / 7)}w`;
	return new Date(at).toISOString().slice(0, 10);
}

/** "Updated just now" / "Updated 3 min ago". */
export function updatedAgo(fetchedAt: number | undefined, now: number): string | undefined {
	if (fetchedAt === undefined) return undefined;
	const minutes = Math.floor((now - fetchedAt) / 60_000);
	return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`;
}

/** The forge's name for an origin, from the source that answered for it. */
export function forgeName(sourceId: string, displayNames: ReadonlyMap<string, string>): string {
	return displayNames.get(sourceId) ?? sourceId.split('/').at(-1) ?? sourceId;
}

export type ForgeSourceOutcomeView = Readonly<{
	sourceId: string;
	origin?: string;
	state: 'ok' | 'failed' | 'skipped';
	error?: string;
}>;

export type EmptyReason =
	| Readonly<{ kind: 'noAccounts' }>
	| Readonly<{ kind: 'failed'; sources: readonly ForgeSourceOutcomeView[] }>
	| Readonly<{ kind: 'noMatches' }>;

/** Why a list is empty, or which sources failed beside the items shown. */
export function emptyReason(
	itemCount: number,
	accountCount: number,
	outcomes: readonly ForgeSourceOutcomeView[],
): EmptyReason | undefined {
	const failed = outcomes.filter((outcome) => outcome.state === 'failed');
	if (itemCount > 0) return failed.length > 0 ? { kind: 'failed', sources: failed } : undefined;
	if (accountCount === 0) return { kind: 'noAccounts' };
	if (failed.length > 0) return { kind: 'failed', sources: failed };
	return { kind: 'noMatches' };
}

/** Split body text into plain text and links; nothing is ever HTML. */
export function linkify(text: string): Array<{ text: string; url?: string }> {
	const parts: Array<{ text: string; url?: string }> = [];
	const pattern = /https:\/\/[^\s<>()"']+/gu;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > last) parts.push({ text: text.slice(last, index) });
		const url = match[0].replace(/[.,;:!?]+$/u, '');
		parts.push({ text: url, url });
		last = index + url.length;
	}
	if (last < text.length) parts.push({ text: text.slice(last) });
	return parts;
}

/** A label colour as CSS, or undefined for anything that is not six hex digits. */
export function labelColor(color: string): string | undefined {
	return /^[0-9a-f]{6}$/iu.test(color) ? `#${color}` : undefined;
}

/** Project pull request tab groups: This worktree, Open, Recently merged (≤ 5). */
export function projectPullRequestGroups(
	open: readonly ForgeListItemView[],
	merged: readonly ForgeListItemView[],
	selectedWorktreeId: string | undefined,
): Array<{ id: 'thisWorktree' | 'open' | 'merged'; label: string; items: ForgeListItemView[] }> {
	const mine =
		selectedWorktreeId === undefined
			? []
			: open.filter((entry) => entry.worktrees.some((match) => match.worktreeId === selectedWorktreeId));
	const rest = open.filter((entry) => !mine.includes(entry));
	const groups: Array<{ id: 'thisWorktree' | 'open' | 'merged'; label: string; items: ForgeListItemView[] }> = [];
	if (mine.length > 0) groups.push({ id: 'thisWorktree', label: 'This worktree', items: sortByUpdated(mine) });
	groups.push({ id: 'open', label: 'Open', items: sortByUpdated(rest) });
	if (merged.length > 0) groups.push({ id: 'merged', label: 'Recently merged', items: sortByUpdated(merged).slice(0, 5) });
	return groups;
}

/** A repository a forge source claims for an open project. */
export type ForgeClaimView = Readonly<{
	sourceId: string;
	origin: string;
	owner: string;
	name: string;
	kinds: readonly ForgeKind[];
	projectTabs: boolean;
}>;

/** The open projects whose remotes are claimed for this item's repository, in tab order. */
export function claimedProjects(
	reference: Pick<ForgeReference, 'origin' | 'owner' | 'name'>,
	projects: readonly ForgeProjectOption[],
	claims: ReadonlyMap<string, readonly ForgeClaimView[]>,
): ForgeProjectOption[] {
	const key = repositoryKey(reference);
	return projects.filter((project) =>
		(claims.get(project.projectId) ?? []).some((claim) => repositoryKey(claim) === key),
	);
}

/** What Home's list is narrowed to after a project tab sent the user there. */
export type ForgeRepositoryFocus = Readonly<{
	origin: string;
	owner: string;
	name: string;
}>;

/** A request from a project tab: show this repository, and maybe this item. */
export type ForgeHomeFocus = Readonly<{
	kind: ForgeKind;
	repository: ForgeRepositoryFocus;
	item?: ForgeReference;
	sourceId?: string;
	/** Changes on every request, so the same one twice still applies. */
	nonce: number;
}>;

// ── The project Git tab's panes ────────────────────────────────────────

export type ForgeGitPaneId = 'issues' | 'pullRequests';

/** The Git tab's pane order, collapse state, and heights, remembered on the device. */
export type ForgeGitPaneLayout = Readonly<{
	order: readonly ForgeGitPaneId[];
	collapsed: Readonly<Record<ForgeGitPaneId, boolean>>;
	heights: Readonly<Record<ForgeGitPaneId, number>>;
}>;

export const FORGE_GIT_PANES_KEY = 'terminay.forge.gitPanes';
const GIT_PANE_IDS: readonly ForgeGitPaneId[] = ['issues', 'pullRequests'];
const DEFAULT_GIT_PANE_HEIGHT = 320;

export const DEFAULT_FORGE_GIT_PANE_LAYOUT: ForgeGitPaneLayout = Object.freeze({
	order: GIT_PANE_IDS,
	collapsed: { issues: false, pullRequests: false },
	heights: { issues: DEFAULT_GIT_PANE_HEIGHT, pullRequests: DEFAULT_GIT_PANE_HEIGHT },
});

/** A stored layout, or the default for anything missing or malformed. */
export function readGitPaneLayout(raw: string | null | undefined): ForgeGitPaneLayout {
	let value: unknown;
	try {
		value = raw === null || raw === undefined ? undefined : JSON.parse(raw);
	} catch {
		value = undefined;
	}
	const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const storedOrder = Array.isArray(record.order)
		? record.order.filter((id): id is ForgeGitPaneId => GIT_PANE_IDS.includes(id as ForgeGitPaneId))
		: [];
	const order = [...new Set([...storedOrder, ...GIT_PANE_IDS])];
	const flags = (typeof record.collapsed === 'object' && record.collapsed !== null ? record.collapsed : {}) as Record<
		string,
		unknown
	>;
	const sizes = (typeof record.heights === 'object' && record.heights !== null ? record.heights : {}) as Record<
		string,
		unknown
	>;
	const height = (id: ForgeGitPaneId) => {
		const stored = sizes[id];
		return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_GIT_PANE_HEIGHT;
	};
	return {
		order,
		collapsed: { issues: flags.issues === true, pullRequests: flags.pullRequests === true },
		heights: { issues: height('issues'), pullRequests: height('pullRequests') },
	};
}
