/**
 * Home's Workflows section: every workflow on a terminal the dashboard lists,
 * as columns that scroll sideways, with filters, grouping, sort and density.
 * At 600px or less it is compact: columns stack and scroll with the section,
 * and most options fold behind View options.
 *
 * Read-only (ADR-0097): it never changes a step and never types into a
 * terminal. Its one action opens a workflow's terminal through the
 * dashboard's own activation. Every piece of workflow text is a text node.
 */

import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, SlidersHorizontal } from 'lucide-react';
import { type ReactElement, type RefObject, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalTitleStoreContext } from '../../shared/useWorkspaceProjection';
import { WorkflowStepMarker } from './workflowIcons';
import { WORKFLOW_DIAL_TICK_MS, WorkflowDial } from './WorkflowTabBadge';
import { elapsed, statusLabel, stepTime, tabSummary } from './workflowPanelModel';
import {
	applyWorkflowsHomeView,
	isHighlighted,
	type WorkflowsHomeGroupModel,
	type WorkflowsHomeRow,
} from './workflowsHomeModel';
import {
	DEFAULT_WORKFLOWS_HOME_VIEW,
	isDefaultWorkflowsHomeView,
	readWorkflowsHomeView,
	type WorkflowsHomeGroup,
	type WorkflowsHomeLayout,
	type WorkflowsHomeNotes,
	type WorkflowsHomeSort,
	type WorkflowsHomeStatus,
	type WorkflowsHomeView,
	writeWorkflowsHomeView,
} from './workflowsHomeView';
import './WorkflowPanel.css';
import './WorkflowsHome.css';

export type WorkflowsHomeProps = Readonly<{
	rows: readonly WorkflowsHomeRow[];
	/** True until the server's workflows have been read once. */
	loading: boolean;
	/** Open the row's terminal, as its dashboard row would. */
	onOpen: (row: WorkflowsHomeRow) => void;
	/** For tests: the view to start from instead of the remembered one. */
	initialView?: WorkflowsHomeView;
	/** For tests: a fixed time. */
	now?: number;
}>;

const STATUS_OPTIONS: readonly [WorkflowsHomeStatus, string][] = [
	['alert', 'Needs you'],
	['running', 'Running'],
	['done', 'Done'],
];
const GROUP_OPTIONS: readonly [WorkflowsHomeGroup, string][] = [
	['none', 'None'],
	['project', 'Project'],
	['workflow', 'Workflow'],
];
const LAYOUT_OPTIONS: readonly [WorkflowsHomeLayout, string][] = [
	['side', 'Side by side'],
	['rows', 'Rows'],
];
const SORT_OPTIONS: readonly [WorkflowsHomeSort, string][] = [
	['attention', 'Needs you first'],
	['recent', 'Recently updated'],
	['progress', 'Most progress'],
	['name', 'Name'],
];
const NOTES_OPTIONS: readonly [WorkflowsHomeNotes, string][] = [
	['full', 'Full'],
	['short', '2 lines'],
	['current', 'Current only'],
];

/** The width at or below which the section is compact (phones, narrow Home tabs). */
export const WORKFLOWS_HOME_COMPACT_WIDTH = 600;

/** Whether the element is at most the compact width, followed as it resizes. */
function useCompact(ref: RefObject<HTMLElement | null>): boolean {
	const [compact, setCompact] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (element === null || typeof ResizeObserver === 'undefined') return;
		// The border box, so the scrollbar compact mode adds cannot keep it compact.
		const measure = () =>
			setCompact(element.getBoundingClientRect().width <= WORKFLOWS_HOME_COMPACT_WIDTH);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element, { box: 'border-box' });
		return () => observer.disconnect();
	}, [ref]);
	return compact;
}

/** One clock for the whole section, ticking only while a step is active. */
function useSectionNow(rows: readonly WorkflowsHomeRow[], fixed: number | undefined): number {
	const ticking =
		fixed === undefined &&
		rows.some(
			(row) =>
				row.view.state === 'attached' &&
				row.view.workflow.steps.some(
					(step) => step.status === 'running' || step.status === 'needs_input',
				),
		);
	const [now, setNow] = useState(() => fixed ?? Date.now());
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), WORKFLOW_DIAL_TICK_MS);
		return () => clearInterval(timer);
	}, [ticking]);
	return fixed ?? now;
}

/**
 * Rows with each terminal's title as it is now (ADR-0058): rows are built when
 * the inventory changes, and a rename reaches the title stream first. The
 * filter, sort, and labels all read the live title.
 */
