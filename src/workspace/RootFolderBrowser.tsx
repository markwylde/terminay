import type { BrowseRootFoldersResult } from '@terminay/client-core';
import { Folder, FolderOpen } from 'lucide-react';
import {
	type JSX,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { InPageWindow } from '../shared/inPageWindow/InPageWindow';
import { folderName, startRefusalMessage } from './projectStart';
import {
	acceptStep,
	activeFolder,
	deleteSegment,
	type FolderFieldKey,
	type FolderFieldState,
	folderFieldKey,
	folderFieldState,
	ghostText,
	moveHighlight,
	openTarget,
	type ParentListing,
	parentValue,
	RootFolderCompleter,
	shownFolders,
	splitTypedFolderPath,
	tabStep,
	typedSeparator,
} from './rootFolderCompletion';
import './projectStart.css';

export type RootFolderBrowserProps = Readonly<{
	/** Lists one folder on the owning server; absent is the account's home. */
	browse: (path?: string) => Promise<BrowseRootFoldersResult>;
	/** The person chose this folder, as the server canonicalized it. */
	onChoose: (path: string) => void;
	onCancel: () => void;
	/** Names the server whose folders these are, when more than one is attached. */
	serverLabel?: string;
}>;

const IS_MAC =
	typeof navigator !== 'undefined' &&
	navigator.platform.toLowerCase().includes('mac');

/** A folder path as the field holds it: ending in its separator. */
function asTypedFolder(path: string): string {
	const separator = !path.includes('/') && path.includes('\\') ? '\\' : '/';
	return path.endsWith(separator) ? path : `${path}${separator}`;
}

/**
 * Choosing a project root on the server that will own it (ADR-0066). Every
 * client host browses the server's own folders here, through the in-page
 * window frame (ADR-0053), so a remote or phone client never sees its own
 * disk. The path field is the browser's only state: the listing is the typed
 * parent's, filtered by what is typed after it, and Tab completes it the way
 * a shell completes `cd`. The server returns directory names only; the folder
 * chosen is browsed again for its canonical path, and validated once more
 * when it is submitted as a root.
 */
export function RootFolderBrowser({
	browse,
	onChoose,
	onCancel,
	serverLabel,
}: RootFolderBrowserProps): JSX.Element {
	const [field, setField] = useState<FolderFieldState>(() =>
		folderFieldState(''),
	);
	const [message, setMessage] = useState<string | null>(null);
	const [choosing, setChoosing] = useState(false);
	const [, redraw] = useReducer((count: number) => count + 1, 0);
	const completerRef = useRef<RootFolderCompleter | null>(null);
	// A key pressed before the typed parent was listed, taken once it is
	// listed if the field still holds what it held then.
	const waitingKey = useRef<{ key: FolderFieldKey; value: string } | null>(
		null,
	);
	const live = useRef(true);

	useEffect(() => {
		live.current = true;
		const completer = new RootFolderCompleter(
			browse,
			redraw,
			startRefusalMessage,
		);
		completerRef.current = completer;
		// Opens at the server account's home.
		browse().then(
			(home) => {
				if (!live.current) return;
				const value = asTypedFolder(home.path);
				const parent = splitTypedFolderPath(value)?.parent;
				if (parent !== undefined) completer.remember(parent, home);
				// Whatever was typed while home was asked for stays.
				setField((current) =>
					current.value === '' ? folderFieldState(value) : current,
				);
			},
			(error) => {
				if (live.current) setMessage(startRefusalMessage(error));
			},
		);
		return () => {
			live.current = false;
			completer.dispose();
		};
	}, [browse]);

	useEffect(() => {
		completerRef.current?.update(field.value);
	}, [field.value]);

	const listing = completerRef.current?.listingFor(field.value);
	const folder = listing?.state === 'ready' ? listing.folder : undefined;

	const change = (next: FolderFieldState) => {
		waitingKey.current = null;
		setField(next);
		setMessage(null);
	};

	const choose = (target: string) => {
		setChoosing(true);
		setMessage(null);
		browse(target).then(
			(chosen) => {
				if (live.current) onChoose(chosen.path);
			},
			(error) => {
				if (!live.current) return;
				setChoosing(false);
				setMessage(startRefusalMessage(error));
			},
		);
	};

	/** Wait for the typed parent's listing, or say why there is none. */
	const waitFor = (key: FolderFieldKey) => {
		if (listing?.state === 'error') {
			setMessage(listing.message);
			return;
		}
		waitingKey.current = { key, value: field.value };
		completerRef.current?.flush();
	};

	/** Does what a key means for the field; false when it means nothing now. */
	const act = (key: FolderFieldKey): boolean => {
		switch (key) {
			case 'complete':
			case 'complete-back': {
				const next = tabStep(field, folder, key === 'complete-back');
				if (next.kind === 'pending') waitFor(key);
				else if (next.kind === 'message') setMessage(next.message);
				else change(next.state);
				return true;
			}
			case 'next':
			case 'previous': {
				if (field.cycle !== null) {
					return act(key === 'next' ? 'complete' : 'complete-back');
				}
				const count = shownFolders(field, folder).length;
				if (count === 0) {
					if (listing?.state === 'loading') waitFor(key);
					return true;
				}
				setField(moveHighlight(field, count, key === 'next' ? 1 : -1));
				setMessage(null);
				return true;
			}
			case 'accept': {
				const next = acceptStep(field, folder);
				if (next === null) return false;
				change(next);
				return true;
			}
			case 'open': {
				if (choosing) return true;
				const target = openTarget(field, folder);
				if (target !== null) choose(target);
				else if (listing?.state === 'loading') waitFor(key);
				else
					setMessage(
						listing?.state === 'error'
							? listing.message
							: `There is no folder at ${field.value}.`,
					);
				return true;
			}
			case 'escape': {
				if (field.cycle !== null) {
					change(folderFieldState(field.cycle.original));
					return true;
				}
				if (field.highlight >= 0 || message !== null) {
					setField({ ...field, highlight: -1 });
					setMessage(null);
					return true;
				}
				// Nothing to undo: the window's own Esc closes it.
				return false;
			}
			case 'delete-segment':
				change(folderFieldState(deleteSegment(field.value, folder?.parent)));
				return true;
			case 'parent':
				change(folderFieldState(parentValue(field.value, folder?.parent)));
				return true;
		}
	};

	// Takes a key that waited for its listing, once that listing is in.
	useEffect(() => {
		const waiting = waitingKey.current;
		if (waiting === null || listing?.state === 'loading') return;
		waitingKey.current = null;
		if (waiting.value === field.value) act(waiting.key);
	});

	/** The folder a listed row stands for, as the field would hold it. */
	const rowPath = (name: string): string => {
		const head =
			field.cycle?.head ??
			field.value.slice(
				0,
				field.value.length -
					(splitTypedFolderPath(field.value)?.prefix.length ?? 0),
			);
		return `${head}${name}`;
	};

	const target = openTarget(field, folder);
	// The field's own folder is named as the server lists it, so `~/` reads as
	// the home folder's name.
	const targetName =
		target === null
			? null
			: target === field.value &&
					field.cycle === null &&
					splitTypedFolderPath(target)?.prefix === '' &&
					folder !== undefined
				? folderName(folder.path)
				: folderName(target);

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
				field={field}
				listing={listing}
				message={message}
				choosing={choosing}
				targetName={targetName}
				onTypedPathChange={(value) => change(folderFieldState(value))}
				onKey={(event) => {
					const key = folderFieldKey(event, IS_MAC);
					if (key !== null && act(key)) event.preventDefault();
				}}
				onEnterFolder={(name) =>
					change(
						folderFieldState(`${rowPath(name)}${typedSeparator(rowPath(''))}`),
					)
				}
				onChooseEntered={() => {
					if (!choosing) choose(field.value);
				}}
				onChoose={() => act('open')}
				onCancel={onCancel}
			/>
		</InPageWindow>,
		document.body,
	);
}

