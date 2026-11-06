/**
 * Home's overview section: the workspace in a grid of widgets the user can
 * arrange.
 *
 * Which widgets show, in what order and at what size, is the server setting
 * `homeDashboard` (ADR-0101), edited through `homeDashboardLayout`. This file
 * renders that layout and offers edit mode; every number comes from
 * `homeOverviewModel`, and each widget lives in `homeOverviewWidgets`.
 */

import {
	Activity,
	Bell,
	BellRing,
	Bot,
	Check,
	ChevronLeft,
	ChevronRight,
	EyeOff,
	Film,
	FolderKanban,
	GitPullRequest,
	GripVertical,
	LayoutGrid,
	ListChecks,
	MessagesSquare,
	PanelsTopLeft,
	Plus,
	Radio,
	RotateCcw,
	Sparkles,
	Workflow,
	Zap,
} from 'lucide-react';
import {
	type ComponentType,
	type DragEvent,
	type ReactNode,
	useState,
} from 'react';
import type {
	HomeDashboardSettings,
	HomeDashboardWidgetSize,
} from '../types/settings';
import {
	type HomeWidgetId,
	hiddenWidgets,
	moveWidgetBefore,
	moveWidgetBy,
	type ResolvedHomeWidget,
	resetLayout,
	setWidgetHidden,
	setWidgetSize,
	visibleWidgets,
} from './homeDashboardLayout';
import type {
	HomeOverview as HomeOverviewModel,
	HomeOverviewServerRef,
} from './homeOverviewModel';
import {
	AgentsWidget,
	AutomationsWidget,
	BotSessionsWidget,
	BotsWidget,
	ConnectionsWidget,
	type HomeRecordingsState,
	type HomeWidgetActions,
	type HomeWidgetProps,
	NeedsYouWidget,
	NotificationsWidget,
	ProjectsWidget,
	PullRequestsWidget,
	QuickActionsWidget,
	RecordingsWidget,
	RunHistoryWidget,
	TabsWidget,
	WorkflowsWidget,
} from './homeOverviewWidgets';
import './homeOverview.css';

export type {
	HomeOverviewAutomationTarget,
	HomeQuickActions,
	HomeRecordingsState,
	HomeWidgetActions,
} from './homeOverviewWidgets';

export type HomeOverviewProps = Readonly<{
	overview: HomeOverviewModel;
	actions: HomeWidgetActions;
	recordings: HomeRecordingsState;
	/** The layout to show: the server's, or an edit still being saved. */
	layout: HomeDashboardSettings;
	onLayoutChange: (next: HomeDashboardSettings) => void;
	/** The last layout change could not be saved. */
	layoutSaveFailed?: boolean;
	/** Epoch ms used to phrase times relative to now. */
	now?: number;
}>;

type WidgetSpec = Readonly<{
	icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
	Body: ComponentType<HomeWidgetProps>;
	/** A short count beside the title. */
	meta?: (overview: HomeOverviewModel) => string | undefined;
	unavailable?: (
		overview: HomeOverviewModel,
	) => readonly HomeOverviewServerRef[];
	/** Emphasised while it holds anything. */
	urgent?: (overview: HomeOverviewModel) => boolean;
}>;