function useLiveTitles(rows: readonly WorkflowsHomeRow[]): readonly WorkflowsHomeRow[] {
	const store = useContext(TerminalTitleStoreContext);
	const [version, setVersion] = useState(0);
	const panelIds = useMemo(() => new Set(rows.map((row) => row.panel.panelId)), [rows]);
	useEffect(() => {
		if (store === undefined) return;
		return store.subscribeChanges((panelId) => {
			if (panelIds.has(panelId)) setVersion((current) => current + 1);
		});
	}, [store, panelIds]);
	return useMemo(() => {
		void version;
		if (store === undefined) return rows;
		return rows.map((row) => {
			const title = store.title(row.panel.panelId);
			return title === undefined || title === row.terminalTitle ? row : { ...row, terminalTitle: title };
		});
	}, [rows, store, version]);
}

export function WorkflowsHome(props: WorkflowsHomeProps): ReactElement {
	const [view, setView] = useState<WorkflowsHomeView>(
		() => props.initialView ?? readWorkflowsHomeView(),
	);
	const first = useRef(true);
	useEffect(() => {
		// The view read from storage need not be written straight back.
		if (first.current) {
			first.current = false;
			return;
		}
		writeWorkflowsHomeView(view);
	}, [view]);
	const update = (patch: Partial<WorkflowsHomeView>) =>
		setView((previous) => ({ ...previous, ...patch }));

	const root = useRef<HTMLDivElement | null>(null);
	const compact = useCompact(root);
	const rows = useLiveTitles(props.rows);
	const model = useMemo(() => applyWorkflowsHomeView(rows, view), [rows, view]);
	const now = useSectionNow(model.shown, props.now);
	const projectCount = new Set(model.shown.map((row) => row.projectKey)).size;

	let body: ReactElement;
	if (props.loading && props.rows.length === 0) {
		body = (
			<p className="workflows-home__state" role="status" data-workflows-home-state="loading">
				Loading workflows…
			</p>
		);
	} else if (props.rows.length === 0) {
		body = (
			<div className="workflows-home__state" data-workflows-home-state="empty">
				<strong>No workflows yet</strong>
				<span>Launch one from a terminal’s Command Bar.</span>
			</div>
		);
	} else if (model.shown.length === 0) {
		body = (
			<div className="workflows-home__state" data-workflows-home-state="no-match">
				<strong>No workflow matches this view</strong>
				<button
					type="button"
					className="workflows-home__button"
					onClick={() => setView(DEFAULT_WORKFLOWS_HOME_VIEW)}
				>
					Reset view
				</button>
			</div>
		);
	} else if (model.groups === undefined) {
		body = (
			<div className="workflows-home__scroller" data-workflows-home-layout="flat">
				{model.shown.map((row) => (
					<WorkflowColumn key={row.key} row={row} view={view} now={now} onOpen={props.onOpen} />
				))}
			</div>
		);
	} else {
		const toggle = (key: string) =>
			update({
				folded: view.folded.includes(key)
					? view.folded.filter((candidate) => candidate !== key)
					: [...view.folded, key],
			});
		const groups = model.groups.map((group) => (
			<WorkflowGroup
				key={group.key}
				group={group}
				view={view}
				now={now}
				onOpen={props.onOpen}
				onToggle={() => toggle(group.key)}
			/>
		));
		body =
			view.layout === 'rows' ? (
				<div className="workflows-home__rows" data-workflows-home-layout="rows">
					{groups}
				</div>
			) : (
				<div className="workflows-home__scroller" data-workflows-home-layout="side">
					{groups}
				</div>
			);
	}

	return (
		<div
			ref={root}
			className={`home-section workflows-home workflows-home--notes-${view.notes}${
				view.narrow ? ' workflows-home--narrow' : ''
			}${compact ? ' workflows-home--compact' : ''}`}
			data-terminay-home-workflows
			data-workflows-home-compact={compact ? 'true' : 'false'}
		>
			<header className="home-section__header">
				<h2 className="home-section__heading">Workflows</h2>
				<p className="home-section__subheading" data-workflows-home-count>
					{`${model.shown.length} of ${model.total} ${model.total === 1 ? 'workflow' : 'workflows'}`}
					{model.shown.length > 0
						? ` · ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`
						: ''}
				</p>
			</header>
			<WorkflowsToolbar
				view={view}
				model={model}
				compact={compact}
				onChange={update}
				onReset={() => setView(DEFAULT_WORKFLOWS_HOME_VIEW)}
			/>
			<div className="workflows-home__body">{body}</div>
		</div>
	);
}

