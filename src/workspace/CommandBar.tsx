/**
 * The Command Bar: one box for running a command or going somewhere.
 *
 * It lists built-in commands and saved macros, and — once something is typed —
 * places: Home's sections and every project, tab, agent, and automation the
 * window can reach. A project draws it with that project's commands; with Home
 * in front, or no project at all, the workspace view draws it with the commands
 * that are its own. Both draw the same dialog and move through it the same way.
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
	Bot,
	FolderClosed,
	House,
	LayoutList,
	Search,
	SquareTerminal,
	Workflow,
} from 'lucide-react';
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	HOME_SEARCH_KIND_LABELS,
	type HomeSearchResult,
	type HomeSearchResultKind,
} from './homeSearchModel.ts';

export type CommandBarItem = {
	description: string;
	group: string;
	icon: ReactNode;
	id: string;
	onSelect: () => void;
	searchText: string;
	shortcutLabel?: string;
	title: string;
};

/** Commands and macros first, then places by kind. */
const GROUP_ORDER: readonly string[] = [
	'Terminal',
	'Workspace',
	'Macros',
	...Object.values(HOME_SEARCH_KIND_LABELS),
];

export type CommandBarGroup = Readonly<{
	group: string;
	items: readonly Readonly<{ index: number; item: CommandBarItem }>[];
}>;

/** Items under their group headings, each keeping its place in the flat list
 * that the keyboard moves through. Items must already be ordered by group. */
export function groupCommandBarItems(
	items: readonly CommandBarItem[],
): readonly CommandBarGroup[] {
	const groups = new Map<string, { index: number; item: CommandBarItem }[]>();
	items.forEach((item, index) => {
		const groupItems = groups.get(item.group) ?? [];
		groupItems.push({ index, item });
		groups.set(item.group, groupItems);
	});
	return [...groups.keys()]
		.sort((left, right) => {
			const leftAt = GROUP_ORDER.indexOf(left);
			const rightAt = GROUP_ORDER.indexOf(right);
			return (
				(leftAt === -1 ? GROUP_ORDER.length : leftAt) -
				(rightAt === -1 ? GROUP_ORDER.length : rightAt)
			);
		})
		.map((group) => ({ group, items: groups.get(group) ?? [] }));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getCommandSearchScore(
	item: {
		title: string;
		description: string;
		searchText: string;
	},
	query: string,
): number {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return 0;
	}

	const title = item.title.toLowerCase();
	const description = item.description.toLowerCase();
	const searchText = item.searchText.toLowerCase();
	const boundaryQueryPattern = new RegExp(
		`\\b${escapeRegExp(normalizedQuery)}`,
	);
	const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
	const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
	let score = 0;

	if (title === normalizedQuery) {
		score += 1_000;
	}
	if (title.startsWith(normalizedQuery)) {
		score += 700;
	}
	if (boundaryQueryPattern.test(title)) {
		score += 500;
	}
	if (title.includes(normalizedQuery)) {
		score += 300;
	}
	if (
		queryWords.length > 0 &&
		queryWords.every((word) =>
			titleWords.some((titleWord) => titleWord.startsWith(word)),
		)
	) {
		score += 250;
	}
	if (boundaryQueryPattern.test(description)) {
		score += 120;
	}
	if (description.includes(normalizedQuery)) {
		score += 80;
	}
	if (boundaryQueryPattern.test(searchText)) {
		score += 40;
	}
	if (searchText.includes(normalizedQuery)) {
		score += 20;
	}

	return score;
}

/**
 * The commands and macros that match `query`, best first. Macros keep the
 * order they were saved in. An empty query lists everything.
 */
export function filterCommandBarItems(
	items: readonly CommandBarItem[],
	query: string,
): CommandBarItem[] {
	const normalizedQuery = query.trim().toLowerCase();
	const matched = !normalizedQuery
		? [...items]
		: items
				.map((item, index) => ({
					item,
					index,
					score: getCommandSearchScore(item, normalizedQuery),
				}))
				.filter(({ score }) => score > 0)
				.sort((left, right) => {
					if (left.item.group === 'Macros' && right.item.group === 'Macros') {
						return left.index - right.index;
					}
					if (right.score !== left.score) {
						return right.score - left.score;
					}
					return left.index - right.index;
				})
				.map(({ item }) => item);
	return matched;
}

const PLACE_ICONS: Readonly<Record<HomeSearchResultKind, ReactNode>> = {
	agent: <Bot size={18} strokeWidth={2.1} />,
	automation: <Workflow size={18} strokeWidth={2.1} />,
	panel: <SquareTerminal size={18} strokeWidth={2.1} />,
	project: <FolderClosed size={18} strokeWidth={2.1} />,
	section: <House size={18} strokeWidth={2.1} />,
};

