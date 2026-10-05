/**
 * Home's tabs.
 *
 * Home presents what it holds the way a project presents its panels: tabs in a
 * strip, that can be opened, closed, reordered, and arranged side by side. It
 * does so in a tab host of its own. A project's host holds server-owned panels
 * and closes them on the server; this one holds views that only this device
 * knows about, so it shares none of that lifecycle (ADR-0040). Closing a Home
 * tab never closes, stops, or deletes what the tab shows.
 *
 * Every tab stays rendered while another is in front, and Home itself, once
 * shown, stays mounted while a project is in front, so a half-written automation is still
 * there when the person comes back to it.
 */

import {
	type DockviewApi,
	DockviewReact,
	type DockviewReadyEvent,
	type IDockviewPanelHeaderProps,
	type IDockviewPanelProps,
} from 'dockview';
import { SquareTerminal, Workflow, X } from 'lucide-react';
import {
	createContext,
	forwardRef,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	AutomationDetailPanel,
	AutomationEditorPanel,
	AutomationRunPanel,
	type AutomationsData,
	AutomationsListPanel,
	type AutomationTabHost,
	type AutomationTabTarget,
	AutomationTerminalPanel,
} from './automations/AutomationPanels';
import type { AutomationForm } from './automations/automationsModel';
import { HOME_SECTION_ICONS, HomeView } from './HomeView';
import {
	HOME_SECTION_LABELS,
	HOME_SECTIONS,
	type HomeSection,
} from './homeSection.ts';
import {
	defaultHomeTabTitle,
	HOME_TAB_COMPONENT,
	HOME_TAB_TAB_COMPONENT,
	type HomeTabDescriptor,
	homeTabId,
	homeTabSection,
	parseHomeTabId,
} from './homeTabs.ts';
import {
	recallDefaultHomeTab,
	recallHomeLayout,
	rememberHomeLayout,
} from './localViewState.ts';

type HomeTabParams = Readonly<{
	descriptor: HomeTabDescriptor;
	/** What a new automation starts from. Never restored. */
	form?: Partial<AutomationForm>;
}>;

type HomeTabsContextValue = Readonly<{
	automations: AutomationsData;
	commandBarShortcutLabel?: string;
	dirtyIds: ReadonlySet<string>;
	isCompact: boolean;
	forceClose: (id: string, why?: string) => void;
	onOpenCommandBar: () => void;
	openSection: (section: HomeSection) => void;
	openTarget: (target: AutomationTabTarget, from?: string) => void;
	renderSection: (section: 'home' | 'tabs') => ReactNode;
	requestClose: (id: string) => void;
	setDirty: (id: string, dirty: boolean) => void;
}>;

const HomeTabsContext = createContext<HomeTabsContextValue | null>(null);

function useHomeTabs(): HomeTabsContextValue {
	const value = useContext(HomeTabsContext);
	if (value === null) throw new Error('A Home tab was drawn outside Home.');
	return value;
}

function descriptorIcon(descriptor: HomeTabDescriptor): ReactNode {
	switch (descriptor.kind) {
		case 'section':
			return HOME_SECTION_ICONS[descriptor.section];
		case 'automation-terminal':
			return <SquareTerminal size={15} aria-hidden="true" />;
		default:
			return <Workflow size={15} aria-hidden="true" />;
	}
}