function Segmented<T extends string>(props: {
	readonly label: string;
	readonly options: readonly [T, string][];
	readonly value: T;
	readonly onChange: (value: T) => void;
}) {
	return (
		<fieldset className="workflows-home__field">
			<legend className="workflows-home__label">{props.label}</legend>
			<div className="workflows-home__segmented">
				{props.options.map(([value, text]) => (
					<button
						key={value}
						type="button"
						aria-pressed={props.value === value}
						data-workflows-home-option={`${props.label.toLowerCase()}:${value}`}
						onClick={() => props.onChange(value)}
					>
						{text}
					</button>
				))}
			</div>
		</fieldset>
	);
}

function WorkflowsToolbar(props: {
	readonly view: WorkflowsHomeView;
	readonly model: ReturnType<typeof applyWorkflowsHomeView>;
	readonly compact: boolean;
	readonly onChange: (patch: Partial<WorkflowsHomeView>) => void;
	readonly onReset: () => void;
}) {
	const { view, model, compact, onChange } = props;
	const [optionsOpen, setOptionsOpen] = useState(false);
	const changed = !isDefaultWorkflowsHomeView(view);
	const options = (
		<>
			<ProjectPicker view={view} model={model} onChange={onChange} />
			<Segmented
				label="Group"
				options={GROUP_OPTIONS}
				value={view.group}
				onChange={(group) => onChange({ group })}
			/>
			{view.group === 'none' || compact ? null : (
				<Segmented
					label="Layout"
					options={LAYOUT_OPTIONS}
					value={view.layout}
					onChange={(layout) => onChange({ layout })}
				/>
			)}
			<label className="workflows-home__field">
				<span className="workflows-home__label">Sort</span>
				<select
					className="workflows-home__select"
					value={view.sort}
					onChange={(event) => onChange({ sort: event.target.value as WorkflowsHomeSort })}
				>
					{SORT_OPTIONS.map(([value, text]) => (
						<option key={value} value={value}>
							{text}
						</option>
					))}
				</select>
			</label>
			<Segmented
				label="Notes"
				options={NOTES_OPTIONS}
				value={view.notes}
				onChange={(notes) => onChange({ notes })}
			/>
			<label className="workflows-home__toggle">
				<input
					type="checkbox"
					checked={view.showFinished}
					onChange={(event) => onChange({ showFinished: event.target.checked })}
				/>
				Show finished
			</label>
			{compact ? null : (
				<label className="workflows-home__toggle">
					<input
						type="checkbox"
						checked={view.narrow}
						onChange={(event) => onChange({ narrow: event.target.checked })}
					/>
					Narrow columns
				</label>
			)}
			{changed ? (
				<button type="button" className="workflows-home__link" onClick={props.onReset}>
					Reset view
				</button>
			) : null}
		</>
	);
	return (
		<div className="workflows-home__toolbar">
			<input
				className="workflows-home__search"
				type="search"
				placeholder="Filter by name, terminal or project"
				aria-label="Filter workflows"
				value={view.text}
				maxLength={200}
				onChange={(event) => onChange({ text: event.target.value })}
			/>
			<fieldset className="workflows-home__chips">
				<legend className="workflow-visually-hidden">Status</legend>
				{STATUS_OPTIONS.map(([status, label]) => {
					const selected = view.statuses.includes(status);
					return (
						<button
							key={status}
							type="button"
							className={`workflows-home__chip workflows-home__chip--${status}`}
							aria-pressed={selected}
							data-workflows-home-status={status}
							onClick={() =>
								onChange({
									statuses: selected
										? view.statuses.filter((candidate) => candidate !== status)
										: [...view.statuses, status],
								})
							}
						>
							<span className="workflows-home__dot" aria-hidden="true" />
							{label}
							<span className="workflows-home__chip-count">{model.statusCounts[status]}</span>
						</button>
					);
				})}
			</fieldset>
			{compact ? (
				<button
					type="button"
					className="workflows-home__options-toggle"
					aria-expanded={optionsOpen}
					aria-controls="workflows-home-options"
					aria-label={changed ? 'View options, changed' : 'View options'}
					data-workflows-home-options-toggle
					onClick={() => setOptionsOpen((open) => !open)}
				>
					<SlidersHorizontal size={14} aria-hidden="true" />
					View options
					{changed ? (
						<span className="workflows-home__changed" aria-hidden="true">
							· changed
						</span>
					) : null}
					<ChevronDown
						size={14}
						aria-hidden="true"
						className={`workflows-home__options-chevron${optionsOpen ? ' is-open' : ''}`}
					/>
				</button>
			) : null}
			{compact ? (
				optionsOpen ? (
					<div
						className="workflows-home__options"
						id="workflows-home-options"
						data-workflows-home-options
					>
						{options}
					</div>
				) : null
			) : (
				options
			)}
		</div>
	);
}