const WIDGETS: Readonly<Record<HomeWidgetId, WidgetSpec>> = {
	'quick-actions': { icon: Zap, Body: QuickActionsWidget },
	'needs-you': {
		icon: BellRing,
		Body: NeedsYouWidget,
		meta: (o) =>
			o.attention.items.length === 0
				? undefined
				: `${o.attention.items.length} waiting`,
		unavailable: (o) => o.attention.unavailable,
		urgent: (o) => o.attention.items.length > 0,
	},
	agents: {
		icon: Sparkles,
		Body: AgentsWidget,
		unavailable: (o) => o.agents.unavailable,
	},
	workflows: {
		icon: ListChecks,
		Body: WorkflowsWidget,
		meta: (o) => {
			const running = o.workflows.items.filter(
				(item) => item.rank !== 'finished',
			).length;
			const finished = o.workflows.items.length - running;
			const parts = [
				running > 0 ? `${running} active` : undefined,
				finished > 0 ? `${finished} finished` : undefined,
			].filter((part) => part !== undefined);
			return parts.length === 0 ? undefined : parts.join(' · ');
		},
		unavailable: (o) => o.workflows.unavailable,
	},
	bots: {
		icon: Bot,
		Body: BotsWidget,
		meta: (o) =>
			o.bots.items.length === 0
				? undefined
				: `${o.bots.items.length} ${o.bots.items.length === 1 ? 'bot' : 'bots'}`,
		unavailable: (o) => o.bots.unavailable,
	},
	'run-history': {
		icon: Activity,
		Body: RunHistoryWidget,
		meta: (o) =>
			o.automations.history.runs.length === 0
				? undefined
				: `last ${o.automations.history.runs.length} runs`,
		unavailable: (o) => o.automations.unavailable,
	},
	'pull-requests': {
		icon: GitPullRequest,
		Body: PullRequestsWidget,
		meta: (o) =>
			o.pullRequests.items.length === 0
				? undefined
				: `${o.pullRequests.items.length} open`,
		unavailable: (o) => o.pullRequests.unavailable,
	},
	notifications: {
		icon: Bell,
		Body: NotificationsWidget,
		meta: (o) =>
			o.notifications.length === 0 ? undefined : String(o.notifications.length),
	},
	projects: {
		icon: FolderKanban,
		Body: ProjectsWidget,
		unavailable: (o) => o.projects.unavailable,
	},
	'bot-sessions': {
		icon: MessagesSquare,
		Body: BotSessionsWidget,
	},
	automations: {
		icon: Workflow,
		Body: AutomationsWidget,
		unavailable: (o) => o.automations.unavailable,
	},
	recordings: { icon: Film, Body: RecordingsWidget },
	tabs: {
		icon: PanelsTopLeft,
		Body: TabsWidget,
		unavailable: (o) => o.tabs.unavailable,
	},
	connections: {
		icon: Radio,
		Body: ConnectionsWidget,
		unavailable: (o) => o.connections.unavailable,
	},
};

const SIZE_LABELS: Record<HomeDashboardWidgetSize, string> = {
	small: 'Small',
	wide: 'Wide',
	tall: 'Tall',
};

function describeUnavailable(
	unavailable: readonly HomeOverviewServerRef[],
): string | undefined {
	if (unavailable.length === 0) return undefined;
	const offline = unavailable.filter((item) => item.reason === 'offline');
	const notHeld = unavailable.filter((item) => item.reason === 'not-held');
	const parts: string[] = [];
	if (offline.length > 0)
		parts.push(
			`${offline.map((item) => item.serverLabel).join(', ')} unavailable`,
		);
	if (notHeld.length > 0)
		parts.push(
			`${notHeld.map((item) => item.serverLabel).join(', ')} not counted until opened`,
		);
	return parts.join(' · ');
}

function EditTools({
	item,
	isFirst,
	isLast,
	onMove,
	onResize,
	onHide,
}: Readonly<{
	item: ResolvedHomeWidget;
	isFirst: boolean;
	isLast: boolean;
	onMove: (delta: number) => void;
	onResize: (size: HomeDashboardWidgetSize) => void;
	onHide: () => void;
}>) {
	const title = item.definition.title;
	return (
		<div
			className="home-widget__tools"
			data-terminay-home-widget-tools={item.id}
		>
			<span className="home-widget__grip" aria-hidden="true">
				<GripVertical size={13} />
			</span>
			<button
				type="button"
				className="home-widget__tool"
				aria-label={`Move ${title} earlier`}
				data-terminay-home-widget-move="earlier"
				disabled={isFirst}
				onClick={() => onMove(-1)}
			>
				<ChevronLeft size={13} aria-hidden="true" />
			</button>
			<button
				type="button"
				className="home-widget__tool"
				aria-label={`Move ${title} later`}
				data-terminay-home-widget-move="later"
				disabled={isLast}
				onClick={() => onMove(1)}
			>
				<ChevronRight size={13} aria-hidden="true" />
			</button>
			<span className="home-widget__tool-sep" aria-hidden="true" />
			<fieldset className="home-widget__sizes">
				<legend className="home-sr-only">{`${title} size`}</legend>
				{item.definition.sizes.map((size) => (
					<button
						key={size}
						type="button"
						aria-pressed={item.size === size}
						aria-label={SIZE_LABELS[size]}
						title={SIZE_LABELS[size]}
						data-terminay-home-widget-resize={size}
						className={`home-widget__tool${item.size === size ? ' home-widget__tool--on' : ''}`}
						onClick={() => onResize(size)}
					>
						{SIZE_LABELS[size].slice(0, 1)}
					</button>
				))}
			</fieldset>
			<span className="home-widget__tool-sep" aria-hidden="true" />
			<button
				type="button"
				className="home-widget__tool"
				aria-label={`Hide ${title}`}
				data-terminay-home-widget-hide="true"
				onClick={onHide}
			>
				<EyeOff size={13} aria-hidden="true" />
			</button>
		</div>
	);
}

