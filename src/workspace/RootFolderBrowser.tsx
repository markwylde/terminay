import type { BrowseRootFoldersResult } from '@terminay/client-core';
import { ArrowUp, Folder, FolderOpen } from 'lucide-react';
import { type JSX, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InPageWindow } from '../shared/inPageWindow/InPageWindow';
import { childFolderPath } from './projectStart';
import {
	type FolderSuggestion,
	RootFolderCompleter,
	suggestionHighlightMove,
} from './rootFolderCompletion';
import {
	listedFolder,
	type RootFolderListing,
	RootFolderNavigator,
} from './rootFolderNavigator';
import './projectStart.css';

export type RootFolderBrowserProps = Readonly<{
	/** Lists one folder on the owning server; absent is the account's home. */
	browse: (path?: string) => Promise<BrowseRootFoldersResult>;
	/** The person chose this folder, as the server last listed it. */
	onChoose: (path: string) => void;
	onCancel: () => void;
	/** Names the server whose folders these are, when more than one is attached. */
	serverLabel?: string;
}>;

/**
 * Choosing a project root on the server that will own it (ADR-0066). Every
 * client host browses the server's own folders here, through the in-page
 * window frame (ADR-0053), so a remote or phone client never sees its own
 * disk. The server returns directory names only; the folder chosen is
 * validated again when it is submitted as a root.
 */
export function RootFolderBrowser({
	browse,
	onChoose,
	onCancel,
	serverLabel,
}: RootFolderBrowserProps): JSX.Element {
	const [listing, setListing] = useState<RootFolderListing>({
		state: 'loading',
	});
	const [typedPath, setTypedPath] = useState('');
	// Until the person goes into the path field, it shows the folder the
	// server last listed. This is worked out when rendering, never written
	// when a listing lands: a write queued by a landing listing could commit
	// after the field took focus and before the first keystroke or paste,
	// putting the listed path in front of what was typed.
	const [followsListing, setFollowsListing] = useState(true);
	const shownPath =
		followsListing && listing.state === 'ready'
			? listing.folder.path
			: typedPath;
	const [suggestions, setSuggestions] = useState<readonly FolderSuggestion[]>(
		[],
	);
	const [highlighted, setHighlighted] = useState(-1);
	const navigatorRef = useRef<RootFolderNavigator | null>(null);
	const completerRef = useRef<RootFolderCompleter | null>(null);

	useEffect(() => {
		const navigator = new RootFolderNavigator(browse, setListing);
		navigatorRef.current = navigator;
		// Opens at the server account's home.
		void navigator.open();
		const completer = new RootFolderCompleter(browse, (next) => {
			setSuggestions(next);
			setHighlighted(-1);
		});
		completerRef.current = completer;
		return () => {
			navigator.dispose();
			completer.dispose();
		};
	}, [browse]);

	return createPortal(
		<InPageWindow
			icon={<FolderOpen size={14} />}
			kind={{ resizable: false, width: 560 }}
			name="root-folder-browser"
			title={
				serverLabel === undefined
					? 'Open a folder'
					: `Open a folder on ${serverLabel}`
			}
			onClose={onCancel}
		>
			<RootFolderBrowserView
				listing={listing}
				typedPath={shownPath}
				suggestions={suggestions}
				highlighted={highlighted}
				onPathFocus={() => {
					// The field keeps exactly what it shows as the person
					// enters it; no later listing replaces it.
					setTypedPath(shownPath);
					setFollowsListing(false);
				}}
				onTypedPathChange={(path) => {
					setFollowsListing(false);
					setTypedPath(path);
					completerRef.current?.update(path);
				}}
				onHighlight={setHighlighted}
				onAcceptSuggestion={(suggestion) => {
					setFollowsListing(false);
					setTypedPath(suggestion.path);
					completerRef.current?.clear();
				}}
				onDismissSuggestions={() => completerRef.current?.clear()}
				onOpen={(path) => {
					// The path gone to stays in the field while it loads, and the
					// folder the server lists replaces it when it lands.
					setTypedPath(path);
					setFollowsListing(true);
					completerRef.current?.clear();
					void navigatorRef.current?.open(path);
				}}
				onChoose={onChoose}
				onCancel={onCancel}
			/>
		</InPageWindow>,
		document.body,
	);
}

