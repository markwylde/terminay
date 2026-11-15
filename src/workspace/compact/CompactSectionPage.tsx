/**
 * A compact section page: how a Home list section looks on a phone.
 *
 * Header row (title, summary, Search, View options, create), or the search
 * field while searching; then the status tabs; then the applied-options row;
 * then the list. The View options sheet rises from the bottom edge over the
 * page. Every section draws through this one component, so seven sections
 * read as one design and cannot drift apart.
 */

import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react';
import { useCompactDrawerEpoch } from './CompactHomeContext';
import { CompactSheet } from './CompactSheet';
import {
	type AppliedOption,
	type CompactTab,
	viewOptionsLabel,
} from './compactSectionModel';
import './compactSection.css';

export type CompactSectionSearch = Readonly<{
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	/** The field's accessible name. */
	label: string;
}>;

export type CompactSectionSheet = Readonly<{
	title: string;
	content: ReactNode;
	/** Whether any option differs from its default: Reset is offered. */
	canReset: boolean;
	onReset: () => void;
	/** Controlled open state, for a page that opens the sheet itself. */
	isOpen?: boolean;
	onOpenChange?: (isOpen: boolean) => void;
	/** False when only the page opens the sheet: no View options control. */
	offerControl?: boolean;
}>;

export type CompactSectionPageProps<K extends string> = Readonly<{
	/** `data-compact-section` on the page, for tests and styling. */
	section: string;
	title: string;
	summary?: ReactNode;
	search?: CompactSectionSearch;
	create?: Readonly<{ label: string; onActivate: () => void }>;
	tabs: readonly CompactTab<K>[];
	selectedTab: K;
	onSelectTab: (tab: K) => void;
	/** Absent when the section has no secondary options right now. */
	sheet?: CompactSectionSheet;
	applied?: Readonly<{ tokens: readonly AppliedOption[]; clear: () => void }>;
	/** Above the list, below the tabs: a build banner, say. */
	banner?: ReactNode;
	children: ReactNode;
}>;

