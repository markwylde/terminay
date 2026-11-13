import {
	type ChangeEvent,
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { saveImportExportBundle } from '../../host/nativeActions';
import {
	BundleError,
	decodeBundle,
	encodeBundle,
	withDependencies,
} from '../../importExport/bundle';
import { reviewWarnings } from '../../importExport/kinds';
import {
	buildMatrix,
	CELL_STATE_TEXT,
	type CellState,
	filterRows,
	kindCounts,
	type MatrixColumn,
	type MatrixRow,
	retainSelection,
	reviewStillValid,
	defaultSourceId,
} from '../../importExport/matrix';
import {
	canonicalJson,
	ITEM_KIND_LABELS,
	ITEM_KINDS,
	type ItemKind,
	type JsonObject,
	type ServerItem,
} from '../../importExport/model';
import {
	type ApplyResult,
	applyPlan,
	buildPlan,
	type Decision,
	nodeNeedsPick,
	OUTCOME_TEXT,
	type Plan,
	type PlanNode,
	planIsDecided,
	undecidedCount,
} from '../../importExport/plan';
import { useImportExportColumns } from '../../importExport/useImportExportColumns';
import './ImportExportCategory.css';

const DECISION_TEXT: Readonly<Record<Decision, string>> = Object.freeze({
	replace: 'Replace',
	keepBoth: 'Keep both',
	skip: 'Skip',
});

const KIND_GROUP_TEXT: Readonly<Record<ItemKind, string>> = Object.freeze({
	macro: 'Macros',
	workflowTemplate: 'Workflows',
	shellProfile: 'Shell profiles',
	automation: 'Automations',
	settingsCategory: 'Settings',
});

type View =
	| Readonly<{ kind: 'matrix' }>
	| Readonly<{ kind: 'review'; plan: Plan; targetIds: readonly string[] }>
	| Readonly<{
			kind: 'results';
			plan: Plan;
			running: boolean;
			results: readonly ApplyResult[];
	  }>;

function Cell({ state }: Readonly<{ state: CellState }>) {
	const text = CELL_STATE_TEXT[state];
	return (
		<span className={`import-export__cell import-export__cell--${state}`}>
			<span aria-hidden="true" className="import-export__glyph">
				{text.glyph}
			</span>
			{text.word}
		</span>
	);
}

/** The top-level fields that differ between two items' content. */
function differingFields(a: JsonObject, b: JsonObject): string[] {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys]
		.filter((key) => canonicalJson(a[key]) !== canonicalJson(b[key]))
		.sort();
}

function preview(value: unknown): string {
	const text = value === undefined ? '(none)' : JSON.stringify(value, null, 2);
	return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

function bundleFilename(label: string, now = new Date()): string {
	const stamp = now.toISOString().slice(0, 10);
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-|-$/gu, '');
	return `terminay-${slug || 'export'}-${stamp}.json`;
}