export type RootFolderBrowserViewProps = Readonly<{
	field: FolderFieldState;
	/** The typed parent as listed so far; absent when the field names none. */
	listing: ParentListing | undefined;
	/** What the last key or choice has to say, in place of the count. */
	message?: string | null;
	/** A chosen folder is being checked with the server. */
	choosing?: boolean;
	/** The folder Enter would choose, by name; null when it would choose none. */
	targetName: string | null;
	onTypedPathChange: (value: string) => void;
	onKey: (event: KeyboardEvent<HTMLInputElement>) => void;
	/** A row was clicked: go into it. */
	onEnterFolder: (name: string) => void;
	/** A row was double-clicked: choose the folder its first click went into. */
	onChooseEntered: () => void;
	onChoose: () => void;
	onCancel: () => void;
}>;

/** What the browser window holds: the path field, the matching folders, and
 * the actions. */
export function RootFolderBrowserView({
	field,
	listing,
	message = null,
	choosing = false,
	targetName,
	onTypedPathChange,
	onKey,
	onEnterFolder,
	onChooseEntered,
	onChoose,
	onCancel,
}: RootFolderBrowserViewProps): JSX.Element {
	const pathInputId = useId();
	const listId = `${pathInputId}-folders`;
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	// The first click of a double-click went into a folder.
	const enteredByClick = useRef(false);
	// What the person last typed, so only a value set by a key moves the caret.
	const typed = useRef('');
	const [caretAtEnd, setCaretAtEnd] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const [composing, setComposing] = useState(false);

	const folder = listing?.state === 'ready' ? listing.folder : undefined;
	const names = shownFolders(field, folder);
	const active = activeFolder(field);
	const ghost = ghostText(field, folder);
	const segment = splitTypedFolderPath(field.value)?.prefix ?? '';
	// While Tab cycles, the rows are whole names, not matches of what is typed.
	const typedLength = field.cycle === null ? segment.length : 0;

	const measure = useCallback(() => {
		const input = inputRef.current;
		if (input === null) return;
		const end = input.value.length;
		setCaretAtEnd(
			document.activeElement === input &&
				input.selectionStart === end &&
				input.selectionEnd === end,
		);
		setOverflowing(input.scrollWidth > input.clientWidth + 1);
	}, []);

	useEffect(() => {
		inputRef.current?.focus({ preventScroll: true });
	}, []);

	// A value set by a key puts the caret at the end, as typing would.
	useLayoutEffect(() => {
		const input = inputRef.current;
		if (input === null) return;
		if (document.activeElement === input && field.value !== typed.current) {
			const end = field.value.length;
			input.setSelectionRange(end, end);
			input.scrollLeft = input.scrollWidth;
		}
		measure();
	}, [field.value, measure]);

	useEffect(() => {
		if (active < 0) return;
		listRef.current
			?.querySelector(`#${CSS.escape(`${listId}-${active}`)}`)
			?.scrollIntoView({ block: 'nearest' });
	}, [active, listId]);

	const showGhost =
		ghost.length > 0 && caretAtEnd && !overflowing && !composing;
	const error =
		message ?? (listing?.state === 'error' ? listing.message : null);
	const hiddenHint =
		folder !== undefined &&
		!segment.startsWith('.') &&
		folder.entries.some((entry) => entry.name.startsWith('.'));

	let meta: JSX.Element;
	if (error !== null) {
		meta = (
			<span
				className="root-folder-browser__meta-error"
				role="alert"
				data-terminay-root-folder-error="true"
			>
				{error}
			</span>
		);
	} else if (field.cycle !== null) {
		meta = (
			<span>
				{names.length} matches · Tab for the next, Shift+Tab for the previous
			</span>
		);
	} else if (field.value === '') {
		meta = <span>Finding your home folder…</span>;
	} else if (listing === undefined) {
		meta = <span>Start the path with / or ~.</span>;
	} else if (folder === undefined) {
		meta = <span>Listing folders…</span>;
	} else {
		meta = (
			<>
				<span>
					{names.length} {names.length === 1 ? 'folder' : 'folders'} in{' '}
					<code data-terminay-root-folder-listed="true">{folder.path}</code>
				</span>
				{hiddenHint ? (
					<span className="root-folder-browser__meta-hint">
						Type . for hidden folders
					</span>
				) : null}
			</>
		);
	}

	return (
		<div
			className="project-edit-modal root-folder-browser"
			data-terminay-root-folder-browser="true"
			data-state={listing?.state ?? 'none'}
			aria-busy={listing?.state === 'loading' || choosing || undefined}
		>
			<div className="root-folder-browser__field">
				<label htmlFor={pathInputId} className="sr-only">
					Folder path
				</label>
				{showGhost ? (
					<div className="root-folder-browser__ghost" aria-hidden="true">
						<span className="root-folder-browser__ghost-typed">
							{field.value}
						</span>
						<span data-terminay-root-folder-ghost="true">{ghost}</span>
					</div>
				) : null}
				<input
					ref={inputRef}
					id={pathInputId}
					type="text"
					role="combobox"
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					placeholder="Type or paste a folder path"
					value={field.value}
					aria-autocomplete="list"
					aria-expanded={names.length > 0}
					aria-controls={listId}
					aria-activedescendant={
						active >= 0 && active < names.length
							? `${listId}-${active}`
							: undefined
					}
					onChange={(event) => {
						typed.current = event.target.value;
						onTypedPathChange(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						onKey(event);
					}}
					onSelect={measure}
					onFocus={measure}
					onBlur={measure}
					onCompositionStart={() => setComposing(true)}
					onCompositionEnd={() => setComposing(false)}
					data-terminay-root-folder-path="true"
				/>
			</div>
			<div
				className="root-folder-browser__meta"
				data-terminay-root-folder-meta="true"
			>
				{meta}
			</div>
			{/* One height wherever the browser is; the listing scrolls in it. */}
			{/* The second click of a double-click lands here even when the
			    folder the first click went into is still being listed. */}
			<div
				className="root-folder-browser__body"
				onClick={(event) => {
					if (event.detail < 2 || !enteredByClick.current) return;
					enteredByClick.current = false;
					onChooseEntered();
				}}
				data-terminay-root-folder-body="true"
			>
				{names.length > 0 ? (
					<div
						ref={listRef}
						id={listId}
						className="root-folder-browser__list"
						role="listbox"
						aria-label={
							folder === undefined ? 'Folders' : `Folders in ${folder.path}`
						}
					>
						{names.map((name, index) => (
							<div
								key={name}
								id={`${listId}-${index}`}
								role="option"
								// The field keeps focus; the arrows move the highlight.
								tabIndex={-1}
								aria-selected={index === active}
								className="root-folder-browser__entry"
								// The field keeps focus; rows are taken by pointer only.
								onMouseDown={(event) => event.preventDefault()}
								onClick={(event) => {
									// The first click goes into the folder; the second, on
									// whatever is under the pointer then, chooses it.
									if (event.detail >= 2) return;
									enteredByClick.current = true;
									onEnterFolder(name);
								}}
								data-terminay-root-folder-entry={name}
							>
								<Folder size={14} aria-hidden="true" />
								<span className="root-folder-browser__entry-name">
									{typedLength > 0 ? (
										<mark>{name.slice(0, typedLength)}</mark>
									) : null}
									{name.slice(typedLength)}
								</span>
								<span
									className="root-folder-browser__entry-key"
									aria-hidden="true"
								>
									⇥
								</span>
							</div>
						))}
					</div>
				) : folder !== undefined ? (
					<div className="root-folder-browser__message">
						{segment.length > 0
							? 'No folders match.'
							: 'This folder holds no folders.'}
					</div>
				) : null}
				{folder?.truncated ? (
					<div
						className="root-folder-browser__message"
						data-terminay-root-folder-truncated="true"
					>
						Showing the first {folder.entries.length} folders. Type a full name
						to open one not listed.
					</div>
				) : null}
			</div>
			<div className="project-edit-actions">
				<div className="root-folder-browser__keys" aria-hidden="true">
					<span>
						<kbd>⇥</kbd> complete
					</span>
					<span>
						<kbd>→</kbd> accept
					</span>
					<span>
						<kbd>↵</kbd> open
					</span>
				</div>
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="root-folder-browser__choose"
					disabled={targetName === null || choosing}
					onMouseDown={(event) => event.preventDefault()}
					onClick={onChoose}
					title={targetName === null ? undefined : `Open ${targetName}`}
					data-terminay-root-folder-choose="true"
				>
					{targetName === null ? 'Open' : `Open “${targetName}”`}
				</button>
			</div>
		</div>
	);
}