function ProjectPicker(props: {
	readonly view: WorkflowsHomeView;
	readonly model: ReturnType<typeof applyWorkflowsHomeView>;
	readonly onChange: (patch: Partial<WorkflowsHomeView>) => void;
}) {
	const { view, model, onChange } = props;
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (event.target instanceof Node && ref.current?.contains(event.target)) return;
			setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		window.addEventListener('pointerdown', onPointer);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer);
			window.removeEventListener('keydown', onKey);
		};
	}, [open]);
	const included = model.projects.filter((project) => project.included);
	const all = included.length === model.projects.length;
	const label = all
		? 'All projects'
		: included.length === 0
			? 'No projects'
			: included.length === 1
				? (included[0]?.title ?? '')
				: `${included.length} projects`;
	const setIncluded = (key: string, include: boolean) =>
		onChange({
			excludedProjects: include
				? view.excludedProjects.filter((candidate) => candidate !== key)
				: [...view.excludedProjects, key],
		});
	return (
		<div className="workflows-home__picker" ref={ref}>
			<button
				type="button"
				className="workflows-home__picker-button"
				aria-expanded={open}
				aria-haspopup="true"
				aria-label={`Projects: ${label}`}
				data-workflows-home-projects
				onClick={() => setOpen((value) => !value)}
			>
				{label}
				<ChevronDown size={12} aria-hidden="true" />
			</button>
			{open ? (
				<fieldset className="workflows-home__menu">
					<legend className="workflow-visually-hidden">Projects</legend>
					{model.projects.map((project) => (
						<label key={project.key} className="workflows-home__menu-item">
							<input
								type="checkbox"
								checked={project.included}
								data-workflows-home-project={project.title}
								onChange={(event) => setIncluded(project.key, event.target.checked)}
							/>
							<span
								className="workflows-home__swatch"
								style={{ background: project.color }}
								aria-hidden="true"
							/>
							<span className="workflows-home__menu-title">{project.title}</span>
							<span className="workflows-home__menu-count">{project.count}</span>
						</label>
					))}
					<button
						type="button"
						className="workflows-home__link"
						onClick={() =>
							onChange({
								excludedProjects: all
									? [
											...new Set([
												...view.excludedProjects,
												...model.projects.map((project) => project.key),
											]),
										]
									: view.excludedProjects.filter(
											(key) => !model.projects.some((project) => project.key === key),
										),
							})
						}
					>
						{all ? 'Leave out all' : 'Include all'}
					</button>
				</fieldset>
			) : null}
		</div>
	);
}

function toneWords(group: WorkflowsHomeGroupModel): string[] {
	const words: string[] = [];
	if (group.counts.alert > 0) words.push(`${group.counts.alert} need you`);
	if (group.counts.running > 0) words.push(`${group.counts.running} running`);
	if (group.counts.done > 0) words.push(`${group.counts.done} done`);
	return words;
}

function WorkflowGroup(props: {
	readonly group: WorkflowsHomeGroupModel;
	readonly view: WorkflowsHomeView;
	readonly now: number;
	readonly onOpen: (row: WorkflowsHomeRow) => void;
	readonly onToggle: () => void;
}) {
	const { group, view, now } = props;
	const rows = view.layout === 'rows';
	return (
		<section
			className={`workflows-home__group${rows ? ' workflows-home__group--row' : ''}${
				group.folded ? ' workflows-home__group--folded' : ''
			}`}
			aria-label={group.title}
			data-workflows-home-group={group.title}
		>
			<div className="workflows-home__group-head">
				{group.color === undefined ? null : (
					<span
						className="workflows-home__swatch"
						style={{ background: group.color }}
						aria-hidden="true"
					/>
				)}
				<h3
					className={`workflows-home__group-title${
						view.group === 'workflow' ? ' workflows-home__group-title--mono' : ''
					}`}
				>
					{group.title}
				</h3>
				<span className="workflows-home__group-count">{group.rows.length}</span>
				<span className="workflows-home__group-tones">
					{toneWords(group).map((word) => (
						<span key={word}>{word}</span>
					))}
				</span>
				{group.folded ? (
					<span className="workflows-home__group-dials">
						{group.rows.map((row) => {
							const summary = tabSummary(row.view, now);
							return summary === undefined ? null : (
								<WorkflowDial key={row.key} summary={summary} />
							);
						})}
					</span>
				) : null}
				<button
					type="button"
					className="workflows-home__icon-button workflows-home__fold"
					aria-expanded={!group.folded}
					aria-label={group.folded ? `Unfold ${group.title}` : `Fold ${group.title}`}
					title={group.folded ? 'Unfold' : 'Fold'}
					data-workflows-home-fold={group.title}
					onClick={props.onToggle}
				>
					{group.folded ? (
						<ChevronsUpDown size={14} aria-hidden="true" />
					) : (
						<ChevronsDownUp size={14} aria-hidden="true" />
					)}
				</button>
			</div>
			{group.folded ? null : (
				<div className={rows ? 'workflows-home__row-scroller' : 'workflows-home__group-columns'}>
					{group.rows.map((row) => (
						<WorkflowColumn key={row.key} row={row} view={view} now={now} onOpen={props.onOpen} />
					))}
				</div>
			)}
		</section>
	);
}