export function ImportExportCategory() {
	const {
		columns,
		activeColumnId,
		primaryColumnId,
		clientsFor,
		refresh,
		attach,
		setBundle,
	} = useImportExportColumns();

	// ---- Source, targets, rows -------------------------------------------
	const [chosenSource, setChosenSource] = useState<string>();
	const sourceId = useMemo(() => {
		const chosen = columns.find((column) => column.id === chosenSource);
		if (chosen?.ready) return chosen.id;
		return defaultSourceId(columns, activeColumnId, primaryColumnId);
	}, [activeColumnId, chosenSource, columns, primaryColumnId]);
	const sourceColumn = columns.find((column) => column.id === sourceId);

	const [tickedTargets, setTickedTargets] = useState<ReadonlySet<string>>(() => new Set());
	const targetIds = useMemo(
		() =>
			columns
				.filter(
					(column) =>
						tickedTargets.has(column.id) &&
						column.ready &&
						!column.readOnly &&
						column.id !== sourceId,
				)
				.map((column) => column.id),
		[columns, sourceId, tickedTargets],
	);

	const rows = useMemo(() => buildMatrix(columns, sourceId), [columns, sourceId]);
	const [rawSelection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
	const selection = useMemo(() => retainSelection(rawSelection, rows), [rawSelection, rows]);

	// A new source starts a new selection.
	const lastSource = useRef(sourceId);
	useEffect(() => {
		if (lastSource.current === sourceId) return;
		lastSource.current = sourceId;
		setSelection(new Set());
	}, [sourceId]);

	// ---- Filters -----------------------------------------------------------
	const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(() => new Set());
	const [text, setText] = useState('');
	const [onlyDifferences, setOnlyDifferences] = useState(false);
	const counts = useMemo(() => kindCounts(rows), [rows]);
	const visibleRows = useMemo(
		() => filterRows(rows, { kinds, text, onlyDifferences }, sourceId),
		[kinds, onlyDifferences, rows, sourceId, text],
	);
	const toggleKind = (kind: ItemKind) =>
		setKinds((current) => {
			const next = new Set(current);
			if (next.has(kind)) next.delete(kind);
			else next.add(kind);
			return next;
		});

	const toggleRow = (key: string) =>
		setSelection((current) => {
			const next = new Set(retainSelection(current, rows));
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	const selectableVisible = visibleRows.filter((row) => row.sourceItem !== undefined);
	const allVisibleSelected =
		selectableVisible.length > 0 && selectableVisible.every((row) => selection.has(row.key));
	const toggleAllVisible = () =>
		setSelection((current) => {
			const next = new Set(retainSelection(current, rows));
			for (const row of selectableVisible) {
				if (allVisibleSelected) next.delete(row.key);
				else next.add(row.key);
			}
			return next;
		});

	const selectedRows = rows.filter((row) => selection.has(row.key));
	const differingTargets = selectedRows.reduce(
		(count, row) =>
			count +
			targetIds.filter((id) => {
				const state = row.cells[id]?.state;
				return state === 'differs' || state === 'duplicate';
			}).length,
		0,
	);
	const changeCount = selectedRows.reduce(
		(count, row) =>
			count + targetIds.filter((id) => row.cells[id]?.state !== 'same').length,
		0,
	);

	// ---- Views -------------------------------------------------------------
	const [view, setView] = useState<View>({ kind: 'matrix' });
	const [notice, setNotice] = useState<string>();
	const [decisions, setDecisions] = useState<ReadonlyMap<string, Decision>>(() => new Map());
	const [picks, setPicks] = useState<ReadonlyMap<string, string>>(() => new Map());
	const [warnings, setWarnings] = useState<ReadonlyMap<string, readonly string[]>>(
		() => new Map(),
	);

	const startReview = () => {
		if (sourceColumn?.snapshot === undefined || sourceId === undefined) return;
		const plan = buildPlan({
			sourceId,
			source: sourceColumn.snapshot,
			rows,
			selectedKeys: selection,
			targets: targetIds.flatMap((id) => {
				const snapshot = columns.find((column) => column.id === id)?.snapshot;
				return snapshot === undefined ? [] : [{ id, snapshot }];
			}),
		});
		setDecisions(new Map());
		setPicks(new Map());
		setWarnings(new Map());
		setNotice(undefined);
		setView({ kind: 'review', plan, targetIds });
	};

	// Warnings come from each target; they load while review is open.
	useEffect(() => {
		if (view.kind !== 'review') return undefined;
		let cancelled = false;
		for (const target of view.plan.targets) {
			const clients = clientsFor(target.targetId);
			if (clients === undefined) continue;
			for (const node of target.nodes) {
				if (node.status === 'upToDate' || node.status === 'blocked') continue;
				void reviewWarnings(clients, node.source.portable).then((list) => {
					if (!cancelled && list.length > 0)
						setWarnings((current) => new Map(current).set(node.id, list));
				});
			}
		}
		return () => {
			cancelled = true;
		};
	}, [clientsFor, view]);

	// A review whose source or target stops being ready is discarded.
	useEffect(() => {
		if (view.kind !== 'review') return;
		if (reviewStillValid(columns, view.plan.sourceId, view.targetIds)) return;
		setView({ kind: 'matrix' });
		setNotice('Review closed because a server in it stopped being ready. Nothing was written.');
	}, [columns, view]);

	const apply = async () => {
		if (view.kind !== 'review') return;
		const plan = view.plan;
		setView({ kind: 'results', plan, running: true, results: [] });
		const results = await applyPlan(plan, decisions, picks, clientsFor, (result) =>
			setView((current) =>
				current.kind === 'results'
					? { ...current, results: [...current.results, result] }
					: current,
			),
		);
		setView({ kind: 'results', plan, running: false, results });
		refresh();
	};

	// ---- Export and import -------------------------------------------------
	const [exportConfirm, setExportConfirm] = useState(false);
	const [importError, setImportError] = useState<string>();
	const fileInput = useRef<HTMLInputElement>(null);

	const exportSelected = async () => {
		setExportConfirm(false);
		if (sourceColumn?.snapshot === undefined) return;
		const all: ServerItem[] = [];
		for (const kind of ITEM_KINDS) {
			const data = sourceColumn.snapshot[kind];
			if (data.state === 'ok') all.push(...data.items);
		}
		const chosen = selectedRows.flatMap((row) => (row.sourceItem ? [row.sourceItem] : []));
		try {
			const textOut = encodeBundle(withDependencies(chosen, all), sourceColumn.label);
			const saved = await saveImportExportBundle({
				text: textOut,
				filename: bundleFilename(sourceColumn.label),
			});
			if (saved) setNotice('Exported.');
		} catch (error) {
			setNotice(error instanceof Error ? error.message : 'The export failed.');
		}
	};

	const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (file === undefined) return;
		try {
			const decoded = decodeBundle(await file.text());
			setImportError(undefined);
			setBundle({ bundle: decoded, fileName: file.name });
		} catch (error) {
			setImportError(
				`${file.name} was not imported. ${error instanceof BundleError ? error.message : 'The file could not be read.'}`,
			);
		}
	};

	const labelOf = useCallback(
		(id: string) => columns.find((column) => column.id === id)?.label ?? id,
		[columns],
	);

	// ---- Rendering ---------------------------------------------------------
	if (view.kind === 'review') {
		return (
			<ReviewView
				plan={view.plan}
				labelOf={labelOf}
				decisions={decisions}
				picks={picks}
				warnings={warnings}
				onDecide={(nodeId, decision) =>
					setDecisions((current) => new Map(current).set(nodeId, decision))
				}
				onPick={(nodeId, id) => setPicks((current) => new Map(current).set(nodeId, id))}
				onBack={() => setView({ kind: 'matrix' })}
				onApply={() => void apply()}
			/>
		);
	}
	if (view.kind === 'results') {
		return (
			<ResultsView
				view={view}
				labelOf={labelOf}
				onDone={() => {
					setSelection(new Set());
					setView({ kind: 'matrix' });
				}}
			/>
		);
	}

	const gridTemplate = `40px minmax(180px, 1fr) repeat(${columns.length}, minmax(132px, 160px))`;
	const groups = ITEM_KINDS.map((kind) => ({
		kind,
		rows: visibleRows.filter((row) => row.kind === kind),
	})).filter((group) => group.rows.length > 0);

	return (
		<div className="import-export">
			<div className="import-export__toolbar">
				<p className="import-export__intro">
					Copy macros, workflows, shell profiles, automations and settings between
					your servers, or to and from a file.
				</p>
				<div className="import-export__toolbar-actions">
					<input
						ref={fileInput}
						type="file"
						accept=".json,application/json"
						hidden
						aria-label="Bundle file to import"
						data-testid="import-export-file-input"
						onChange={(event) => void importFile(event)}
					/>
					<button
						type="button"
						className="settings-secondary-button"
						onClick={() => fileInput.current?.click()}
					>
						Import file…
					</button>
					<button
						type="button"
						className="settings-secondary-button"
						disabled={selection.size === 0 || sourceColumn === undefined}
						onClick={() => setExportConfirm(true)}
					>
						Export selected…
					</button>
				</div>
			</div>

			{exportConfirm && (
				<div className="import-export__confirm" role="alertdialog" aria-label="Export">
					<p>
						The file holds item content as plain text, including scripts, prompts, field
						defaults and shell-profile environment values. Vault secrets are never
						included.
					</p>
					<div className="import-export__confirm-actions">
						<button
							type="button"
							className="settings-secondary-button"
							onClick={() => setExportConfirm(false)}
						>
							Cancel
						</button>
						<button
							type="button"
							className="settings-primary-button"
							onClick={() => void exportSelected()}
						>
							Save…
						</button>
					</div>
				</div>
			)}
			{importError && (
				<p className="import-export__error" role="alert">
					{importError}
				</p>
			)}
			{notice && (
				<p className="import-export__notice" role="status">
					{notice}
				</p>
			)}

			<div className="import-export__filters">
				<input
					type="search"
					className="settings-input-text import-export__search"
					placeholder="Filter by name"
					aria-label="Filter items by name"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				<fieldset className="import-export__chips">
					<legend className="sr-only">Kinds</legend>
					<button
						type="button"
						className="import-export__chip"
						aria-pressed={kinds.size === 0}
						onClick={() => setKinds(new Set())}
					>
						All
					</button>
					{ITEM_KINDS.map((kind) => (
						<button
							key={kind}
							type="button"
							className="import-export__chip"
							aria-pressed={kinds.has(kind)}
							onClick={() => toggleKind(kind)}
						>
							{KIND_GROUP_TEXT[kind]} <span className="import-export__count">{counts[kind]}</span>
						</button>
					))}
				</fieldset>
				<label className="import-export__toggle">
					<input
						type="checkbox"
						checked={onlyDifferences}
						onChange={(event) => setOnlyDifferences(event.target.checked)}
					/>
					Only differences
				</label>
			</div>

			<section className="import-export__matrix" aria-label="Items across servers">
				<div
					className="import-export__row import-export__row--head"
					style={{ gridTemplateColumns: gridTemplate }}
				>
					<div className="import-export__check">
						<input
							type="checkbox"
							aria-label="Select every shown item"
							checked={allVisibleSelected}
							disabled={selectableVisible.length === 0}
							onChange={toggleAllVisible}
						/>
					</div>
					<div className="import-export__item-head">
						Item
					</div>
					{columns.map((column) => (
						<ColumnHeader
							key={column.id}
							column={column}
							isSource={column.id === sourceId}
							isTarget={targetIds.includes(column.id)}
							onSource={() => setChosenSource(column.id)}
							onTarget={(ticked) =>
								setTickedTargets((current) => {
									const next = new Set(current);
									if (ticked) next.add(column.id);
									else next.delete(column.id);
									return next;
								})
							}
							{...(column.attachable ? { onAttach: () => attach(column.id) } : {})}
							{...(column.readOnly
								? {
										onRemove: () => {
											if (sourceId === column.id) setChosenSource(undefined);
											setBundle(undefined);
										},
									}
								: {})}
						/>
					))}
				</div>
				{groups.length === 0 && (
					<p className="import-export__empty">
						{rows.length === 0 ? 'No items yet.' : 'No items match the filters.'}
					</p>
				)}
				{groups.map((group) => (
					<Fragment key={group.kind}>
						<div className="import-export__group">
							<span>{KIND_GROUP_TEXT[group.kind]}</span>
						</div>
						{group.rows.map((row) => (
							<MatrixRowView
								key={row.key}
								row={row}
								columns={columns}
								sourceId={sourceId}
								selected={selection.has(row.key)}
								gridTemplate={gridTemplate}
								onToggle={() => toggleRow(row.key)}
							/>
						))}
					</Fragment>
				))}
			</section>

			<div className="import-export__summary">
				<div className="import-export__summary-text" data-testid="import-export-summary">
					{selection.size === 0 ? (
						'Select items to copy.'
					) : targetIds.length === 0 ? (
						<>
							<b>{selection.size}</b> {selection.size === 1 ? 'item' : 'items'} from{' '}
							<b>{sourceColumn?.label}</b>. Tick a target server.
						</>
					) : (
						<>
							<b>{selection.size}</b> {selection.size === 1 ? 'item' : 'items'} from{' '}
							<b>{sourceColumn?.label}</b> → {targetIds.map(labelOf).join(', ')}
							{differingTargets > 0 && (
								<span className="import-export__summary-warn">
									{' '}
									· {differingTargets} {differingTargets === 1 ? 'differs' : 'differ'} on
									a target
								</span>
							)}
						</>
					)}
				</div>
				<div className="import-export__legend" aria-hidden="true">
					● same ◐ differs ○ missing
				</div>
				<button
					type="button"
					className="settings-primary-button"
					disabled={selection.size === 0 || targetIds.length === 0}
					onClick={startReview}
				>
					{changeCount > 0
						? `Review ${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`
						: 'Review'}
				</button>
			</div>
		</div>
	);
}

function ColumnHeader({
	column,
	isSource,
	isTarget,
	onSource,
	onTarget,
	onRemove,
	onAttach,
}: Readonly<{
	column: MatrixColumn;
	isSource: boolean;
	isTarget: boolean;
	onSource: () => void;
	onTarget: (ticked: boolean) => void;
	onRemove?: () => void;
	onAttach?: () => void;
}>) {
	return (
		<div
			className={`import-export__column${isSource ? ' import-export__column--source' : ''}`}
			data-testid={`import-export-column-${column.label}`}
		>
			<div className="import-export__column-label" title={column.label}>
				{column.label}
			</div>
			{!column.ready && <div className="import-export__column-phase">{column.phase}</div>}
			<div className="import-export__column-controls">
				<label>
					<input
						type="radio"
						name="import-export-source"
						checked={isSource}
						disabled={!column.ready}
						onChange={onSource}
					/>
					Source
				</label>
				{!column.readOnly && (
					<label>
						<input
							type="checkbox"
							checked={isTarget}
							disabled={!column.ready || isSource}
							onChange={(event) => onTarget(event.target.checked)}
						/>
						Target
					</label>
				)}
				{onAttach && (
					<button type="button" className="import-export__link" onClick={onAttach}>
						Attach
					</button>
				)}
				{onRemove && (
					<button type="button" className="import-export__link" onClick={onRemove}>
						Remove
					</button>
				)}
			</div>
		</div>
	);
}

function MatrixRowView({
	row,
	columns,
	sourceId,
	selected,
	gridTemplate,
	onToggle,
}: Readonly<{
	row: MatrixRow;
	columns: readonly MatrixColumn[];
	sourceId: string | undefined;
	selected: boolean;
	gridTemplate: string;
	onToggle: () => void;
}>) {
	const selectable = row.sourceItem !== undefined;
	const sourceCell = sourceId === undefined ? undefined : row.cells[sourceId];
	const note =
		row.kind === 'automation' && selectable
			? 'arrives disabled'
			: row.sourceItem?.dangling
				? 'names a missing item'
				: undefined;
	return (
		<div
			className={`import-export__row${selected ? ' import-export__row--selected' : ''}`}
			style={{ gridTemplateColumns: gridTemplate }}
			data-testid={`import-export-row-${row.kind}-${row.name}`}
		>
			<div className="import-export__check">
				<input
					type="checkbox"
					aria-label={`Select ${row.name}`}
					checked={selected}
					disabled={!selectable}
					title={
						selectable
							? undefined
							: sourceCell?.state === 'duplicate'
								? 'The source has more than one item with this name.'
								: 'Not on the source.'
					}
					onChange={onToggle}
				/>
			</div>
			<div className="import-export__name">
				<span className="import-export__name-text">{row.name}</span>
				{note && <span className="import-export__badge">{note}</span>}
			</div>
			{columns.map((column) => (
				<div
					key={column.id}
					className={`import-export__state${column.id === sourceId ? ' import-export__source-cell' : ''}`}
					data-column={column.label}
				>
					<span className="sr-only">{column.label}: </span>
					<Cell state={row.cells[column.id]?.state ?? 'notReady'} />
				</div>
			))}
		</div>
	);
}

function ReviewView({
	plan,
	labelOf,
	decisions,
	picks,
	warnings,
	onDecide,
	onPick,
	onBack,
	onApply,
}: Readonly<{
	plan: Plan;
	labelOf: (id: string) => string;
	decisions: ReadonlyMap<string, Decision>;
	picks: ReadonlyMap<string, string>;
	warnings: ReadonlyMap<string, readonly string[]>;
	onDecide: (nodeId: string, decision: Decision) => void;
	onPick: (nodeId: string, id: string) => void;
	onBack: () => void;
	onApply: () => void;
}>) {
	const remaining = undecidedCount(plan, decisions, picks);
	const decided = planIsDecided(plan, decisions, picks);
	return (
		<div className="import-export import-export--review">
			<div className="import-export__toolbar">
				<p className="import-export__intro">
					Review what will be written from <b>{labelOf(plan.sourceId)}</b>. Nothing is
					written until you apply.
				</p>
			</div>
			<div className="import-export__review-body">
				{plan.targets.map((target) => (
					<section
						key={target.targetId}
						className="import-export__target"
						aria-label={`To ${labelOf(target.targetId)}`}
					>
						<h3 className="settings-section-title">To {labelOf(target.targetId)}</h3>
						<ul className="import-export__nodes">
							{target.nodes.map((node) => (
								<ReviewNode
									key={node.id}
									node={node}
									decision={decisions.get(node.id)}
									pick={picks.get(node.id)}
									warnings={warnings.get(node.id) ?? []}
									labelOf={labelOf}
									onDecide={(decision) => onDecide(node.id, decision)}
									onPick={(id) => onPick(node.id, id)}
								/>
							))}
						</ul>
					</section>
				))}
			</div>
			<div className="import-export__summary">
				<div className="import-export__summary-text" role="status">
					{decided
						? 'Every item has a decision.'
						: `${remaining} ${remaining === 1 ? 'item needs' : 'items need'} a decision.`}
				</div>
				<button type="button" className="settings-secondary-button" onClick={onBack}>
					Back
				</button>
				<button
					type="button"
					className="settings-primary-button"
					disabled={!decided}
					onClick={onApply}
				>
					Apply
				</button>
			</div>
		</div>
	);
}

function ReviewNode({
	node,
	decision,
	pick,
	warnings,
	labelOf,
	onDecide,
	onPick,
}: Readonly<{
	node: PlanNode;
	decision: Decision | undefined;
	pick: string | undefined;
	warnings: readonly string[];
	labelOf: (id: string) => string;
	onDecide: (decision: Decision) => void;
	onPick: (id: string) => void;
}>) {
	const status =
		node.status === 'add'
			? 'Will be added'
			: node.status === 'upToDate'
				? 'Up to date'
				: node.status === 'blocked'
					? `Blocked: ${node.blockedReason ?? 'it cannot be copied.'}`
					: node.existing.length > 1
						? `${node.existing.length} items have this name on ${labelOf(node.targetId)}`
						: 'Differs on this server';
	const existing = node.existing[0];
	const fields =
		node.status === 'clash' && existing
			? differingFields(node.source.portable.content, existing.portable.content)
			: [];
	return (
		<li
			className={`import-export__node import-export__node--${node.status}`}
			data-testid={`import-export-node-${node.kind}-${node.name}`}
		>
			<div className="import-export__node-head">
				<span className="import-export__node-kind">{ITEM_KIND_LABELS[node.kind].one}</span>
				<span className="import-export__node-name">{node.name}</span>
				<span className="import-export__node-status">{status}</span>
			</div>
			{node.dependency && (
				<p className="import-export__node-note">
					Included because a selected automation runs it.
				</p>
			)}
			{warnings.map((warning) => (
				<p key={warning} className="import-export__node-warning">
					{warning}
				</p>
			))}
			{node.status === 'clash' && node.existing.length === 1 && fields.length > 0 && (
				<details className="import-export__diff">
					<summary>Differs in {fields.join(', ')}</summary>
					{fields.map((field) => (
						<div key={field} className="import-export__diff-field">
							<div className="import-export__diff-label">{field}</div>
							<div className="import-export__diff-sides">
								<div>
									<div className="import-export__diff-side">Source</div>
									<pre>{preview(node.source.portable.content[field])}</pre>
								</div>
								<div>
									<div className="import-export__diff-side">This server</div>
									<pre>{preview(existing?.portable.content[field])}</pre>
								</div>
							</div>
						</div>
					))}
				</details>
			)}
			{node.status === 'clash' && (
				<fieldset className="import-export__choices">
					<legend>
						What should happen to {node.name} on {labelOf(node.targetId)}?
					</legend>
					{node.choices.map((choice) => (
						<label key={choice}>
							<input
								type="radio"
								name={`decision-${node.id}`}
								checked={decision === choice}
								onChange={() => onDecide(choice)}
							/>
							{DECISION_TEXT[choice]}
						</label>
					))}
					{nodeNeedsPick(node, decision) && (
						<label className="import-export__pick">
							Replace which one?
							<select
								value={pick ?? ''}
								onChange={(event) => onPick(event.target.value)}
							>
								<option value="" disabled>
									Choose…
								</option>
								{node.existing.map((item, index) => (
									<option key={item.id ?? index} value={item.id ?? ''}>
										{item.portable.name} ({index + 1} of {node.existing.length})
									</option>
								))}
							</select>
						</label>
					)}
				</fieldset>
			)}
		</li>
	);
}

function ResultsView({
	view,
	labelOf,
	onDone,
}: Readonly<{
	view: Extract<View, { kind: 'results' }>;
	labelOf: (id: string) => string;
	onDone: () => void;
}>) {
	return (
		<div className="import-export import-export--results">
			<div className="import-export__toolbar">
				<p className="import-export__intro" role="status">
					{view.running ? 'Copying…' : 'Finished. Nothing was rolled back.'}
				</p>
			</div>
			<div className="import-export__review-body">
				{view.plan.targets.map((target) => (
					<section
						key={target.targetId}
						className="import-export__target"
						aria-label={`Results for ${labelOf(target.targetId)}`}
					>
						<h3 className="settings-section-title">{labelOf(target.targetId)}</h3>
						<ul className="import-export__nodes">
							{view.results
								.filter((result) => result.targetId === target.targetId)
								.map((result) => (
									<li
										key={result.nodeId}
										className={`import-export__result import-export__result--${result.outcome}`}
										data-testid={`import-export-result-${result.kind}-${result.name}`}
									>
										<span className="import-export__node-kind">
											{ITEM_KIND_LABELS[result.kind].one}
										</span>
										<span className="import-export__node-name">{result.name}</span>
										<span className="import-export__node-status">
											{OUTCOME_TEXT[result.outcome]}
										</span>
										{result.message && (
											<span className="import-export__result-message">{result.message}</span>
										)}
									</li>
								))}
						</ul>
					</section>
				))}
			</div>
			<div className="import-export__summary">
				<div className="import-export__summary-text" />
				<button
					type="button"
					className="settings-primary-button"
					disabled={view.running}
					onClick={onDone}
				>
					Done
				</button>
			</div>
		</div>
	);
}