/** The content of one Home tab. */
function HomeTabPanel({ api, params }: IDockviewPanelProps<HomeTabParams>) {
	const home = useHomeTabs();
	const { descriptor } = params;
	const id = api.id;
	const { forceClose, isCompact, openTarget, requestClose, setDirty } = home;
	const host = useMemo<AutomationTabHost>(
		() => ({
			close: (why) => forceClose(id, why),
			compact: isCompact,
			open: (target) => openTarget(target, id),
			requestClose: () => requestClose(id),
			setDirty: (dirty) => setDirty(id, dirty),
			setTitle: (title) => {
				if (api.title !== title) api.setTitle(title);
			},
		}),
		[api, forceClose, id, isCompact, openTarget, requestClose, setDirty],
	);
	const data = home.automations;
	// Every tab stays rendered; this says which are on screen.
	const [isVisible, setIsVisible] = useState(api.isVisible);
	useEffect(() => {
		setIsVisible(api.isVisible);
		const subscription = api.onDidVisibilityChange((event) =>
			setIsVisible(event.isVisible),
		);
		return () => subscription.dispose();
	}, [api]);

	let content: ReactNode;
	switch (descriptor.kind) {
		case 'section':
			content =
				descriptor.section === 'automations' ? (
					<AutomationsListPanel data={data} host={host} />
				) : (
					home.renderSection(descriptor.section)
				);
			break;
		case 'automation':
			content = (
				<AutomationDetailPanel
					data={data}
					host={host}
					serverId={descriptor.serverId}
					automationId={descriptor.automationId}
				/>
			);
			break;
		case 'automation-edit':
			content = (
				<AutomationEditorPanel
					data={data}
					host={host}
					serverId={descriptor.serverId}
					automationId={descriptor.automationId}
				/>
			);
			break;
		case 'automation-new':
			content = (
				<AutomationEditorPanel
					data={data}
					host={host}
					serverId={descriptor.serverId}
					{...(params.form === undefined ? {} : { initialForm: params.form })}
				/>
			);
			break;
		case 'run':
			content = (
				<AutomationRunPanel
					data={data}
					host={host}
					serverId={descriptor.serverId}
					automationId={descriptor.automationId}
					runId={descriptor.runId}
				/>
			);
			break;
		case 'automation-terminal':
			content = (
				<AutomationTerminalPanel
					data={data}
					host={host}
					serverId={descriptor.serverId}
					panelId={descriptor.panelId}
				/>
			);
			break;
	}

	return (
		<div
			className="home-tab-panel"
			role="tabpanel"
			aria-label={api.title ?? defaultHomeTabTitle(descriptor)}
			data-terminay-home-tab-panel={id}
			data-terminay-home-tab-visible={isVisible ? 'true' : 'false'}
			{...(descriptor.kind === 'section'
				? { 'data-terminay-home-section': descriptor.section }
				: {})}
		>
			{content}
		</div>
	);
}

/** One Home tab's chip in the strip: icon, title, unsaved mark, close. */
function HomeTabChip({ api, params }: IDockviewPanelHeaderProps<HomeTabParams>) {
	const home = useHomeTabs();
	const [title, setTitle] = useState(api.title ?? '');
	useEffect(() => {
		setTitle(api.title ?? '');
		const subscription = api.onDidTitleChange((event) => setTitle(event.title));
		return () => subscription.dispose();
	}, [api]);
	const dirty = home.dirtyIds.has(api.id);
	return (
		<div
			className="home-tab"
			data-terminay-home-tab={api.id}
			data-terminay-home-tab-dirty={dirty ? 'true' : 'false'}
			title={title}
			onAuxClick={(event) => {
				if (event.button !== 1) return;
				event.preventDefault();
				home.requestClose(api.id);
			}}
		>
			<span className="home-tab__icon">
				{descriptorIcon(params.descriptor)}
			</span>
			<span className="home-tab__title">{title}</span>
			{dirty ? (
				<span
					className="home-tab__dirty"
					role="img"
					aria-label="Unsaved edits"
					title="Unsaved edits"
				/>
			) : null}
			<button
				type="button"
				className="home-tab__close"
				aria-label={`Close ${title}`}
				data-terminay-home-tab-close={api.id}
				// The strip starts a drag on pointer down; the close button is not
				// a handle.
				onPointerDown={(event) => event.stopPropagation()}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					home.requestClose(api.id);
				}}
			>
				<X size={10} strokeWidth={2.5} aria-hidden="true" />
			</button>
		</div>
	);
}

/** What Home shows with every tab closed. */
function HomeEmptyState() {
	const home = useHomeTabs();
	return (
		<div className="home-empty" data-terminay-home-empty="true">
			<h2 className="home-empty__title">Nothing open in Home</h2>
			<p className="home-empty__text">Open a section to get started.</p>
			<div className="home-empty__sections">
				{HOME_SECTIONS.map((section) => (
					<button
						key={section}
						type="button"
						className="home-empty__section"
						aria-label={`Open ${HOME_SECTION_LABELS[section]}`}
						data-terminay-home-empty-section={section}
						onClick={() => home.openSection(section)}
					>
						{HOME_SECTION_ICONS[section]}
						{HOME_SECTION_LABELS[section]}
					</button>
				))}
			</div>
			<button
				type="button"
				className="home-empty__search"
				data-terminay-home-empty-command-bar="true"
				onClick={home.onOpenCommandBar}
			>
				Search projects, tabs, agents, and automations
				{home.commandBarShortcutLabel ? (
					<kbd className="home-empty__key">{home.commandBarShortcutLabel}</kbd>
				) : null}
			</button>
		</div>
	);
}