function WidgetFrame({
	item,
	overview,
	editing,
	tools,
	children,
	dragProps,
	isDropTarget,
	isDragging,
}: Readonly<{
	item: ResolvedHomeWidget;
	overview: HomeOverviewModel;
	editing: boolean;
	tools: ReactNode;
	children: ReactNode;
	dragProps: Record<string, unknown>;
	isDropTarget: boolean;
	isDragging: boolean;
}>) {
	const spec = WIDGETS[item.id];
	const Icon = spec.icon;
	const meta = spec.meta?.(overview);
	const note = describeUnavailable(spec.unavailable?.(overview) ?? []);
	const urgent = spec.urgent?.(overview) === true;
	const classes = [
		'home-widget',
		`home-widget--${item.size}`,
		urgent ? 'home-widget--urgent' : '',
		editing ? 'home-widget--editing' : '',
		isDropTarget ? 'home-widget--drop-target' : '',
		isDragging ? 'home-widget--dragging' : '',
	]
		.filter(Boolean)
		.join(' ');
	return (
		<section
			className={classes}
			data-terminay-home-widget={item.id}
			data-terminay-home-widget-size={item.size}
			aria-label={item.definition.title}
			{...dragProps}
		>
			{tools}
			<header className="home-widget__title">
				<span className="home-widget__chip" aria-hidden="true">
					<Icon size={13} aria-hidden="true" />
				</span>
				<h3 className="home-widget__heading">{item.definition.title}</h3>
				{meta === undefined || editing ? null : (
					<span className="home-widget__meta">{meta}</span>
				)}
			</header>
			<div className="home-widget__body" inert={editing ? true : undefined}>
				{children}
			</div>
			{note === undefined ? null : (
				<span
					className="home-widget__unavailable"
					data-terminay-home-widget-unavailable="true"
				>
					{note}
				</span>
			)}
		</section>
	);
}