export type RootFolderBrowserViewProps = Readonly<{
	listing: RootFolderListing;
	typedPath: string;
	/** Folders completing the typed path; empty when none are offered. */
	suggestions?: readonly FolderSuggestion[];
	/** The suggestion the arrow keys are on, or -1. */
	highlighted?: number;
	/** The person went into the path field. */
	onPathFocus?: () => void;
	onTypedPathChange: (path: string) => void;
	onHighlight?: (index: number) => void;
	onAcceptSuggestion?: (suggestion: FolderSuggestion) => void;
	onDismissSuggestions?: () => void;
	onOpen: (path: string) => void;
	onChoose: (path: string) => void;
	onCancel: () => void;
}>;

/** What the browser window holds: the path field, the listing, and its
 * actions. */
export function RootFolderBrowserView({
	listing,
	typedPath,
	suggestions = [],
	highlighted = -1,
	onPathFocus,
	onTypedPathChange,
	onHighlight,
	onAcceptSuggestion,
	onDismissSuggestions,
	onOpen,
	onChoose,
	onCancel,
}: RootFolderBrowserViewProps): JSX.Element {
	const pathInputId = useId();
	const suggestionsId = `${pathInputId}-suggestions`;
	const suggesting = suggestions.length > 0;
	const listRef = useRef<HTMLUListElement | null>(null);
	const folder = listedFolder(listing);
	const loading = listing.state === 'loading';

	return (
		<div
			className="project-edit-modal root-folder-browser"
			data-terminay-root-folder-browser="true"
			data-state={listing.state}
			aria-busy={loading || undefined}
		>
			<form
				className="root-folder-browser__path"
				onSubmit={(event) => {
					event.preventDefault();
					const path = typedPath.trim();
					if (path.length > 0) onOpen(path);
				}}
			>
				<label htmlFor={pathInputId} className="sr-only">
					Folder path
				</label>
				<div className="root-folder-browser__path-field">
					<input
						id={pathInputId}
						type="text"
						role="combobox"
						autoComplete="off"
						spellCheck={false}
						placeholder="Type or paste a folder path"
						value={typedPath}
						aria-autocomplete="list"
						aria-expanded={suggesting}
						aria-controls={suggesting ? suggestionsId : undefined}
						aria-activedescendant={
							suggesting && highlighted >= 0
								? `${suggestionsId}-${highlighted}`
								: undefined
						}
						onFocus={() => onPathFocus?.()}
						onChange={(event) => onTypedPathChange(event.target.value)}
						onBlur={() => onDismissSuggestions?.()}
						onKeyDown={(event) => {
							if (!suggesting) return;
							const move = suggestionHighlightMove(
								event.key,
								highlighted,
								suggestions.length,
							);
							if (move !== null) {
								event.preventDefault();
								onHighlight?.(move);
								return;
							}
							if (event.key === 'Escape') {
								// Closes the suggestions, not the window.
								event.preventDefault();
								onDismissSuggestions?.();
								return;
							}
							// Tab takes the highlighted suggestion, or the only one;
							// Enter takes a highlighted one and otherwise goes.
							const index =
								highlighted >= 0
									? highlighted
									: event.key === 'Tab' && suggestions.length === 1
										? 0
										: -1;
							const suggestion = suggestions[index];
							if (
								(event.key === 'Tab' || event.key === 'Enter') &&
								suggestion !== undefined
							) {
								event.preventDefault();
								onAcceptSuggestion?.(suggestion);
							}
						}}
						data-terminay-root-folder-path="true"
					/>
					{suggesting ? (
						<div
							id={suggestionsId}
							className="root-folder-browser__suggestions"
							role="listbox"
							aria-label="Matching folders"
							data-terminay-root-folder-suggestions="true"
						>
							{suggestions.map((suggestion, index) => (
								<div
									key={suggestion.path}
									id={`${suggestionsId}-${index}`}
									role="option"
									// The field keeps focus; the arrows move the highlight.
									tabIndex={-1}
									aria-selected={index === highlighted}
									className="root-folder-browser__suggestion"
									title={suggestion.path}
									// Taken before the field blurs and closes the list.
									onPointerDown={(event) => {
										event.preventDefault();
										onAcceptSuggestion?.(suggestion);
									}}
									onPointerEnter={() => onHighlight?.(index)}
									data-terminay-root-folder-suggestion={suggestion.name}
								>
									<Folder size={13} aria-hidden="true" />
									<span>{suggestion.name}</span>
								</div>
							))}
						</div>
					) : null}
				</div>
				<button type="submit" disabled={typedPath.trim().length === 0}>
					Go
				</button>
			</form>
			<div className="root-folder-browser__location">
				<button
					type="button"
					className="root-folder-browser__parent"
					aria-label="Parent folder"
					title="Parent folder"
					disabled={folder?.parent === undefined || loading}
					onClick={() => {
						if (folder?.parent !== undefined) onOpen(folder.parent);
					}}
					data-terminay-root-folder-parent="true"
				>
					<ArrowUp size={14} aria-hidden="true" />
				</button>
				<code
					className="root-folder-browser__current"
					title={folder?.path}
					data-terminay-root-folder-current="true"
				>
					{folder?.path ?? 'Loading…'}
				</code>
			</div>
			{/* One height wherever the browser is; the listing scrolls in it. */}
			<div
				className="root-folder-browser__body"
				data-terminay-root-folder-body="true"
			>
				{listing.state === 'error' ? (
					<div
						className="root-folder-browser__message root-folder-browser__message--error"
						role="alert"
						data-terminay-root-folder-error="true"
					>
						{listing.message}
					</div>
				) : folder === undefined ? (
					<div className="root-folder-browser__message" role="status">
						Loading folders…
					</div>
				) : folder.entries.length === 0 ? (
					<div className="root-folder-browser__message">
						This folder holds no folders.
					</div>
				) : (
					<ul
						ref={listRef}
						className="root-folder-browser__list"
						aria-label={`Folders in ${folder.path}`}
						onKeyDown={(event) => {
							if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
							const buttons = [
								...(listRef.current?.querySelectorAll('button') ?? []),
							];
							const index = buttons.indexOf(
								document.activeElement as HTMLButtonElement,
							);
							event.preventDefault();
							buttons[
								event.key === 'ArrowDown'
									? Math.min(buttons.length - 1, index + 1)
									: Math.max(0, index - 1)
							]?.focus();
						}}
					>
						{folder.entries.map((entry) => (
							<li key={entry.name}>
								<button
									type="button"
									className="root-folder-browser__entry"
									disabled={loading}
									title={childFolderPath(folder.path, entry.name)}
									onClick={() =>
										onOpen(childFolderPath(folder.path, entry.name))
									}
									data-terminay-root-folder-entry={entry.name}
								>
									<Folder size={14} aria-hidden="true" />
									<span>{entry.name}</span>
								</button>
							</li>
						))}
					</ul>
				)}
				{listing.state === 'ready' && listing.folder.truncated ? (
					<div
						className="root-folder-browser__message"
						data-terminay-root-folder-truncated="true"
					>
						Showing the first {listing.folder.entries.length} folders. Type a
						path to go to one not listed.
					</div>
				) : null}
			</div>
			<div className="project-edit-actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="root-folder-browser__choose"
					disabled={listing.state !== 'ready'}
					onClick={() => {
						if (listing.state === 'ready') onChoose(listing.folder.path);
					}}
					data-terminay-root-folder-choose="true"
				>
					Open this folder
				</button>
			</div>
		</div>
	);
}
