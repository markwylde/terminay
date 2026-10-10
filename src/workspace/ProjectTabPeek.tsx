import {
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FoldersTree } from '../components/folders/FoldersTree';
import type { FolderTreeFolderRow } from './folderTreeModel';
import {
	createProjectTabPeekController,
	type ProjectTabPeekState,
} from './projectTabPeekModel';

/** A project tab in the strip. Tabs that have overflowed into the switcher
 * are not tabs anyone can rest the pointer on. */
const TAB_SELECTOR = '.project-tabbar-list [role="tab"][data-tab-handle]';
const HOVER_QUERY = '(hover: hover)';
const PEEK_WIDTH = 280;

export type ProjectTabPeekProps = {
	/** The tab in front, or null while Home is. */
	activeTabId: string | null;
	/** A project tab or a terminal is being dragged, as the window knows it. */
	isDragging: boolean;
	/** The Folders tree of one tab's project, or null when it has none to show. */
	foldersOf: (tabId: string) => readonly FolderTreeFolderRow[] | null;
	onChooseFolder: (tabId: string, folderId: string) => void;
	onChooseTerminal: (tabId: string, folderId: string, panelId: string) => void;
};

function tabOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element
		? target.closest<HTMLElement>(TAB_SELECTOR)
		: null;
}

function tabElement(tabId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`.project-tabbar-list [role="tab"][data-tab-handle="${CSS.escape(tabId)}"]`,
	);
}

/**
 * The peek under a project tab that is not in front: that project's Folders
 * tree, for going straight to one of its terminals.
 *
 * A project tab is pressed to switch, dragged to reorder, torn off into a
 * window, and dropped on. So this component adds nothing to a tab. It listens
 * at the document, never stops or cancels an event, and draws in a portal:
 * the tab's own pointer and drag handling cannot tell it is here. When it is
 * open is decided by `projectTabPeekModel`; this only reports what happened
 * and draws the answer.
 */