const COMPONENTS = { [HOME_TAB_COMPONENT]: HomeTabPanel };
const TAB_COMPONENTS = { [HOME_TAB_TAB_COMPONENT]: HomeTabChip };

export type HomeWorkspaceHandle = Readonly<{
	/** Open a tab, or bring it to the front if it is already open. */
	open: (
		target:
			| AutomationTabTarget
			| Readonly<{ kind: 'section'; section: HomeSection }>,
	) => void;
	/**
	 * Close the tab in front as a person would. Returns whether there was one.
	 */
	requestCloseActiveTab: () => boolean;
}>;

export type HomeWorkspaceProps = Readonly<{
	automations: AutomationsData;
	/** The Command Bar's shortcut, for the empty state to mention. */
	commandBarShortcutLabel?: string;
	/** False while a project is in front. */
	isActive: boolean;
	/** No tab strip is drawn at this width. */
	isCompact: boolean;
	isSidebarVisible: boolean;
	onDismissSidebar: () => void;
	onOpenCommandBar: () => void;
	onSectionChosenInDrawer?: () => void;
	onSidebarWidthCommit: (width: number) => void;
	/** The Home overview and the Tabs dashboard, which the window composes. */
	renderSection: (section: 'home' | 'tabs') => ReactNode;
	sidebarWidth: number;
}>;

export const HomeWorkspace = forwardRef<
	HomeWorkspaceHandle,
	HomeWorkspaceProps