function WorkflowColumn(props: {
	readonly row: WorkflowsHomeRow;
	readonly view: WorkflowsHomeView;
	readonly now: number;
	readonly onOpen: (row: WorkflowsHomeRow) => void;
}) {
	const { row, view, now } = props;
	const showProject = view.group !== 'project';
	const showName = view.group !== 'workflow';
	const workflow = row.view.state === 'attached' ? row.view.workflow : undefined;
	const since = workflow === undefined ? undefined : elapsed(workflow, now);
	const progress =
		workflow === undefined
			? undefined
			: row.tone === 'done'
				? `${row.done} of ${row.total} done · finished`
				: `${row.done} of ${row.total} done${since === undefined ? '' : ` · ${since} elapsed`}`;
	return (
		<article
			className="workflows-home__column"
			data-tone={row.tone}
			data-workflows-home-column={row.terminalTitle}
			aria-label={`${row.name}, ${row.terminalTitle}${row.tone === 'alert' ? ', needs you' : ''}`}
		>
			<header className="workflows-home__column-head">
				<div className="workflows-home__summary">
					<span className="workflow-eyebrow">
						Workflow
						{showProject ? (
							<span className="workflows-home__project">
								<span
									className="workflows-home__swatch"
									style={{ background: row.projectColor }}
									aria-hidden="true"
								/>
								{row.projectTitle}
							</span>
						) : null}
					</span>
					{showName ? <span className="workflow-name">{row.name}</span> : null}
					<span className="workflows-home__terminal">{row.terminalTitle}</span>
					{progress === undefined ? null : <span className="workflow-progress">{progress}</span>}
				</div>
				<button
					type="button"
					className="workflows-home__icon-button"
					aria-label={`Open terminal ${row.terminalTitle}`}
					title="Open its terminal"
					data-workflows-home-open={row.terminalTitle}
					onClick={() => props.onOpen(row)}
				>
					<ChevronRight size={14} aria-hidden="true" />
				</button>
			</header>
			{workflow === undefined ? (
				<p className="workflows-home__unrestorable" role="status">
					This terminal’s workflow could not be restored.
				</p>
			) : (
				<>
					{workflow.openingPrompt === '' ? null : (
						<details className="workflow-brief">
							<summary>Brief</summary>
							<p className="workflow-text">{workflow.openingPrompt}</p>
						</details>
					)}
					<ol className="workflow-steps workflows-home__steps">
						{workflow.steps.map((step) => {
							const highlighted = isHighlighted(step.status);
							const time = stepTime(step, now);
							const showNote =
								step.note !== '' && (view.notes !== 'current' || highlighted);
							return (
								<li
									key={step.id}
									className={`workflow-step${highlighted ? ' workflow-step--active' : ''}`}
									data-status={step.status}
								>
									<WorkflowStepMarker step={step} labelled={false} />
									<div className="workflow-step-body">
										<span className="workflow-step-title">
											{step.title}
											<span className="workflow-visually-hidden">
												{`, ${statusLabel(step.status)}`}
											</span>
										</span>
										{showNote ? (
											<span className="workflow-step-note workflow-text workflows-home__note">
												{step.note}
											</span>
										) : null}
									</div>
									{time === undefined ? null : (
										<span className="workflow-step-time">{time}</span>
									)}
								</li>
							);
						})}
					</ol>
				</>
			)}
		</article>
	);
}