export function ProjectTabPeek({
	activeTabId,
	isDragging,
	foldersOf,
	onChooseFolder,
	onChooseTerminal,
}: ProjectTabPeekProps) {
	const [state, setState] = useState<ProjectTabPeekState>({
		openTabId: null,
		viaKeyboard: false,
	});
	const controllerRef = useRef<ReturnType<
		typeof createProjectTabPeekController
	> | null>(null);
	if (controllerRef.current === null)
		controllerRef.current = createProjectTabPeekController({
			timer: {
				set: (callback, delayMs) => window.setTimeout(callback, delayMs),
				clear: (handle) => window.clearTimeout(handle as number),
			},
			onChange: setState,
		});
	const controller = controllerRef.current;
	const peekRef = useRef<HTMLDivElement | null>(null);

	const [canHover, setCanHover] = useState(
		() => window.matchMedia(HOVER_QUERY).matches,
	);
	// Drags the window does not report: a tab of another server being
	// reordered, which the strip marks on the body, and any HTML5 drag, which
	// is how a terminal tab or a Folders row travels.
	const [isReordering, setIsReordering] = useState(false);
	const [isNativeDrag, setIsNativeDrag] = useState(false);

	useEffect(() => {
		const query = window.matchMedia(HOVER_QUERY);
		const onChange = () => setCanHover(query.matches);
		query.addEventListener('change', onChange);
		const body = document.body;
		const readReordering = () =>
			setIsReordering(body.classList.contains('project-tabbar-reordering'));
		const observer = new MutationObserver(readReordering);
		observer.observe(body, { attributes: true, attributeFilter: ['class'] });
		readReordering();
		const dragStarted = () => setIsNativeDrag(true);
		const dragEnded = () => setIsNativeDrag(false);
		// Capture, so a handler that stops the event further in cannot hide it.
		document.addEventListener('dragstart', dragStarted, true);
		document.addEventListener('dragend', dragEnded, true);
		document.addEventListener('drop', dragEnded, true);
		return () => {
			query.removeEventListener('change', onChange);
			observer.disconnect();
			document.removeEventListener('dragstart', dragStarted, true);
			document.removeEventListener('dragend', dragEnded, true);
			document.removeEventListener('drop', dragEnded, true);
		};
	}, []);

	useEffect(() => {
		controller.setEnvironment({
			activeTabId,
			isDragging: isDragging || isReordering || isNativeDrag,
			canHover,
		});
	}, [activeTabId, canHover, controller, isDragging, isNativeDrag, isReordering]);

	useEffect(() => {
		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return;
			const tab = tabOf(event.target);
			// Moving between a tab's own title and close button is not arriving.
			if (tab === null || tab === tabOf(event.relatedTarget)) return;
			const tabId = tab.dataset.tabHandle;
			if (tabId) controller.pointerEnteredTab(tabId);
		};
		const onPointerOut = (event: PointerEvent) => {
			const tab = tabOf(event.target);
			if (tab === null || tab === tabOf(event.relatedTarget)) return;
			const tabId = tab.dataset.tabHandle;
			if (tabId) controller.pointerLeftTab(tabId);
		};
		// Only observed: the press goes on to the tab untouched, and is what
		// switches project or starts a reorder or a tear-off.
		const onPointerDown = (event: PointerEvent) => {
			if (tabOf(event.target) !== null) controller.pointerDownOnTab();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				const { openTabId, viaKeyboard } = controller.state;
				if (openTabId === null) return;
				controller.close();
				if (viaKeyboard) tabElement(openTabId)?.focus();
				return;
			}
			if (event.key !== 'ArrowDown') return;
			// The tab itself, not something inside it or inside the peek.
			const tab = event.target;
			if (!(tab instanceof HTMLElement) || !tab.matches(TAB_SELECTOR)) return;
			const tabId = tab.dataset.tabHandle;
			if (!tabId) return;
			controller.keyboardOpen(tabId);
			if (controller.state.openTabId === tabId) event.preventDefault();
		};
		document.addEventListener('pointerover', onPointerOver, true);
		document.addEventListener('pointerout', onPointerOut, true);
		document.addEventListener('pointerdown', onPointerDown, {
			capture: true,
			passive: true,
		});
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerover', onPointerOver, true);
			document.removeEventListener('pointerout', onPointerOut, true);
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, [controller]);

	useEffect(() => () => controller.dispose(), [controller]);

	const { openTabId, viaKeyboard } = state;
	const folders = openTabId === null ? null : foldersOf(openTabId);
	const anchor = openTabId === null ? null : tabElement(openTabId);
	const isShown = openTabId !== null && folders !== null && anchor !== null;

	// A tab that has gone, overflowed, or has no projection has no peek.
	useEffect(() => {
		if (openTabId !== null && !isShown) controller.close();
	}, [controller, isShown, openTabId]);

	// The keyboard opened it, so the keyboard is given its first row.
	useLayoutEffect(() => {
		if (!isShown || !viaKeyboard) return;
		peekRef.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
	}, [isShown, viaKeyboard]);

	if (!isShown || openTabId === null || folders === null || anchor === null)
		return null;

	const rect = anchor.getBoundingClientRect();
	const style: CSSProperties = {
		top: rect.bottom,
		left: Math.max(8, Math.min(rect.left, window.innerWidth - PEEK_WIDTH - 8)),
		width: PEEK_WIDTH,
		'--project-color': anchor.style.getPropertyValue('--project-color'),
	} as CSSProperties;
	const tabId = openTabId;

	return createPortal(
		// The handlers here only keep the peek open while it is in use; the rows
		// inside are the controls.
		<div
			ref={peekRef}
			className="project-tab-peek"
			data-terminay-project-tab-peek={tabId}
			style={style}
			onPointerEnter={() => controller.pointerEnteredPeek()}
			onPointerLeave={() => controller.pointerLeftPeek()}
			onBlur={(event) => {
				// Focus that leaves a keyboard peek for anywhere but its own tab
				// has finished with it.
				if (!viaKeyboard) return;
				const next = event.relatedTarget;
				if (
					next instanceof Node &&
					(event.currentTarget.contains(next) || anchor.contains(next))
				)
					return;
				controller.close();
			}}
		>
			{folders.length === 0 ? (
				<div className="project-tab-peek__empty">No folders</div>
			) : (
				<FoldersTree
					variant="peek"
					folders={folders}
					onSelectFolder={(folderId) => {
						controller.close();
						onChooseFolder(tabId, folderId);
					}}
					onSelectPanel={(folderId, panelId) => {
						controller.close();
						onChooseTerminal(tabId, folderId, panelId);
					}}
				/>
			)}
		</div>,
		document.body,
	);
}
