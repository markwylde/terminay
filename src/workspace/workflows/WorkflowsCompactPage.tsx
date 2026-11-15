/**
 * Home › Workflows on a compact workspace: the compact section page, and a
 * workflow's detail page.
 *
 * The tabs are this page's own state; the stored view (text, projects,
 * finished, sort, group, and a status filter chosen on a wide window) is the
 * section's, shared with the wide page. Read-only (ADR-0097): the one action
 * opens the workflow's terminal. Every piece of workflow text is a text node.
 */

import { ChevronLeft, SquareTerminal } from 'lucide-react';
import { type ReactElement, useEffect, useLayoutEffect, useRef } from 'react';
import { CompactSectionPage } from '../compact/CompactSectionPage';
import {
	CompactEmpty,
	CompactGroupHeader,
	CompactRow,
	type CompactTone,
	StatusMark,
} from '../compact/CompactRow';
import {
	SheetChecklist,
	SheetSegment,
	SheetSelect,
	SheetToggle,
} from '../compact/CompactSheet';
import {
	appliedOptions,
	countTabs,
	rowsForTab,
} from '../compact/compactSectionModel';
import { WorkflowStepMarker } from './workflowIcons';
import { elapsed, statusLabel, stepTime } from './workflowPanelModel';
import {
	applyWorkflowsHomeView,
	isHighlighted,
	type WorkflowsHomeRow,
	type WorkflowsHomeTone,
} from './workflowsHomeModel';
import type {
	WorkflowsHomeGroup,
	WorkflowsHomeSort,
	WorkflowsHomeStatus,
	WorkflowsHomeView,
} from './workflowsHomeView';

export type WorkflowsCompactTab = 'all' | 'alert' | 'running' | 'done';

const TABS = [
	{ id: 'all', label: 'All' },
	{
		id: 'alert',
		label: 'Needs you',
		attention: true,
		test: (row: WorkflowsHomeRow) => row.tone === 'alert',
	},
	{
		id: 'running',
		label: 'Running',
		test: (row: WorkflowsHomeRow) => row.tone === 'running',
	},
	{
		id: 'done',
		label: 'Done',
		test: (row: WorkflowsHomeRow) => row.tone === 'done',
	},
] as const;

const TONE_MARK: Readonly<Record<WorkflowsHomeTone, CompactTone>> = {
	alert: 'attention',
	running: 'working',
	done: 'done',
	idle: 'idle',
};

const STATUS_WORDS: Readonly<Record<WorkflowsHomeStatus, string>> = {
	alert: 'Needs you',
	running: 'Running',
	done: 'Done',
};

const SORT_OPTIONS: readonly Readonly<{
	value: WorkflowsHomeSort;
	label: string;
}>[] = [
	{ value: 'attention', label: 'Needs you first' },
	{ value: 'recent', label: 'Recently updated' },
	{ value: 'progress', label: 'Most progress' },
	{ value: 'name', label: 'Name' },
];

const GROUP_OPTIONS: readonly Readonly<{
	value: WorkflowsHomeGroup;
	label: string;
}>[] = [
	{ value: 'none', label: 'None' },
	{ value: 'project', label: 'Project' },
	{ value: 'workflow', label: 'Workflow' },
];

/** "4m", "2h", "3d": how long ago, for a row's trailing age. */
export function shortSince(at: number | null, now: number): string | undefined {
	if (at === null) return undefined;
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 60) return 'now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** The one line a row says about where the workflow is. */
function currentLine(row: WorkflowsHomeRow): Readonly<{
	text: string;
	attention: boolean;
}> {
	if (row.view.state !== 'attached')
		return { text: 'Workflow could not be restored', attention: true };
	const { steps } = row.view.workflow;
	const blocked = steps.find(
		(step) => step.status === 'failed' || step.status === 'needs_input',
	);
	if (blocked !== undefined)
		return {
			text: `${blocked.title}${blocked.note === '' ? '' : ` — ${blocked.note}`}`,
			attention: true,
		};
	const running = steps.find((step) => step.status === 'running');
	if (running !== undefined) return { text: running.title, attention: false };
	if (row.tone === 'done') return { text: 'Finished', attention: false };
	const next = steps.find((step) => step.status === 'not_started');
	return { text: next === undefined ? 'Not started' : `Next: ${next.title}`, attention: false };
}

