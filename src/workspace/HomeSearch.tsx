/**
 * The search bar in Home's band.
 *
 * Home's control opens into this band the way a project tab opens into its
 * project's tab strip. The band holds one search box that finds any project,
 * tab, agent, automation, or Home section and goes there. `/` focuses it while
 * Home is shown and nothing else has the keyboard.
 */

import {
	Bot,
	FolderClosed,
	House,
	LayoutList,
	Search,
	SquareTerminal,
	Workflow,
	X,
} from 'lucide-react';
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	buildCrossServerDashboardGroups,
	type DashboardServerSource,
} from './crossServerRows.ts';
import {
	HOME_SEARCH_KIND_LABELS,
	type HomeSearchAutomation,
	type HomeSearchResult,
	type HomeSearchResultKind,
	searchHome,
} from './homeSearchModel.ts';
import type { HomeSection } from './homeSection.ts';

const SECTION_ICONS: Readonly<Record<HomeSection, ReactNode>> = {
	home: <House size={13} aria-hidden="true" />,
	tabs: <LayoutList size={13} aria-hidden="true" />,
	automations: <Workflow size={13} aria-hidden="true" />,
};

const KIND_ICONS: Readonly<Record<HomeSearchResultKind, ReactNode>> = {
	section: <House size={13} aria-hidden="true" />,
	project: <FolderClosed size={13} aria-hidden="true" />,
	panel: <SquareTerminal size={13} aria-hidden="true" />,
	agent: <Bot size={13} aria-hidden="true" />,
	automation: <Workflow size={13} aria-hidden="true" />,
};

export type HomeSearchProps = Readonly<{
	sources: readonly DashboardServerSource[];
	automations: readonly HomeSearchAutomation[];
	onChoose: (result: HomeSearchResult) => void;
}>;

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.closest('.xterm') !== null
	);
}

export function HomeSearch({ automations, onChoose, sources }: HomeSearchProps) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	const groups = useMemo(
		() => buildCrossServerDashboardGroups(sources),
		[sources],
	);
	const results = useMemo(
		() => searchHome(groups, automations, query),
		[automations, groups, query],
	);
	const highlighted = Math.min(active, Math.max(results.length - 1, 0));

	// `/` jumps to the search while Home is shown, unless something is being
	// typed into.
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (
				event.key !== '/' ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				isTypingTarget(event.target)
			)
				return;
			event.preventDefault();
			inputRef.current?.focus();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	const choose = (result: HomeSearchResult | undefined) => {
		if (result === undefined) return;
		setQuery('');
		setOpen(false);
		inputRef.current?.blur();
		onChoose(result);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				setOpen(true);
				setActive((highlighted + 1) % Math.max(results.length, 1));
				return;
			case 'ArrowUp':
				event.preventDefault();
				setOpen(true);
				setActive(
					(highlighted - 1 + Math.max(results.length, 1)) %
						Math.max(results.length, 1),
				);
				return;
			case 'Enter':
				event.preventDefault();
				choose(results[highlighted]);
				return;
			case 'Escape':
				event.preventDefault();
				if (query.length > 0) {
					setQuery('');
					return;
				}
				setOpen(false);
				inputRef.current?.blur();
				return;
		}
	};

	const showResults = open && query.trim().length > 0;
	let previousKind: HomeSearchResultKind | undefined;

	return (
		<div className="home-search" data-terminay-home-search="true">
			<div className="home-search__field">
				<Search size={15} className="home-search__icon" aria-hidden="true" />
				<input
					ref={inputRef}
					className="home-search__input"
					type="text"
					role="combobox"
					aria-expanded={showResults}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-label="Search Home"
					{...(showResults && results[highlighted] !== undefined
						? { 'aria-activedescendant': `${listId}-${highlighted}` }
						: {})}
					placeholder="Search projects, tabs, agents, and automations"
					spellCheck={false}
					autoComplete="off"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={handleKeyDown}
					data-terminay-home-search-input="true"
				/>
				{query.length > 0 ? (
					<button
						type="button"
						className="home-search__clear"
						aria-label="Clear search"
						// Keep the focus in the box while clearing it.
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							setQuery('');
							inputRef.current?.focus();
						}}
					>
						<X size={13} aria-hidden="true" />
					</button>
				) : (
					<span className="home-search__hint" aria-hidden="true">
						/
					</span>
				)}
			</div>
			{showResults ? (
				<div
					className="home-search__results"
					id={listId}
					role="listbox"
					aria-label="Search results"
					data-terminay-home-search-results="true"
				>
					{results.length === 0 ? (
						<p className="home-search__empty">
							Nothing matches “{query.trim()}”.
						</p>
					) : (
						results.map((result, index) => {
							const heading =
								result.kind === previousKind
									? null
									: HOME_SEARCH_KIND_LABELS[result.kind];
							previousKind = result.kind;
							const detail = 'detail' in result ? result.detail : undefined;
							return (
								<div key={result.key}>
									{heading === null ? null : (
										<div className="home-search__group" aria-hidden="true">
											{heading}
										</div>
									)}
									<div
										id={`${listId}-${index}`}
										role="option"
										tabIndex={-1}
										aria-selected={index === highlighted}
										className={`home-search__result${index === highlighted ? ' home-search__result--active' : ''}`}
										data-terminay-home-search-result={result.key}
										// Choose on mouse down, before the box's blur closes the list.
										onMouseDown={(event) => {
											event.preventDefault();
											choose(result);
										}}
										onMouseEnter={() => setActive(index)}
									>
										<span className="home-search__result-icon">
											{result.kind === 'section'
												? SECTION_ICONS[result.section]
												: KIND_ICONS[result.kind]}
										</span>
										<span className="home-search__result-title">
											{result.title}
										</span>
										{detail === undefined ? null : (
											<span className="home-search__result-detail">
												{detail}
											</span>
										)}
									</div>
								</div>
							);
						})
					)}
				</div>
			) : null}
		</div>
	);
}
