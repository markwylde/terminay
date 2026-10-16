import type { BrowseRootFoldersResult } from '@terminay/client-core';
import { ArrowUp, Folder, FolderOpen } from 'lucide-react';
import { type JSX, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InPageWindow } from '../shared/inPageWindow/InPageWindow';
import { childFolderPath } from './projectStart';
import {
	listedFolder,
	RootFolderNavigator,
	type RootFolderListing,
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
	const navigatorRef = useRef<RootFolderNavigator | null>(null);
	// A path typed while a listing loads is kept when that listing lands.
	const pathEditedRef = useRef(false);

	useEffect(() => {
		const navigator = new RootFolderNavigator(browse, (next) => {
			setListing(next);
			if (next.state === 'ready' && !pathEditedRef.current)
				setTypedPath(next.folder.path);
		});
		navigatorRef.current = navigator;
		// Opens at the server account's home.
		void navigator.open();
		return () => navigator.dispose();
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
				typedPath={typedPath}
				onTypedPathChange={(path) => {
					pathEditedRef.current = true;
					setTypedPath(path);
				}}
				onOpen={(path) => {
					pathEditedRef.current = false;
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
	onTypedPathChange: (path: string) => void;
	onOpen: (path: string) => void;
	onChoose: (path: string) => void;
	onCancel: () => void;
}>;

/** What the browser window holds: the path field, the listing, and its
 * actions. */
export function RootFolderBrowserView({
	listing,
	typedPath,
	onTypedPathChange,
	onOpen,
	onChoose,
	onCancel,
}: RootFolderBrowserViewProps): JSX.Element {
	const pathInputId = useId();
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
				<input
					id={pathInputId}
					type="text"
					autoComplete="off"
					spellCheck={false}
					placeholder="Type or paste a folder path"
					value={typedPath}
					onChange={(event) => onTypedPathChange(event.target.value)}
					data-terminay-root-folder-path="true"
				/>
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
								onClick={() => onOpen(childFolderPath(folder.path, entry.name))}
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
					Showing the first {listing.folder.entries.length} folders. Type a path
					to go to one not listed.
				</div>
			) : null}
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