export function WorkflowsCompactPage(props: {
	readonly rows: readonly WorkflowsHomeRow[];
	readonly loading: boolean;
	readonly view: WorkflowsHomeView;
	readonly onChange: (patch: Partial<WorkflowsHomeView>) => void;
	readonly tab: WorkflowsCompactTab;
	readonly onTab: (tab: WorkflowsCompactTab) => void;
	readonly detailKey: string | undefined;
	readonly onDetail: (key: string | undefined) => void;
	readonly now: number;
	readonly onOpen: (row: WorkflowsHomeRow) => void;
}): ReactElement {
	const { rows, view, onChange, tab, now } = props;
	const scrollTop = useRef(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const returnFocusKey = useRef<string | undefined>(undefined);

	const detailRow =
		props.detailKey === undefined
			? undefined
			: rows.find((row) => row.key === props.detailKey);
	// A workflow removed or replaced while open: back to the list.
	const { detailKey, onDetail } = props;
	useEffect(() => {
		if (detailKey !== undefined && detailRow === undefined) onDetail(undefined);
	}, [detailKey, detailRow, onDetail]);

	// Back from a detail page: the list is where it was, focus on its row.
	const showingDetail = detailRow !== undefined;
	useLayoutEffect(() => {
		if (showingDetail) return;
		const body = rootRef.current?.querySelector<HTMLElement>('.cpage__body');
		if (body !== null && body !== undefined) body.scrollTop = scrollTop.current;
		const key = returnFocusKey.current;
		if (key === undefined) return;
		returnFocusKey.current = undefined;
		rootRef.current
			?.querySelector<HTMLElement>(
				`[data-workflows-home-row="${CSS.escape(key)}"] .crow__main`,
			)
			?.focus();
	}, [showingDetail]);

	if (detailRow !== undefined)
		return (
			<div ref={rootRef} className="cpage-host">
				<WorkflowDetail
					row={detailRow}
					now={now}
					onBack={() => {
						returnFocusKey.current = detailRow.key;
						props.onDetail(undefined);
					}}
					onOpen={() => props.onOpen(detailRow)}
				/>
			</div>
		);

	// Everything but the tab: the stored view, flat and sorted.
	const model = applyWorkflowsHomeView(rows, { ...view, group: 'none' });
	const tabs = countTabs(model.shown, TABS);
	const shown = rowsForTab(model.shown, TABS, tab);

	const present = model.projects;
	const included = present.filter((project) => project.included);
	const applied = appliedOptions([
		included.length < present.length && {
			id: 'projects',
			label:
				included.length === 0
					? 'No projects'
					: included.length <= 2
						? included.map((project) => project.title).join(', ')
						: `${included.length} of ${present.length} projects`,
			reset: () => onChange({ excludedProjects: [] }),
		},
		!view.showFinished && {
			id: 'finished',
			label: 'Finished hidden',
			reset: () => onChange({ showFinished: true }),
		},
		view.statuses.length > 0 && {
			id: 'statuses',
			label: view.statuses.map((status) => STATUS_WORDS[status]).join(', '),
			reset: () => onChange({ statuses: [] }),
		},
	]);
	const canReset =
		applied !== undefined || view.sort !== 'attention' || view.group !== 'none';

	const openDetail = (row: WorkflowsHomeRow) => {
		scrollTop.current =
			rootRef.current?.querySelector<HTMLElement>('.cpage__body')?.scrollTop ?? 0;
		props.onDetail(row.key);
	};

	const renderRow = (row: WorkflowsHomeRow) => {
		const line = currentLine(row);
		return (
			<CompactRow
				key={row.key}
				lead={
					<StatusMark
						tone={TONE_MARK[row.tone]}
						label={row.tone === 'alert' ? 'Needs you' : undefined}
					/>
				}
				title={row.name}
				trailing={row.total === 0 ? undefined : `${row.done}/${row.total}`}
				detail={line.text}
				detailTone={line.attention ? 'attention' : undefined}
				meta={[
					view.group === 'project' ? undefined : row.projectTitle,
					row.terminalTitle,
					shortSince(row.lastChange, now),
				]
					.filter(Boolean)
					.join(' · ')}
				chips={
					row.total === 0 ? undefined : (
						<span className="crow__progress" aria-hidden="true">
							<span style={{ width: `${Math.round(row.fraction * 100)}%` }} />
						</span>
					)
				}
				onActivate={() => openDetail(row)}
				activateLabel={`${row.name}, ${row.terminalTitle}${row.total === 0 ? '' : `, ${row.done} of ${row.total} done`}${row.tone === 'alert' ? ', needs you' : ''}`}
				rowProps={{
					'data-workflows-home-row': row.key,
					'data-workflows-home-column': row.terminalTitle,
					'data-tone': row.tone,
				}}
			/>
		);
	};

	let body: ReactElement;
	if (props.loading && rows.length === 0) {
		body = <CompactEmpty title="Loading workflows…" />;
	} else if (rows.length === 0) {
		body = (
			<CompactEmpty title="No workflows yet">
				Launch one from a terminal’s Command Bar.
			</CompactEmpty>
		);
	} else if (shown.length === 0) {
		const term = view.text.trim();
		body =
			term !== '' ? (
				<CompactEmpty
					title={`No workflow matches “${term}”`}
					action={{ label: 'Clear search', onActivate: () => onChange({ text: '' }) }}
				/>
			) : applied !== undefined ? (
				<CompactEmpty
					title="No workflow matches these options"
					action={{ label: 'Clear options', onActivate: applied.clear }}
				/>
			) : (
				<CompactEmpty title="Nothing here right now" />
			);
	} else if (view.group === 'none') {
		body = <div>{shown.map(renderRow)}</div>;
	} else {
		const groups = new Map<string, WorkflowsHomeRow[]>();
		for (const row of shown) {
			const key = view.group === 'project' ? row.projectKey : `workflow:${row.name}`;
			const bucket = groups.get(key);
			if (bucket === undefined) groups.set(key, [row]);
			else bucket.push(row);
		}
		body = (
			<div>
				{[...groups].map(([key, members]) => {
					const first = members[0] as WorkflowsHomeRow;
					return (
						<section key={key} aria-label={view.group === 'project' ? first.projectTitle : first.name}>
							<CompactGroupHeader
								label={view.group === 'project' ? first.projectTitle : first.name}
								count={members.length}
								{...(view.group === 'project' ? { color: first.projectColor } : {})}
							/>
							{members.map(renderRow)}
						</section>
					);
				})}
			</div>
		);
	}

	return (
		<div ref={rootRef} className="cpage-host">
			<CompactSectionPage
				section="workflows"
				title="Workflows"
				summary={rows.length === 0 ? undefined : String(model.shown.length)}
				search={{
					value: view.text,
					onChange: (text) => onChange({ text }),
					placeholder: 'Search workflows',
					label: 'Filter workflows',
				}}
				tabs={tabs}
				selectedTab={tab}
				onSelectTab={props.onTab}
				applied={applied}
				sheet={{
					title: 'Workflows',
					canReset,
					onReset: () =>
						onChange({
							excludedProjects: [],
							showFinished: true,
							statuses: [],
							sort: 'attention',
							group: 'none',
						}),
					content: (
						<>
							<SheetSelect
								label="Sort"
								value={view.sort}
								options={SORT_OPTIONS}
								onChange={(sort) => onChange({ sort })}
							/>
							<SheetSegment
								label="Group"
								value={view.group}
								options={GROUP_OPTIONS}
								onChange={(group) => onChange({ group })}
							/>
							{present.length > 1 ? (
								<SheetChecklist
									label="Projects"
									items={present.map((project) => ({
										id: project.key,
										label: project.title,
										color: project.color,
										count: project.count,
										checked: project.included,
									}))}
									onToggle={(key, checked) =>
										onChange({
											excludedProjects: checked
												? view.excludedProjects.filter((candidate) => candidate !== key)
												: [...view.excludedProjects, key],
										})
									}
									{...(included.length < present.length
										? {
												onAll: {
													label: 'Include every project',
													onActivate: () => onChange({ excludedProjects: [] }),
												},
											}
										: {})}
								/>
							) : null}
							<SheetToggle
								label="Finished workflows"
								hint="Show workflows whose every step is done."
								checked={view.showFinished}
								onChange={(showFinished) => onChange({ showFinished })}
							/>
						</>
					),
				}}
			>
				{body}
			</CompactSectionPage>
		</div>
	);
}

function WorkflowDetail(props: {
	readonly row: WorkflowsHomeRow;
	readonly now: number;
	readonly onBack: () => void;
	readonly onOpen: () => void;
}) {
	const { row, now } = props;
	const backRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		backRef.current?.focus();
	}, []);
	const workflow = row.view.state === 'attached' ? row.view.workflow : undefined;
	const since = workflow === undefined ? undefined : elapsed(workflow, now);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere on the page goes back, as the back control does.
		<div
			className="cpage cdetail"
			data-compact-section="workflow-detail"
			data-workflows-home-detail={row.key}
			onKeyDown={(event) => {
				if (event.key !== 'Escape' || event.defaultPrevented) return;
				event.preventDefault();
				event.stopPropagation();
				props.onBack();
			}}
		>
			<div className="cpage__top">
				<div className="cpage__head cdetail__head">
					<button
						ref={backRef}
						type="button"
						className="cdetail__back"
						onClick={props.onBack}
						data-workflows-home-back="true"
					>
						<ChevronLeft size={20} aria-hidden="true" />
						Workflows
					</button>
				</div>
			</div>
			<div className="cpage__body cdetail__body">
				<p className="cdetail__eyebrow">
					<span
						className="crow-group__swatch"
						style={{ background: row.projectColor }}
						aria-hidden="true"
					/>
					{row.projectTitle}
					{` · ${row.terminalTitle}`}
				</p>
				<h1 className="cdetail__title">{row.name}</h1>
				{workflow === undefined ? (
					<p className="cdetail__note" role="status">
						This terminal’s workflow could not be restored.
					</p>
				) : (
					<div className="cdetail__progress">
						<span className="crow__progress" aria-hidden="true">
							<span style={{ width: `${Math.round(row.fraction * 100)}%` }} />
						</span>
						<span className="cdetail__progress-text">
							{row.tone === 'done'
								? `${row.done} of ${row.total} done · finished`
								: `${row.done} of ${row.total} done${since === undefined ? '' : ` · ${since} elapsed`}`}
						</span>
					</div>
				)}
				<button
					type="button"
					className="cdetail__open"
					onClick={props.onOpen}
					data-workflows-home-open={row.terminalTitle}
				>
					<SquareTerminal size={17} aria-hidden="true" /> Open terminal
				</button>
				{workflow === undefined ? null : (
					<>
						{workflow.openingPrompt === '' ? null : (
							<section className="cdetail__section" aria-label="Brief">
								<h2 className="csheet__label">Brief</h2>
								<p className="cdetail__brief workflow-text">{workflow.openingPrompt}</p>
							</section>
						)}
						<section className="cdetail__section" aria-label="Steps">
							<h2 className="csheet__label">Steps</h2>
							<ol className="cdetail__steps">
								{workflow.steps.map((step) => {
									const highlighted = isHighlighted(step.status);
									const needsUser =
										step.status === 'needs_input' || step.status === 'failed';
									const time = stepTime(step, now);
									return (
										<li
											key={step.id}
											className={`cdetail__step${highlighted ? ' cdetail__step--active' : ''}${needsUser ? ' cdetail__step--attention' : ''}${step.status === 'skipped' ? ' cdetail__step--skipped' : ''}`}
											data-status={step.status}
										>
											<WorkflowStepMarker step={step} labelled={false} />
											<div className="cdetail__step-body">
												<span className="cdetail__step-title">
													{step.title}
													<span className="workflow-visually-hidden">
														{`, ${statusLabel(step.status)}`}
													</span>
												</span>
												{step.note === '' ? null : (
													<span className="cdetail__step-note workflow-text">{step.note}</span>
												)}
												{needsUser ? (
													<button
														type="button"
														className="cdetail__step-open"
														onClick={props.onOpen}
													>
														<SquareTerminal size={14} aria-hidden="true" /> Open terminal
													</button>
												) : null}
											</div>
											{time === undefined ? null : (
												<span className="cdetail__step-time">{time}</span>
											)}
										</li>
									);
								})}
							</ol>
						</section>
					</>
				)}
			</div>
		</div>
	);
}