/**
 * Search results as Command Bar items. With more than one server attached,
 * each place says which server it is on.
 */
export function commandBarPlaceItems(
	results: readonly HomeSearchResult[],
	onChoose: (result: HomeSearchResult) => void,
	serverLabels: ReadonlyMap<string, string>,
): CommandBarItem[] {
	const namesServers = serverLabels.size > 1;
	return results.map((result) => {
		const detail = 'detail' in result ? result.detail : undefined;
		const server =
			namesServers && result.kind !== 'section'
				? serverLabels.get(result.serverId)
				: undefined;
		const description = [
			detail,
			server !== undefined && server !== detail ? server : undefined,
		]
			.filter((part) => part !== undefined && part.length > 0)
			.join(' · ');
		return {
			group: HOME_SEARCH_KIND_LABELS[result.kind],
			icon:
				result.kind === 'section' && result.section !== 'home' ? (
					result.section === 'tabs' ? (
						<LayoutList size={18} strokeWidth={2.1} />
					) : (
						<Workflow size={18} strokeWidth={2.1} />
					)
				) : (
					PLACE_ICONS[result.kind]
				),
			id: `place:${result.key}`,
			title: result.title,
			description:
				description || (result.kind === 'section' ? 'Open in Home' : ''),
			searchText: '',
			onSelect: () => onChoose(result),
		};
	});
}

type CommandBarNavigationOptions = Readonly<{
	isOpen: boolean;
	items: readonly CommandBarItem[];
	selectedIndex: number;
	setSelectedIndex: (next: number | ((current: number) => number)) => void;
	onClose: () => void;
	inputRef: RefObject<HTMLInputElement | null>;
	listRef: RefObject<HTMLDivElement | null>;
	itemRefs: RefObject<Map<string, HTMLButtonElement | null>>;
}>;

/** Focus, arrow keys, Enter, Escape, and keeping the highlighted item in view. */
export function useCommandBarNavigation({
	inputRef,
	isOpen,
	itemRefs,
	items,
	listRef,
	onClose,
	selectedIndex,
	setSelectedIndex,
}: CommandBarNavigationOptions) {
	const activeId = items[selectedIndex]?.id ?? null;

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [inputRef, isOpen]);

	useEffect(() => {
		if (items.length === 0) {
			setSelectedIndex(0);
			return;
		}

		setSelectedIndex((current) => Math.min(current, items.length - 1));
	}, [items.length, setSelectedIndex]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// The Command Bar is over everything else, so Escape closes it
				// and nothing behind it — a drawer, say — as well.
				event.preventDefault();
				event.stopImmediatePropagation();
				onClose();
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setSelectedIndex((current) =>
					items.length === 0 ? 0 : (current + 1) % items.length,
				);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setSelectedIndex((current) =>
					items.length === 0
						? 0
						: (current - 1 + items.length) % items.length,
				);
				return;
			}

			if (event.key === 'Enter') {
				event.preventDefault();
				items[selectedIndex]?.onSelect();
			}
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [isOpen, items, onClose, selectedIndex, setSelectedIndex]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const list = listRef.current;
		const activeItem = activeId ? itemRefs.current?.get(activeId) : null;
		if (!list || !activeItem) {
			return;
		}

		const animationFrameId = window.requestAnimationFrame(() => {
			const listRect = list.getBoundingClientRect();
			const activeRect = activeItem.getBoundingClientRect();
			const padding = 12;
			if (activeRect.top < listRect.top + padding) {
				list.scrollTop = Math.max(
					0,
					list.scrollTop + activeRect.top - listRect.top - padding,
				);
			} else if (activeRect.bottom > listRect.bottom - padding) {
				list.scrollTop =
					list.scrollTop + activeRect.bottom - listRect.bottom + padding;
			}
		});

		return () => {
			window.cancelAnimationFrame(animationFrameId);
		};
	}, [activeId, isOpen, itemRefs, listRef]);
}

export type CommandBarDialogProps = Readonly<{
	isOpen: boolean;
	items: readonly CommandBarItem[];
	query: string;
	selectedIndex: number;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	onSelectIndex: (index: number) => void;
	inputRef: RefObject<HTMLInputElement | null>;
	listRef: RefObject<HTMLDivElement | null>;
	itemRefs: RefObject<Map<string, HTMLButtonElement | null>>;
}>;