export function HomeOverview({
	actions,
	layout,
	layoutSaveFailed = false,
	now = Date.now(),
	onLayoutChange,
	overview,
	recordings,
}: HomeOverviewProps) {
	const [editing, setEditing] = useState(false);
	const [dragging, setDragging] = useState<string>();
	const [dropTarget, setDropTarget] = useState<string>();
	const shown = visibleWidgets(layout);
	const hidden = hiddenWidgets(layout);
	const props: HomeWidgetProps = { overview, actions, recordings, now };

	const dragPropsFor = (id: string): Record<string, unknown> =>
		editing
			? {
					draggable: true,
					onDragStart: (event: DragEvent) => {
						event.dataTransfer.effectAllowed = 'move';
						event.dataTransfer.setData('text/plain', id);
						setDragging(id);
					},
					onDragEnd: () => {
						setDragging(undefined);
						setDropTarget(undefined);
					},
					onDragOver: (event: DragEvent) => {
						if (dragging === undefined || dragging === id) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = 'move';
						if (dropTarget !== id) setDropTarget(id);
					},
					onDrop: (event: DragEvent) => {
						event.preventDefault();
						const moving = dragging;
						setDragging(undefined);
						setDropTarget(undefined);
						if (moving === undefined || moving === id) return;
						// Dropping on a later widget puts the dragged one after it, so a
						// drag to the right moves right; on an earlier one, before it.
						const order = shown.map((item) => item.id as string);
						const from = order.indexOf(moving);
						const to = order.indexOf(id);
						const before = from < to ? (order[to + 1] ?? null) : id;
						onLayoutChange(moveWidgetBefore(layout, moving, before));
					},
				}
			: {};

	return (
		<div
			className={`home-section home-overview${editing ? ' home-overview--editing' : ''}`}
			data-terminay-home-overview
			data-terminay-home-overview-editing={editing ? 'true' : undefined}
		>
			<header className="home-section__header home-overview__header">
				<div className="home-overview__heading-box">
					<h2 className="home-section__heading">Home</h2>
					<p className="home-section__subheading">
						{editing
							? 'Drag widgets or use the arrows to reorder. S, W, and T set the size.'
							: 'Your workspace at a glance.'}
					</p>
				</div>
				{layoutSaveFailed ? (
					<span
						className="home-overview__save-failed"
						role="status"
						data-terminay-home-layout-save-failed
					>
						Couldn't save the layout.
					</span>
				) : null}
				<div className="home-overview__header-actions">
					{editing ? (
						<>
							<button
								type="button"
								className="home-overview__button"
								data-terminay-home-layout-reset
								onClick={() => onLayoutChange(resetLayout(layout))}
							>
								<RotateCcw size={14} aria-hidden="true" />
								Reset
							</button>
							<button
								type="button"
								className="home-overview__button home-overview__button--primary"
								data-terminay-home-layout-done
								onClick={() => setEditing(false)}
							>
								<Check size={14} aria-hidden="true" />
								Done
							</button>
						</>
					) : (
						<button
							type="button"
							className="home-overview__button"
							data-terminay-home-customise
							onClick={() => setEditing(true)}
						>
							<LayoutGrid size={14} aria-hidden="true" />
							Customise
						</button>
					)}
				</div>
			</header>
			<div className="home-overview__grid">
				{shown.map((item, index) => {
					const spec = WIDGETS[item.id];
					const Body = spec.Body;
					return (
						<WidgetFrame
							key={item.id}
							item={item}
							overview={overview}
							editing={editing}
							isDragging={dragging === item.id}
							isDropTarget={dropTarget === item.id}
							dragProps={dragPropsFor(item.id)}
							tools={
								editing ? (
									<EditTools
										item={item}
										isFirst={index === 0}
										isLast={index === shown.length - 1}
										onMove={(delta) =>
											onLayoutChange(moveWidgetBy(layout, item.id, delta))
										}
										onResize={(size) =>
											onLayoutChange(setWidgetSize(layout, item.id, size))
										}
										onHide={() =>
											onLayoutChange(setWidgetHidden(layout, item.id, true))
										}
									/>
								) : null
							}
						>
							<Body {...props} />
						</WidgetFrame>
					);
				})}
				{shown.length === 0 ? (
					<p className="home-overview__none">
						Every widget is hidden. Choose Customise to add some back.
					</p>
				) : null}
			</div>
			{editing ? (
				<section
					className="home-overview__tray"
					aria-label="Hidden widgets"
					data-terminay-home-hidden-widgets
				>
					<h3 className="home-overview__tray-heading">Hidden widgets</h3>
					{hidden.length === 0 ? (
						<p className="home-overview__tray-empty">Every widget is shown.</p>
					) : (
						<div className="home-overview__tray-items">
							{hidden.map((item) => (
								<button
									key={item.id}
									type="button"
									className="home-overview__add"
									data-terminay-home-widget-add={item.id}
									onClick={() =>
										onLayoutChange(setWidgetHidden(layout, item.id, false))
									}
								>
									<Plus size={13} aria-hidden="true" />
									{item.definition.title}
								</button>
							))}
						</div>
					)}
				</section>
			) : null}
		</div>
	);
}
