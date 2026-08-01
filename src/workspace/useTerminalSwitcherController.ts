import type { DockviewApi } from 'dockview';
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

export const OPEN_TERMINAL_SWITCHER_EVENT = 'terminay-open-terminal-switcher';

export type TerminalSwitcherItem = {
	color: string;
	emoji: string;
	panelId: string;
	sessionId: string;
	title: string;
};

type DockviewGroup = DockviewApi['groups'][number];

type PositionedDockviewGroup = {
	group: DockviewGroup;
	left: number;
	top: number;
};

export function wrapTerminalSwitcherIndex(
	currentIndex: number,
	direction: 1 | -1,
	itemCount: number,
): number {
	if (itemCount <= 0) {
		return 0;
	}
	return (currentIndex + direction + itemCount) % itemCount;
}

export function getOrderedTerminalSwitcherItems(
	api: DockviewApi | null,
	targetWindow: Window,
): TerminalSwitcherItem[] {
	if (!api) {
		return [];
	}

	return api.groups
		.map((group): PositionedDockviewGroup | null => {
			const referencePanel = group.activePanel ?? group.panels[0];
			if (!referencePanel) {
				return null;
			}

			try {
				if (referencePanel.api.getWindow() !== targetWindow) {
					return null;
				}
			} catch {
				return null;
			}

			const rect = group.element.getBoundingClientRect();
			return { group, left: rect.left, top: rect.top };
		})
		.filter((entry): entry is PositionedDockviewGroup => entry !== null)
		.sort((a, b) => {
			const verticalDistance = Math.abs(a.top - b.top);
			return verticalDistance > 24 ? a.top - b.top : a.left - b.left;
		})
		.flatMap(({ group }) =>
			group.panels.map((panel) => ({
				color: panel.params?.color ?? '#4db5ff',
				emoji: panel.params?.emoji ?? '',
				panelId: panel.id,
				sessionId: panel.params?.sessionId ?? '',
				title: panel.title ?? 'Terminal',
			})),
		)
		.filter((panel) => panel.sessionId.length > 0);
}

type UseTerminalSwitcherControllerOptions = {
	apiRef: MutableRefObject<DockviewApi | null>;
	blocked: boolean;
	isActive: boolean;
	onClearError: () => void;
};

export function useTerminalSwitcherController({
	apiRef,
	blocked,
	isActive,
	onClearError,
}: UseTerminalSwitcherControllerOptions) {
	const [items, setItems] = useState<TerminalSwitcherItem[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const selectedIndexRef = useRef(0);

	const close = useCallback(() => {
		selectedIndexRef.current = 0;
		setIsOpen(false);
		setItems([]);
		setSelectedIndex(0);
	}, []);

	const commit = useCallback(() => {
		const selectedPanel = items[selectedIndexRef.current];
		close();
		if (!selectedPanel) {
			return;
		}

		apiRef.current?.getPanel(selectedPanel.panelId)?.api.setActive();
		onClearError();
		window.requestAnimationFrame(() => {
			window.dispatchEvent(
				new CustomEvent('terminay-focus-terminal', {
					detail: { sessionId: selectedPanel.sessionId },
				}),
			);
		});
	}, [apiRef, close, items, onClearError]);

	const move = useCallback(
		(direction: 1 | -1) => {
			if (items.length <= 1) {
				return;
			}
			const nextIndex = wrapTerminalSwitcherIndex(
				selectedIndexRef.current,
				direction,
				items.length,
			);
			selectedIndexRef.current = nextIndex;
			setSelectedIndex(nextIndex);
		},
		[items],
	);

	const open = useCallback(
		(direction: 1 | -1 = 1) => {
			const nextItems = getOrderedTerminalSwitcherItems(
				apiRef.current,
				window,
			);
			if (nextItems.length <= 1) {
				return;
			}

			const activePanelId = apiRef.current?.activePanel?.id;
			const activeIndex = activePanelId
				? nextItems.findIndex((item) => item.panelId === activePanelId)
				: -1;
			const startIndex = activeIndex >= 0 ? activeIndex : 0;
			const nextIndex = wrapTerminalSwitcherIndex(
				startIndex,
				direction,
				nextItems.length,
			);

			selectedIndexRef.current = nextIndex;
			setItems(nextItems);
			setSelectedIndex(nextIndex);
			setIsOpen(true);
		},
		[apiRef],
	);

	const select = useCallback((index: number) => {
		selectedIndexRef.current = index;
		setSelectedIndex(index);
	}, []);

	const selectAndCommit = useCallback(
		(index: number) => {
			selectedIndexRef.current = index;
			setSelectedIndex(index);
			// Commit reads the ref, so the selection is synchronous even though
			// React batches the visual state update.
			commit();
		},
		[commit],
	);

	useEffect(() => {
		if (!isActive || blocked) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}
			if (
				event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				event.key === 'Tab'
			) {
				const target = event.target;
				if (
					target instanceof HTMLElement &&
					(target.closest('.terminal-panel') ||
						target.closest('.xterm') ||
						target.classList.contains('xterm-helper-textarea'))
				) {
					return;
				}
				event.preventDefault();
				if (event.repeat) {
					return;
				}
				isOpen ? move(event.shiftKey ? -1 : 1) : open(event.shiftKey ? -1 : 1);
				return;
			}
			if (isOpen && event.key === 'Escape') {
				event.preventDefault();
				close();
			}
		};

		const onSwitcherRequest = (event: Event) => {
			const customEvent = event as CustomEvent<{ direction?: 1 | -1 }>;
			const direction = customEvent.detail?.direction === -1 ? -1 : 1;
			isOpen ? move(direction) : open(direction);
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (isOpen && event.key === 'Alt') {
				event.preventDefault();
				commit();
			}
		};
		const onBlur = () => {
			if (isOpen) {
				commit();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener(OPEN_TERMINAL_SWITCHER_EVENT, onSwitcherRequest);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener(
				OPEN_TERMINAL_SWITCHER_EVENT,
				onSwitcherRequest,
			);
			window.removeEventListener('blur', onBlur);
		};
	}, [blocked, close, commit, isActive, isOpen, move, open]);

	return {
		close,
		commit,
		isOpen,
		items,
		move,
		open,
		select,
		selectAndCommit,
		selectedIndex,
	};
}