export function CommandBarDialog({
	inputRef,
	isOpen,
	itemRefs,
	items,
	listRef,
	onClose,
	onQueryChange,
	onSelectIndex,
	query,
	selectedIndex,
}: CommandBarDialogProps) {
	const groups = useMemo(() => groupCommandBarItems(items), [items]);
	return (
		<AnimatePresence>
			{isOpen && (
				<div className="macro-launcher-overlay" onClick={onClose}>
					<motion.div
						initial={{ opacity: 0, scale: 0.98, y: -20 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.98, y: -10 }}
						transition={{ duration: 0.15, ease: 'easeOut' }}
						className="macro-launcher"
						role="dialog"
						aria-modal="true"
						aria-label="Command bar"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="macro-launcher-search-container">
							<div className="macro-launcher-search-icon">
								<Search size={20} strokeWidth={2.5} aria-hidden="true" />
							</div>
							<input
								ref={inputRef}
								type="search"
								className="macro-launcher-input"
								value={query}
								onChange={(event) => {
									onQueryChange(event.target.value);
									onSelectIndex(0);
								}}
								aria-label="Search commands"
								placeholder="Search commands..."
								spellCheck={false}
								autoComplete="off"
							/>
							<div className="macro-launcher-shortcut">
								<span>ESC</span>
							</div>
						</div>

						<div ref={listRef} className="macro-launcher-list">
							{items.length === 0 ? (
								<div className="macro-launcher-empty">
									<p>Nothing matches your search.</p>
								</div>
							) : (
								groups.map(({ group, items: groupItems }) => (
									<section
										className="macro-launcher-group"
										key={group}
										data-terminay-command-bar-group={group}
									>
										<div className="macro-launcher-group-label">{group}</div>
										<div className="macro-launcher-group-items">
											{groupItems.map(({ item, index }) => (
												<button
													key={item.id}
													type="button"
													ref={(element) => {
														if (element) {
															itemRefs.current?.set(item.id, element);
															return;
														}

														itemRefs.current?.delete(item.id);
													}}
													className={`macro-launcher-item ${index === selectedIndex ? 'macro-launcher-item--active' : ''}`}
													data-terminay-command-bar-item={item.id}
													onMouseEnter={() => onSelectIndex(index)}
													onClick={() => item.onSelect()}
												>
													<span className="macro-launcher-item-icon">
														{item.icon}
													</span>
													<div className="macro-launcher-item-content">
														<span className="macro-launcher-item-title">
															{item.title}
														</span>
														<span className="macro-launcher-item-description">
															{item.description}
														</span>
													</div>
													<div className="macro-launcher-item-actions">
														{item.shortcutLabel ? (
															<span className="macro-launcher-command-shortcut">
																{item.shortcutLabel}
															</span>
														) : null}
														{index === selectedIndex && (
															<div className="macro-launcher-item-hint">
																<span>⏎</span>
															</div>
														)}
													</div>
												</button>
											))}
										</div>
									</section>
								))
							)}
						</div>

						<div className="macro-launcher-footer">
							<div className="macro-launcher-footer-hint">
								<span className="macro-launcher-key">↑↓</span> to navigate
							</div>
							<div className="macro-launcher-footer-hint">
								<span className="macro-launcher-key">⏎</span> to run
							</div>
						</div>
					</motion.div>
				</div>
			)}
		</AnimatePresence>
	);
}

export type ViewCommandBarProps = Readonly<{
	isOpen: boolean;
	/** The commands that belong to the workspace view rather than a project. */
	commands: readonly CommandBarItem[];
	searchPlaces: (query: string) => readonly CommandBarItem[];
	onClose: () => void;
}>;

/**
 * The Command Bar as the workspace view draws it: with Home in front, or with
 * no project in the window. It lists no command that needs a project.
 */
export function ViewCommandBar({
	commands,
	isOpen,
	onClose,
	searchPlaces,
}: ViewCommandBarProps) {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const itemRefs = useRef(new Map<string, HTMLButtonElement | null>());

	useEffect(() => {
		if (!isOpen) return;
		setQuery('');
		setSelectedIndex(0);
	}, [isOpen]);

	const items = useMemo(
		() => [...filterCommandBarItems(commands, query), ...searchPlaces(query)],
		[commands, query, searchPlaces],
	);

	useCommandBarNavigation({
		inputRef,
		isOpen,
		itemRefs,
		items,
		listRef,
		onClose,
		selectedIndex,
		setSelectedIndex,
	});

	return (
		<CommandBarDialog
			inputRef={inputRef}
			isOpen={isOpen}
			itemRefs={itemRefs}
			items={items}
			listRef={listRef}
			onClose={onClose}
			onQueryChange={setQuery}
			onSelectIndex={setSelectedIndex}
			query={query}
			selectedIndex={selectedIndex}
		/>
	);
}
