import type { DockviewApi } from 'dockview';
import { getPanelData } from 'dockview';
import { type MutableRefObject, useEffect } from 'react';
import type { AiTabMetadataTarget } from '../types/terminay';
import type { AddTerminalOptions } from './useTerminalCreationController';

type DraggingDockviewTransfer = {
	panelId?: string;
	groupId: string;
};

type UseTerminalDockviewWindowControllerOptions = {
	addTerminal: (options?: AddTerminalOptions) => Promise<unknown>;
	apiRef: MutableRefObject<DockviewApi | null>;
	draggingTransferRef: MutableRefObject<DraggingDockviewTransfer | null>;
	isActive: boolean;
	openTerminalEditWindow: (panelId: string) => Promise<unknown>;
	openProfileChooser: () => Promise<void>;
	popoutUrl: string;
	runAiTabMetadataRef: MutableRefObject<
		(target: AiTabMetadataTarget, panelId?: string) => Promise<unknown>
	>;
};

export function useTerminalDockviewWindowController({
	addTerminal,
	apiRef,
	draggingTransferRef,
	isActive,
	openTerminalEditWindow,
	openProfileChooser,
	popoutUrl,
	runAiTabMetadataRef,
}: UseTerminalDockviewWindowControllerOptions): void {
	useEffect(() => {
		if (!isActive) {
			return;
		}

		const cleanupByWindow = new Map<Window, () => void>();
		const apiDisposables: Array<{ dispose: () => void }> = [];

		const addTerminalInHeaderSpace = (
			targetWindow: Window,
			target: HTMLElement | null,
			point?: { x: number; y: number },
		) => {
			const api = apiRef.current;
			if (!api) {
				return;
			}

			let groupElement: HTMLElement | null = target?.closest(
				'.dv-groupview',
			) as HTMLElement | null;

			const emptyHeaderSpace = target?.closest(
				'.dv-void-container',
			) as HTMLElement | null;
			if (emptyHeaderSpace) {
				groupElement = emptyHeaderSpace.closest(
					'.dv-groupview',
				) as HTMLElement | null;
			}

			if (!groupElement && point) {
				const hitElements = targetWindow.document.elementsFromPoint(
					point.x,
					point.y,
				);
				const emptySpaceFromPoint = hitElements.find(
					(element): element is HTMLElement =>
						element instanceof HTMLElement &&
						element.classList.contains('dv-void-container'),
				);

				if (emptySpaceFromPoint) {
					groupElement = emptySpaceFromPoint.closest(
						'.dv-groupview',
					) as HTMLElement | null;
				}
			}

			if (!groupElement && point) {
				const hitElements = targetWindow.document.elementsFromPoint(
					point.x,
					point.y,
				);
				const headerContainer = hitElements.find(
					(element): element is HTMLElement =>
						element instanceof HTMLElement &&
						element.classList.contains('dv-tabs-and-actions-container'),
				);

				if (headerContainer) {
					const headerRect = headerContainer.getBoundingClientRect();
					const inHeader =
						point.x >= headerRect.left &&
						point.x <= headerRect.right &&
						point.y >= headerRect.top &&
						point.y <= headerRect.bottom;

					const tabsContainer = headerContainer.querySelector(
						'.dv-tabs-container',
					) as HTMLElement | null;
					const rightActions = headerContainer.querySelector(
						'.dv-right-actions-container',
					) as HTMLElement | null;

					const inTabs = (() => {
						if (!tabsContainer) {
							return false;
						}

						const tabsRect = tabsContainer.getBoundingClientRect();
						return (
							point.x >= tabsRect.left &&
							point.x <= tabsRect.right &&
							point.y >= tabsRect.top &&
							point.y <= tabsRect.bottom
						);
					})();

					const inRightActions = (() => {
						if (!rightActions) {
							return false;
						}

						const actionsRect = rightActions.getBoundingClientRect();
						return (
							point.x >= actionsRect.left &&
							point.x <= actionsRect.right &&
							point.y >= actionsRect.top &&
							point.y <= actionsRect.bottom
						);
					})();

					if (inHeader && !inTabs && !inRightActions) {
						groupElement = headerContainer.closest(
							'.dv-groupview',
						) as HTMLElement | null;
					}
				}
			}

			if (!groupElement) {
				void addTerminal({});
				return;
			}

			const group = api.groups.find((candidate) =>
				candidate.element.contains(groupElement),
			);
			if (!group) {
				void addTerminal({});
				return;
			}

			void addTerminal({ groupId: group.id });
		};

		const isEmptyHeaderDoubleClick = (
			targetWindow: Window,
			target: HTMLElement | null,
			point: { x: number; y: number },
		): boolean => {
			if (
				target?.closest('.terminay-add-tab-button') ||
				target?.closest('.dv-tab') ||
				target?.closest('.dv-right-actions-container')
			) {
				return false;
			}

			const hitElements = targetWindow.document.elementsFromPoint(
				point.x,
				point.y,
			);
			if (
				hitElements.some(
					(element) =>
						element instanceof HTMLElement &&
						(element.classList.contains('dv-tab') ||
							element.closest('.dv-tab') ||
							element.classList.contains('dv-right-actions-container') ||
							element.closest('.dv-right-actions-container')),
				)
			) {
				return false;
			}

			return hitElements.some(
				(element) =>
					element instanceof HTMLElement &&
					element.classList.contains('dv-void-container'),
			);
		};

		const ensureHeaderButtons = (targetWindow: Window) => {
			const containers =
				targetWindow.document.querySelectorAll<HTMLElement>(
					'.dv-void-container',
				);

			for (const container of containers) {
				if (container.querySelector('.terminay-add-tab-button')) {
					continue;
				}

				const button = targetWindow.document.createElement('button');
				button.type = 'button';
				button.className = 'terminay-add-tab-button';
				button.setAttribute('aria-label', 'New terminal tab');
				button.title = 'New terminal tab';
				button.innerHTML = `
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `;
				container.appendChild(button);
				const profileButton = targetWindow.document.createElement('button');
				profileButton.type = 'button';
				profileButton.className = 'terminay-add-tab-button terminay-add-profile-tab-button';
				profileButton.setAttribute('aria-label', 'New terminal with profile');
				profileButton.title = 'New terminal with profile';
				profileButton.innerHTML = '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
				container.appendChild(profileButton);
			}
		};

		const addListenersForWindow = (targetWindow: Window) => {
			if (cleanupByWindow.has(targetWindow)) {
				return;
			}

			ensureHeaderButtons(targetWindow);

			const onClick = (event: PointerEvent) => {
				const target = event.target as HTMLElement | null;
				if (target?.closest('.terminay-add-profile-tab-button')) {
					event.preventDefault();
					event.stopPropagation();
					void openProfileChooser();
					return;
				}
				let addTabButton = target?.closest('.terminay-add-tab-button');
				if (!addTabButton) {
					const emptyHeaderSpace = target?.closest(
						'.dv-void-container',
					) as HTMLElement | null;
					addTabButton =
						[...(emptyHeaderSpace?.querySelectorAll('.terminay-add-tab-button') ?? [])]
							.find((candidate) => {
								const rect = candidate.getBoundingClientRect();
								return (
									event.clientX >= rect.left &&
									event.clientX <= rect.right &&
									event.clientY >= rect.top &&
									event.clientY <= rect.bottom
								);
							}) ?? null;
				}

				if (!addTabButton) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				addTerminalInHeaderSpace(targetWindow, target, {
					x: event.clientX,
					y: event.clientY,
				});
			};

			const onDblClick = (event: globalThis.MouseEvent) => {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('.dv-void-container')) {
					return;
				}

				const point = {
					x: event.clientX,
					y: event.clientY,
				};
				if (!isEmptyHeaderDoubleClick(targetWindow, target, point)) {
					return;
				}

				addTerminalInHeaderSpace(targetWindow, target, point);
			};
			const onContextMenu = (event: globalThis.MouseEvent) => {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('.terminay-add-tab-button')) return;
				event.preventDefault();
				event.stopPropagation();
				void openProfileChooser();
			};

			const onEditTerminal = (event: Event) => {
				const customEvent = event as CustomEvent<{ panelId: string }>;
				if (customEvent.detail?.panelId) {
					void openTerminalEditWindow(customEvent.detail.panelId);
				}
			};

			const onGenerateTabTitle = (event: Event) => {
				const customEvent = event as CustomEvent<{ panelId: string }>;
				if (customEvent.detail?.panelId) {
					void runAiTabMetadataRef.current('title', customEvent.detail.panelId);
				}
			};
			const onNewTerminalWithProfile = () => { void openProfileChooser(); };

			const onDragStart = () => {
				targetWindow.requestAnimationFrame(() => {
					const data = getPanelData();
					if (!data) {
						return;
					}

					draggingTransferRef.current = {
						panelId: data.panelId ?? undefined,
						groupId: data.groupId,
					};
				});
			};

			const onDragEnd = (event: DragEvent) => {
				const transfer = draggingTransferRef.current;
				draggingTransferRef.current = null;

				if (!transfer) {
					return;
				}

				const droppedOutsideWindow =
					event.clientX <= 0 ||
					event.clientY <= 0 ||
					event.clientX >= targetWindow.innerWidth ||
					event.clientY >= targetWindow.innerHeight;

				if (!droppedOutsideWindow) {
					return;
				}

				const api = apiRef.current;
				if (!api) {
					return;
				}

				const item = transfer.panelId
					? api.getPanel(transfer.panelId)
					: api.getGroup(transfer.groupId)?.activePanel;
				if (!item) {
					return;
				}

				void api.addPopoutGroup(item, { popoutUrl });
			};

			targetWindow.addEventListener('click', onClick, true);
			targetWindow.addEventListener('dblclick', onDblClick, true);
			targetWindow.addEventListener('contextmenu', onContextMenu, true);
			targetWindow.addEventListener('terminay-edit-terminal', onEditTerminal);
			targetWindow.addEventListener(
				'terminay-generate-tab-title',
				onGenerateTabTitle,
			);
			targetWindow.addEventListener('terminay-new-terminal-with-profile', onNewTerminalWithProfile);
			targetWindow.addEventListener('dragstart', onDragStart, true);
			targetWindow.addEventListener('dragend', onDragEnd, true);

			cleanupByWindow.set(targetWindow, () => {
				targetWindow.removeEventListener('click', onClick, true);
				targetWindow.removeEventListener('dblclick', onDblClick, true);
				targetWindow.removeEventListener('contextmenu', onContextMenu, true);
				targetWindow.removeEventListener(
					'terminay-edit-terminal',
					onEditTerminal,
				);
				targetWindow.removeEventListener(
					'terminay-generate-tab-title',
					onGenerateTabTitle,
				);
				targetWindow.removeEventListener('terminay-new-terminal-with-profile', onNewTerminalWithProfile);
				targetWindow.removeEventListener('dragstart', onDragStart, true);
				targetWindow.removeEventListener('dragend', onDragEnd, true);
			});
		};

		const collectDockviewWindows = (): Set<Window> => {
			const result = new Set<Window>([window]);
			const api = apiRef.current;

			if (!api) {
				return result;
			}

			for (const group of api.groups) {
				const panel = group.activePanel ?? group.panels[0];
				if (!panel) {
					continue;
				}

				try {
					result.add(panel.api.getWindow());
				} catch {
					// Ignore transient windows during popout transitions.
				}
			}

			return result;
		};

		const reconcileWindowListeners = () => {
			const liveWindows = collectDockviewWindows();

			for (const targetWindow of liveWindows) {
				addListenersForWindow(targetWindow);
				ensureHeaderButtons(targetWindow);
			}

			for (const [targetWindow, cleanup] of cleanupByWindow.entries()) {
				if (liveWindows.has(targetWindow)) {
					continue;
				}

				cleanup();
				cleanupByWindow.delete(targetWindow);
			}
		};

		reconcileWindowListeners();

		const api = apiRef.current;
		if (api) {
			apiDisposables.push(
				api.onDidAddGroup(reconcileWindowListeners),
				api.onDidRemoveGroup(reconcileWindowListeners),
				api.onDidMovePanel(reconcileWindowListeners),
				api.onDidActivePanelChange(reconcileWindowListeners),
			);
		}

		const interval = window.setInterval(reconcileWindowListeners, 500);

		return () => {
			window.clearInterval(interval);
			for (const disposable of apiDisposables) {
				disposable.dispose();
			}
			for (const cleanup of cleanupByWindow.values()) {
				cleanup();
			}
			cleanupByWindow.clear();
		};
	}, [
		addTerminal,
		apiRef,
		draggingTransferRef,
		isActive,
		openTerminalEditWindow,
		openProfileChooser,
		popoutUrl,
		runAiTabMetadataRef,
	]);
}