export function CompactSectionPage<K extends string>({
	section,
	title,
	summary,
	search,
	create,
	tabs,
	selectedTab,
	onSelectTab,
	sheet,
	applied,
	banner,
	children,
}: CompactSectionPageProps<K>) {
	const searchButtonRef = useRef<HTMLButtonElement>(null);
	const searchFieldRef = useRef<HTMLInputElement>(null);
	const sheetButtonRef = useRef<HTMLButtonElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const tabsId = useId();
	// A search that already has text (a round trip, or the breakpoint crossed
	// with a filter typed on a wide window) opens in search mode.
	const [isSearchOpen, setIsSearchOpen] = useState(
		() => (search?.value ?? '') !== '',
	);
	const isSearching =
		search !== undefined && (isSearchOpen || search.value !== '');
	const [ownSheetOpen, setOwnSheetOpen] = useState(false);
	const isSheetOpen = sheet?.isOpen ?? ownSheetOpen;
	const setSheetOpen = (next: boolean) => {
		if (sheet?.onOpenChange !== undefined) sheet.onOpenChange(next);
		else setOwnSheetOpen(next);
	};
	const closeSheet = () => {
		setSheetOpen(false);
		window.requestAnimationFrame(() => sheetButtonRef.current?.focus());
	};

	// Another compact drawer opening closes the sheet without taking focus
	// back: the drawer that opened has it (ADR-0125).
	const drawerEpoch = useCompactDrawerEpoch();
	const seenEpoch = useRef(drawerEpoch);
	const setSheetOpenRef = useRef(setSheetOpen);
	setSheetOpenRef.current = setSheetOpen;
	useEffect(() => {
		if (seenEpoch.current === drawerEpoch) return;
		seenEpoch.current = drawerEpoch;
		setSheetOpenRef.current(false);
	}, [drawerEpoch]);

	const focusSearchRequested = useRef(false);
	useEffect(() => {
		if (!isSearching || !focusSearchRequested.current) return;
		focusSearchRequested.current = false;
		searchFieldRef.current?.focus();
	}, [isSearching]);

	// The selected tab is always in view, however far the tabs scroll.
	useEffect(() => {
		const tab = tabsRef.current?.querySelector<HTMLElement>(
			`[data-compact-tab="${CSS.escape(selectedTab)}"]`,
		);
		tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	}, [selectedTab]);

	const endSearch = () => {
		search?.onChange('');
		setIsSearchOpen(false);
		window.requestAnimationFrame(() => searchButtonRef.current?.focus());
	};

	const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		const index = tabs.findIndex((tab) => tab.id === selectedTab);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: (index + step + tabs.length) % tabs.length;
		const tab = tabs[next];
		if (tab === undefined) return;
		onSelectTab(tab.id);
		window.requestAnimationFrame(() =>
			tabsRef.current
				?.querySelector<HTMLElement>(
					`[data-compact-tab="${CSS.escape(tab.id)}"]`,
				)
				?.focus(),
		);
	};

	const isApplied = applied !== undefined && applied.tokens.length > 0;

	return (
		<div className="cpage" data-compact-section={section}>
			<div className="cpage__top">
				{isSearching ? (
					<div className="cpage__search" data-compact-search="true">
						<label className="cpage__field">
							<Search size={16} aria-hidden="true" />
							<input
								ref={searchFieldRef}
								type="search"
								value={search.value}
								placeholder={search.placeholder}
								aria-label={search.label}
								onChange={(event) => search.onChange(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== 'Escape') return;
									event.preventDefault();
									event.stopPropagation();
									endSearch();
								}}
								data-compact-search-field="true"
							/>
						</label>
						<button
							type="button"
							className="cpage__cancel"
							onClick={endSearch}
							data-compact-search-cancel="true"
						>
							Cancel
						</button>
					</div>
				) : (
					<div className="cpage__head">
						<h1 className="cpage__title">
							{title}
							{summary === undefined ? null : (
								<span className="cpage__summary">{summary}</span>
							)}
						</h1>
						{search === undefined ? null : (
							<button
								ref={searchButtonRef}
								type="button"
								className="cpage__action"
								aria-label="Search"
								title="Search"
								onClick={() => {
									focusSearchRequested.current = true;
									setIsSearchOpen(true);
								}}
								data-compact-search-open="true"
							>
								<Search size={19} aria-hidden="true" />
							</button>
						)}
						{sheet === undefined || sheet.offerControl === false ? null : (
							<button
								ref={sheetButtonRef}
								type="button"
								className="cpage__action"
								aria-label={viewOptionsLabel(isApplied)}
								title="View options"
								aria-haspopup="dialog"
								aria-expanded={isSheetOpen}
								onClick={() => setSheetOpen(true)}
								data-compact-view-options="true"
								data-applied={isApplied ? 'true' : 'false'}
							>
								<SlidersHorizontal size={19} aria-hidden="true" />
								{isApplied ? (
									<span className="cpage__applied-dot" aria-hidden="true" />
								) : null}
							</button>
						)}
						{create === undefined ? null : (
							<button
								type="button"
								className="cpage__action cpage__action--create"
								aria-label={create.label}
								title={create.label}
								onClick={create.onActivate}
								data-compact-create="true"
							>
								<Plus size={21} aria-hidden="true" />
							</button>
						)}
					</div>
				)}
				<div
					ref={tabsRef}
					className="cpage__tabs"
					role="tablist"
					aria-label={`${title} status`}
					id={tabsId}
					onKeyDown={onTabsKeyDown}
					data-compact-tabs="true"
				>
					{tabs.map((tab) => {
						const selected = tab.id === selectedTab;
						const marked = tab.attention === true && (tab.count ?? 0) > 0;
						return (
							<button
								key={tab.id}
								type="button"
								role="tab"
								aria-selected={selected}
								tabIndex={selected ? 0 : -1}
								className={`cpage__tab${marked ? ' cpage__tab--attention' : ''}`}
								onClick={() => onSelectTab(tab.id)}
								data-compact-tab={tab.id}
							>
								{tab.label}
								{tab.count === undefined ? null : (
									<span
										className="cpage__count"
										data-compact-tab-count={tab.count}
										data-marked={marked ? 'true' : 'false'}
									>
										{tab.countLabel ?? tab.count}
									</span>
								)}
							</button>
						);
					})}
				</div>
				{isApplied ? (
					<div className="cpage__applied" data-compact-applied="true">
						{applied.tokens.map((token) => (
							<button
								key={token.id}
								type="button"
								className="cpage__token"
								onClick={token.reset}
								aria-label={`Remove ${token.label}`}
								data-compact-applied-token={token.id}
							>
								{token.label}
								<X size={13} aria-hidden="true" />
							</button>
						))}
						<button
							type="button"
							className="cpage__clear"
							onClick={applied.clear}
							data-compact-applied-clear="true"
						>
							Clear
						</button>
					</div>
				) : null}
			</div>
			<div className="cpage__body" role="tabpanel" aria-labelledby={tabsId}>
				{banner}
				{children}
			</div>
			{sheet !== undefined && isSheetOpen ? (
				<CompactSheet
					title={sheet.title}
					canReset={sheet.canReset}
					onReset={sheet.onReset}
					onClose={closeSheet}
				>
					{sheet.content}
				</CompactSheet>
			) : null}
		</div>
	);
}