>(function HomeWorkspace(
	{
		automations,
		commandBarShortcutLabel,
		isActive,
		isCompact,
		isSidebarVisible,
		onDismissSidebar,
		onOpenCommandBar,
		onSectionChosenInDrawer,
		onSidebarWidthCommit,
		renderSection,
		sidebarWidth,
	},
	ref,
) {
	const apiRef = useRef<DockviewApi | null>(null);
	const [activeId, setActiveId] = useState<string>();
	const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
	const dirtyRef = useRef(dirtyIds);
	dirtyRef.current = dirtyIds;
	/** The tab a person asked to close while it held unsaved edits. */
	const [confirming, setConfirming] = useState<
		Readonly<{ id: string; title: string }>
	>();
	const [notice, setNotice] = useState<string>();
	const draftCounterRef = useRef(0);
	// Dockview disposing its panels on unmount or reload is not a person
	// closing them, and must not empty what the device remembers.
	const detachingRef = useRef(false);

	// Asked for before the tab host was ready — Home is mounted the first time
	// it is shown, and something may ask for a tab in that same moment.
	const pendingOpensRef = useRef<(() => void)[]>([]);

	const openDescriptor = useCallback(
		(
			descriptor: HomeTabDescriptor,
			options: Readonly<{ from?: string; form?: Partial<AutomationForm> }> = {},
		) => {
			const api = apiRef.current;
			if (api === null) {
				pendingOpensRef.current.push(() => openDescriptor(descriptor, options));
				return;
			}
			const id = homeTabId(descriptor);
			const existing = api.getPanel(id);
			if (existing !== undefined) {
				existing.api.setActive();
				return;
			}
			const reference =
				(options.from === undefined ? undefined : api.getPanel(options.from)) ??
				api.activePanel;
			api.addPanel<HomeTabParams>({
				component: HOME_TAB_COMPONENT,
				id,
				params: {
					descriptor,
					...(options.form === undefined ? {} : { form: options.form }),
				},
				// Kept rendered while another tab is in front, so nothing typed
				// into it is lost.
				renderer: 'always',
				tabComponent: HOME_TAB_TAB_COMPONENT,
				title: defaultHomeTabTitle(descriptor),
				...(reference === undefined
					? {}
					: { position: { referencePanel: reference.id } }),
			});
		},
		[],
	);

	const openTarget = useCallback(
		(target: AutomationTabTarget, from?: string) => {
			const options = from === undefined ? {} : { from };
			switch (target.kind) {
				case 'list':
					openDescriptor({ kind: 'section', section: 'automations' }, options);
					return;
				case 'automation':
					openDescriptor(
						{
							kind: 'automation',
							serverId: target.serverId,
							automationId: target.automationId,
						},
						options,
					);
					return;
				case 'edit':
					openDescriptor(
						{
							kind: 'automation-edit',
							serverId: target.serverId,
							automationId: target.automationId,
						},
						options,
					);
					return;
				case 'new':
					draftCounterRef.current += 1;
					openDescriptor(
						{
							kind: 'automation-new',
							serverId: target.serverId,
							draftId: String(draftCounterRef.current),
						},
						{
							...options,
							...(target.form === undefined ? {} : { form: target.form }),
						},
					);
					return;
				case 'run':
					openDescriptor(
						{
							kind: 'run',
							serverId: target.serverId,
							automationId: target.automationId,
							runId: target.runId,
						},
						options,
					);
					return;
				case 'terminal':
					openDescriptor(
						{
							kind: 'automation-terminal',
							serverId: target.serverId,
							panelId: target.panelId,
						},
						options,
					);
					return;
			}
		},
		[openDescriptor],
	);

	const openSection = useCallback(
		(section: HomeSection) => openDescriptor({ kind: 'section', section }),
		[openDescriptor],
	);

	const setDirty = useCallback((id: string, dirty: boolean) => {
		setDirtyIds((current) => {
			if (current.has(id) === dirty) return current;
			const next = new Set(current);
			if (dirty) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	const forceClose = useCallback((id: string, why?: string) => {
		const panel = apiRef.current?.getPanel(id);
		if (panel === undefined) return;
		if (why !== undefined && dirtyRef.current.has(id))
			setNotice(
				`Unsaved edits in “${panel.title ?? 'a tab'}” were dropped because ${why}.`,
			);
		setConfirming((current) => (current?.id === id ? undefined : current));
		panel.api.close();
	}, []);

	const requestClose = useCallback(
		(id: string) => {
			const panel = apiRef.current?.getPanel(id);
			if (panel === undefined) return;
			if (dirtyRef.current.has(id)) {
				panel.api.setActive();
				setConfirming({ id, title: panel.title ?? 'This tab' });
				return;
			}
			forceClose(id);
		},
		[forceClose],
	);

	useImperativeHandle(
		ref,
		() => ({
			open: (target) => {
				if (target.kind === 'section') openDescriptor(target);
				else openTarget(target);
			},
			requestCloseActiveTab: () => {
				const active = apiRef.current?.activePanel;
				if (active === undefined) return false;
				requestClose(active.id);
				return true;
			},
		}),
		[openDescriptor, openTarget, requestClose],
	);

	const handleReady = useCallback(
		(event: DockviewReadyEvent) => {
			const api = event.api;
			apiRef.current = api;
			const remembered = recallHomeLayout();
			if (remembered !== undefined) {
				try {
					// What a device remembers is a hint; a document this build
					// cannot load is simply no arrangement.
					api.fromJSON(remembered as never);
				} catch {
					api.clear();
				}
			}
			if (api.panels.length === 0) openDescriptor(recallDefaultHomeTab());
			for (const open of pendingOpensRef.current.splice(0)) open();
			setActiveId(api.activePanel?.id);

			let saveFrame: number | undefined;
			const remember = () => {
				if (detachingRef.current || saveFrame !== undefined) return;
				saveFrame = window.requestAnimationFrame(() => {
					saveFrame = undefined;
					if (!detachingRef.current) rememberHomeLayout(api.toJSON());
				});
			};
			api.onDidLayoutChange(remember);
			api.onDidActivePanelChange((panel) => {
				setActiveId(panel?.id);
				// Which tab is in front is part of what the device remembers.
				remember();
			});
			api.onDidRemovePanel((panel) => {
				setDirtyIds((current) => {
					if (!current.has(panel.id)) return current;
					const next = new Set(current);
					next.delete(panel.id);
					return next;
				});
			});
		},
		[openDescriptor],
	);

	useEffect(() => {
		const markDetaching = () => {
			detachingRef.current = true;
		};
		window.addEventListener('beforeunload', markDetaching);
		window.addEventListener('pagehide', markDetaching);
		return () => {
			detachingRef.current = true;
			window.removeEventListener('beforeunload', markDetaching);
			window.removeEventListener('pagehide', markDetaching);
		};
	}, []);

	// Where no tab strip is drawn there is room for one tab: the one in front
	// fills Home, whatever arrangement the device remembers.
	useEffect(() => {
		const api = apiRef.current;
		if (api === null) return;
		const active = api.activePanel;
		if (isCompact && active !== undefined) {
			if (!active.api.isMaximized()) api.maximizeGroup(active);
			return;
		}
		if (!isCompact && api.hasMaximizedGroup()) api.exitMaximizedGroup();
	}, [activeId, isCompact]);

	// Escape answers the discard question with the safe answer.
	useEffect(() => {
		if (confirming === undefined) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setConfirming(undefined);
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [confirming]);

	const activeDescriptor = parseHomeTabId(activeId);
	const currentSection =
		activeDescriptor === undefined ? undefined : homeTabSection(activeDescriptor);

	const context = useMemo<HomeTabsContextValue>(
		() => ({
			automations,
			dirtyIds,
			forceClose,
			isCompact,
			onOpenCommandBar,
			openSection,
			openTarget,
			renderSection,
			requestClose,
			setDirty,
			...(commandBarShortcutLabel === undefined
				? {}
				: { commandBarShortcutLabel }),
		}),
		[
			automations,
			commandBarShortcutLabel,
			dirtyIds,
			forceClose,
			isCompact,
			onOpenCommandBar,
			openSection,
			openTarget,
			renderSection,
			requestClose,
			setDirty,
		],
	);

	return (
		<HomeView
			currentSection={currentSection}
			isActive={isActive}
			isSidebarVisible={isSidebarVisible}
			onDismissSidebar={onDismissSidebar}
			onOpenSection={openSection}
			onSidebarWidthCommit={onSidebarWidthCommit}
			sidebarWidth={sidebarWidth}
			{...(onSectionChosenInDrawer === undefined
				? {}
				: { onSectionChosenInDrawer })}
		>
			<HomeTabsContext.Provider value={context}>
				{notice === undefined ? null : (
					<div
						className="home-notice"
						role="status"
						data-terminay-home-notice="true"
					>
						<span>{notice}</span>
						<button
							type="button"
							className="home-notice__dismiss"
							aria-label="Dismiss"
							onClick={() => setNotice(undefined)}
						>
							<X size={12} aria-hidden="true" />
						</button>
					</div>
				)}
				<div
					className={`home-tabs workspace dockview-theme-dark${isCompact ? ' workspace--compact-chrome' : ''}`}
					data-terminay-home-tabs="true"
				>
					<DockviewReact
						components={COMPONENTS}
						tabComponents={TAB_COMPONENTS}
						watermarkComponent={HomeEmptyState}
						disableFloatingGroups
						onReady={handleReady}
					/>
				</div>
				{confirming === undefined ? null : (
					<div
						className="home-confirm-overlay"
						onClick={() => setConfirming(undefined)}
					>
						<div
							className="home-confirm"
							role="alertdialog"
							aria-modal="true"
							aria-label="Discard unsaved edits"
							data-terminay-home-discard-dialog={confirming.id}
							onClick={(event) => event.stopPropagation()}
						>
							<p className="home-confirm__text">
								“{confirming.title}” has unsaved edits. Closing it discards
								them.
							</p>
							<div className="home-confirm__actions">
								<button
									type="button"
									className="automations-button"
									data-terminay-home-keep-editing="true"
									autoFocus
									onClick={() => setConfirming(undefined)}
								>
									Keep editing
								</button>
								<button
									type="button"
									className="automations-button automations-button--danger"
									data-terminay-home-discard="true"
									onClick={() => forceClose(confirming.id)}
								>
									Discard
								</button>
							</div>
						</div>
					</div>
				)}
			</HomeTabsContext.Provider>
		</HomeView>
	);
});
