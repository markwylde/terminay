/**
 * Environment › Files: browse the bot's home, whether its container runs or
 * not. The server's helper does every operation; this view never follows a
 * link, and shows credential links as locked.
 */

import { type BotFilesClient, BotIoClient } from '@terminay/client-core';
import type { BotFileEntry, BotProfile } from '@terminay/protocol';
import {
	ChevronRight,
	Download,
	Eye,
	File,
	Folder,
	FolderOpen,
	FolderPlus,
	Link2,
	Lock,
	MoreHorizontal,
	Pencil,
	Trash2,
	Upload,
} from 'lucide-react';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	ContextMenu,
	type ContextMenuItem,
} from '../../components/ContextMenu';
import { saveDownload } from '../../host/nativeActions';
import { formatBytes } from './BotEnvironmentPanel';
import { shortAge } from './botsModel';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';

export const MAX_UPLOAD_BYTES = 1024 ** 3;
const PREVIEW_BYTES = 256 * 1024;
const CHUNK = 512 * 1024;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function joinPath(dir: string, name: string): string {
	return dir === '.' ? name : `${dir}/${name}`;
}

export function parentPath(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '.' : path.slice(0, i);
}

/** Folders first, then by name. */
export function sortEntries(entries: readonly BotFileEntry[]): BotFileEntry[] {
	return [...entries].sort(
		(a, b) =>
			Number(b.kind === 'dir') - Number(a.kind === 'dir') ||
			a.name.localeCompare(b.name),
	);
}

async function collect(
	chunks: AsyncIterable<Uint8Array>,
	limit = Number.POSITIVE_INFINITY,
): Promise<{ bytes: Uint8Array; cut: boolean }> {
	const parts: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of chunks) {
		parts.push(chunk);
		size += chunk.length;
		if (size >= limit) break;
	}
	const bytes = new Uint8Array(Math.min(size, limit));
	let at = 0;
	for (const part of parts) {
		const take = Math.min(part.length, bytes.length - at);
		bytes.set(part.subarray(0, take), at);
		at += take;
		if (at >= bytes.length) break;
	}
	return { bytes, cut: size > limit };
}

async function* fileChunks(file: Blob): AsyncIterable<Uint8Array> {
	for (let at = 0; at < file.size; at += CHUNK)
		yield new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
}

type Preview =
	| { kind: 'text'; path: string; text: string; cut: boolean }
	| { kind: 'image'; path: string; url: string };

/** An open row menu, bound to the folder and entry it was opened for. */
type RowMenu = {
	entry: BotFileEntry;
	dir: string;
	x: number;
	y: number;
	keyboard: boolean;
};

/** Whether an entry has a row menu at all. Credential links never do. */
export function hasRowMenu(entry: BotFileEntry): boolean {
	return entry.kind !== 'credential-link';
}

/** The row menu's actions for an entry's kind, in menu order. */
export function rowMenuActions(
	entry: BotFileEntry,
): readonly ('open' | 'preview' | 'download' | 'rename' | 'delete')[] {
	if (entry.kind === 'credential-link') return [];
	if (entry.kind === 'dir') return ['open', 'download', 'rename', 'delete'];
	if (entry.kind === 'file') return ['preview', 'download', 'rename', 'delete'];
	return ['rename', 'delete'];
}

/** A `contextmenu` from the keyboard (context-menu key, Shift+F10) has no pointer. */
function fromKeyboard(event: ReactMouseEvent): boolean {
	return event.button !== 2 || (event.clientX === 0 && event.clientY === 0);
}

function belowElement(element: Element): { x: number; y: number } {
	const box = element.getBoundingClientRect();
	return { x: box.left, y: box.bottom };
}

/** The context menu's minimum width (`.context-menu` in App.css). */
const MENU_WIDTH = 180;

/** Below a right-aligned trigger, with the menu's right edge on the trigger's. */
function belowRightEdge(element: Element): { x: number; y: number } {
	const box = element.getBoundingClientRect();
	return { x: Math.max(8, box.right - MENU_WIDTH), y: box.bottom };
}

export function BotFilesView({
	server,
	bot,
}: Readonly<{ server: ServerBots; bot: BotProfile }>) {
	const now = useNow(60_000);
	const io = useMemo(
		() => new BotIoClient(server.transport as never),
		[server.transport],
	);
	const [files, setFiles] = useState<BotFilesClient>();
	const [dir, setDir] = useState('.');
	const [listing, setListing] = useState<{
		files: BotFilesClient;
		dir: string;
		entries: readonly BotFileEntry[];
		truncated: boolean;
	}>();
	const entries =
		listing?.files === files && listing?.dir === dir
			? listing.entries
			: undefined;
	const listingScope = useMemo(
		() => ({ active: true, request: 0 }),
		[files, dir],
	);
	const truncated = entries !== undefined && listing?.truncated === true;
	const [error, setError] = useState<string>();
	const [preview, setPreview] = useState<Preview>();
	const [renaming, setRenaming] = useState<string>();
	const [confirmDelete, setConfirmDelete] = useState<string>();
	const [menu, setMenu] = useState<RowMenu>();
	const triggers = useRef(new Map<string, HTMLButtonElement>());
	const restoreFocus = useRef<string | undefined>(undefined);
	const [progress, setProgress] = useState<string>();
	const [newFolder, setNewFolder] = useState(false);
	const upload = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let live = true;
		let opened: BotFilesClient | undefined;
		io.files(bot.id)
			.then((client) => {
				if (!live) {
					void client.close();
					return;
				}
				opened = client;
				setFiles(client);
			})
			.catch((cause: unknown) => {
				if (live) setError(refusalText(cause));
			});
		return () => {
			live = false;
			void opened?.close();
		};
	}, [io, bot.id]);

	const list = useCallback(() => {
		if (files === undefined || !listingScope.active) return;
		const request = ++listingScope.request;
		files
			.list(dir)
			.then((result) => {
				if (!listingScope.active || request !== listingScope.request) return;
				setListing({
					files,
					dir,
					entries: sortEntries(result.entries),
					truncated: result.truncated,
				});
				setError(undefined);
			})
			.catch((cause: unknown) => {
				if (listingScope.active && request === listingScope.request)
					setError(refusalText(cause));
			});
	}, [files, dir, listingScope]);
	useEffect(() => {
		listingScope.active = true;
		list();
		return () => {
			listingScope.active = false;
		};
	}, [list, listingScope]);

	// The folder updates when its contents change.
	useEffect(() => {
		if (files === undefined) return;
		let stop: (() => void) | undefined;
		let live = true;
		files
			.watch([dir], list)
			.then((unwatch) => {
				if (live) stop = unwatch;
				else unwatch();
			})
			.catch(() => {});
		return () => {
			live = false;
			stop?.();
		};
	}, [files, dir, list]);

	useEffect(
		() => () => {
			if (preview?.kind === 'image') URL.revokeObjectURL(preview.url);
		},
		[preview],
	);

	// A menu or confirmation never outlives its folder or its entry.
	useEffect(() => {
		setMenu((open) => (open && open.dir !== dir ? undefined : open));
		setConfirmDelete(undefined);
		setRenaming(undefined);
		restoreFocus.current = undefined;
	}, [dir]);
	useEffect(() => {
		if (entries === undefined) return;
		const byName = new Map(entries.map((entry) => [entry.name, entry]));
		setMenu((open) =>
			open && byName.get(open.entry.name)?.kind !== open.entry.kind
				? undefined
				: open,
		);
		setConfirmDelete((name) =>
			name !== undefined &&
			(!byName.has(name) || byName.get(name)?.kind === 'credential-link')
				? undefined
				: name,
		);
	}, [entries]);

	// Once a menu or confirmation has gone, focus returns to the row's button
	// unless something else (the rename field, a clicked control) took it.
	useEffect(() => {
		const name = restoreFocus.current;
		if (name === undefined || menu !== undefined || confirmDelete !== undefined)
			return;
		restoreFocus.current = undefined;
		const active = document.activeElement;
		if (active !== null && active !== document.body && active.isConnected)
			return;
		triggers.current.get(name)?.focus();
	});

	const openMenu = (
		entry: BotFileEntry,
		at: { x: number; y: number },
		keyboard: boolean,
	) => {
		if (!hasRowMenu(entry)) return;
		setConfirmDelete(undefined);
		setMenu({ entry, dir, ...at, keyboard });
	};
	const closeMenu = useCallback(() => {
		setMenu((open) => {
			if (open) restoreFocus.current = open.entry.name;
			return undefined;
		});
	}, []);
	const rowContextMenu = (entry: BotFileEntry, event: ReactMouseEvent) => {
		event.preventDefault();
		if (!hasRowMenu(entry)) return;
		if (fromKeyboard(event)) {
			const target =
				document.activeElement instanceof Element &&
				event.currentTarget.contains(document.activeElement)
					? document.activeElement
					: event.currentTarget;
			openMenu(entry, belowElement(target), true);
		} else openMenu(entry, { x: event.clientX, y: event.clientY }, false);
	};
	const rowKeyDown = (entry: BotFileEntry, event: ReactKeyboardEvent) => {
		if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))
			return;
		event.preventDefault();
		if (!hasRowMenu(entry)) return;
		const target =
			event.target instanceof Element ? event.target : event.currentTarget;
		openMenu(entry, belowElement(target), true);
	};

	const run = (label: string, work: () => Promise<unknown>) => {
		setProgress(label);
		setError(undefined);
		work()
			.then(list)
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setProgress(undefined));
	};

	const openEntry = (entry: BotFileEntry, from = dir) => {
		if (files === undefined || entry.kind === 'credential-link') return;
		const path = joinPath(from, entry.name);
		if (entry.kind === 'dir') {
			setDir(path);
			setPreview(undefined);
			return;
		}
		if (entry.kind !== 'file') return;
		collect(files.read(path), PREVIEW_BYTES)
			.then(({ bytes, cut }) => {
				if (IMAGE.test(entry.name) && !cut) {
					const type = entry.name.toLowerCase().endsWith('.svg')
						? 'image/svg+xml'
						: '';
					setPreview({
						kind: 'image',
						path,
						url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })),
					});
				} else {
					setPreview({
						kind: 'text',
						path,
						text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
						cut,
					});
				}
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	};

	const download = (entry: BotFileEntry, from = dir) => {
		if (files === undefined) return;
		const path = joinPath(from, entry.name);
		// Desktop denies browser downloads, so the host saves the stream to a
		// destination the user picks first (ADR-0130).
		run(`Downloading ${entry.name}…`, async () => {
			await saveDownload({
				filename: entry.kind === 'dir' ? `${entry.name}.tar` : entry.name,
				chunks: () =>
					entry.kind === 'dir' ? files.downloadFolder(path) : files.read(path),
			});
		});
	};

	const uploadFiles = (list: FileList | null) => {
		if (files === undefined || list === null) return;
		const chosen = [...list];
		const tooBig = chosen.find((f) => f.size > MAX_UPLOAD_BYTES);
		if (tooBig !== undefined) {
			setError(`${tooBig.name} is larger than 1 GiB.`);
			return;
		}
		run(
			`Uploading ${chosen.length} file${chosen.length === 1 ? '' : 's'}…`,
			async () => {
				for (const file of chosen)
					await files.write(
						joinPath(dir, file.name),
						file.size,
						fileChunks(file),
					);
			},
		);
	};

	const menuItems = (open: RowMenu): ContextMenuItem[] => {
		const { entry } = open;
		const items: ContextMenuItem[] = [];
		for (const action of rowMenuActions(entry)) {
			if (action === 'open')
				items.push({
					label: 'Open',
					icon: <FolderOpen size={14} />,
					onClick: () => {
						setDir(joinPath(open.dir, entry.name));
						setPreview(undefined);
					},
				});
			else if (action === 'preview')
				items.push({
					label: 'Preview',
					icon: <Eye size={14} />,
					onClick: () => openEntry(entry, open.dir),
				});
			else if (action === 'download')
				items.push({
					label: 'Download',
					icon: <Download size={14} />,
					onClick: () => download(entry, open.dir),
				});
			else if (action === 'rename')
				items.push({
					label: 'Rename',
					icon: <Pencil size={14} />,
					onClick: () => setRenaming(entry.name),
				});
			else {
				items.push({ label: '', separator: true, key: 'before-delete' });
				items.push({
					label: 'Delete',
					icon: <Trash2 size={14} />,
					danger: true,
					onClick: () => setConfirmDelete(entry.name),
				});
			}
		}
		return items;
	};

	const crumbs = dir === '.' ? [] : dir.split('/');

	return (
		<div className="bots-files" data-terminay-bot-files={dir}>
			{menu ? (
				<ContextMenu
					key={`${menu.dir}/${menu.entry.name}`}
					x={menu.x}
					y={menu.y}
					items={menuItems(menu)}
					onClose={closeMenu}
					keyboard={{ autoFocus: menu.keyboard }}
					label={`Actions for ${menu.entry.name}`}
				/>
			) : null}
			<div className="bots-files__bar">
				<nav className="bots-crumbs" aria-label="Folder">
					<button
						type="button"
						className="bots-link"
						onClick={() => setDir('.')}
					>
						/home/bot
					</button>
					{crumbs.map((part, i) => (
						<span key={`${i}:${part}`}>
							<ChevronRight size={12} aria-hidden="true" />
							<button
								type="button"
								className="bots-link"
								onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}
							>
								{part}
							</button>
						</span>
					))}
				</nav>
				<div className="bots-row-actions">
					{newFolder ? (
						<form
							className="bots-token-row"
							onSubmit={(event) => {
								event.preventDefault();
								const input = event.currentTarget.elements.namedItem(
									'folder',
								) as HTMLInputElement;
								setNewFolder(false);
								if (input.value && files)
									run('Creating folder…', () =>
										files.mkdir(joinPath(dir, input.value)),
									);
							}}
						>
							<input
								name="folder"
								className="bots-in"
								placeholder="Folder name"
								aria-label="New folder name"
								autoFocus
								onBlur={() => setNewFolder(false)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') setNewFolder(false);
								}}
							/>
						</form>
					) : (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							disabled={files === undefined}
							onClick={() => setNewFolder(true)}
						>
							<FolderPlus size={13} aria-hidden="true" /> New folder
						</button>
					)}
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						disabled={files === undefined}
						onClick={() => upload.current?.click()}
						data-terminay-bot-files-upload="true"
					>
						<Upload size={13} aria-hidden="true" /> Upload
					</button>
					<input
						ref={upload}
						type="file"
						multiple
						hidden
						onChange={(event) => {
							uploadFiles(event.target.files);
							event.target.value = '';
						}}
					/>
				</div>
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			{progress ? <div className="bots-note">{progress}</div> : null}
			<div className="bots-files__body">
				<div className="bots-scroll bots-files__list">
					{entries === undefined ? (
						<p className="bots-faint bots-pad">
							{files === undefined ? 'Opening the bot’s home…' : 'Loading…'}
						</p>
					) : (
						<table className="bots-tbl">
							<thead>
								<tr>
									<th>Name</th>
									<th>Size</th>
									<th>Changed</th>
									<th>
										<span className="bots-sr">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{dir !== '.' ? (
									<tr>
										<td colSpan={4}>
											<button
												type="button"
												className="bots-rowbtn"
												onClick={() => setDir(parentPath(dir))}
											>
												<Folder size={14} aria-hidden="true" /> ..
											</button>
										</td>
									</tr>
								) : null}
								{entries.map((entry) => {
									const locked = entry.kind === 'credential-link';
									const path = joinPath(dir, entry.name);
									return (
										<tr
											key={entry.name}
											className={preview?.path === path ? 'bots-tbl--sel' : ''}
											data-terminay-bot-file={entry.name}
											data-terminay-bot-file-kind={entry.kind}
											onContextMenu={(event) => rowContextMenu(entry, event)}
											onKeyDown={(event) => rowKeyDown(entry, event)}
										>
											<td>
												{renaming === entry.name ? (
													<form
														onSubmit={(event) => {
															event.preventDefault();
															const input =
																event.currentTarget.elements.namedItem(
																	'name',
																) as HTMLInputElement;
															setRenaming(undefined);
															if (
																input.value &&
																input.value !== entry.name &&
																files
															)
																run('Renaming…', () =>
																	files.rename(
																		path,
																		joinPath(dir, input.value),
																	),
																);
														}}
													>
														<input
															name="name"
															className="bots-in"
															defaultValue={entry.name}
															autoFocus
															onBlur={() => setRenaming(undefined)}
														/>
													</form>
												) : (
													<button
														type="button"
														className="bots-rowbtn"
														disabled={
															locked ||
															entry.kind === 'link' ||
															entry.kind === 'other'
														}
														onClick={() => openEntry(entry)}
														title={
															locked
																? 'A credential link. It cannot be opened, downloaded, renamed, or deleted.'
																: entry.kind === 'link'
																	? 'Links are never followed.'
																	: entry.name
														}
													>
														{locked ? (
															<Lock size={14} aria-label="Credential link" />
														) : entry.kind === 'dir' ? (
															<Folder size={14} aria-hidden="true" />
														) : entry.kind === 'link' ? (
															<Link2 size={14} aria-hidden="true" />
														) : (
															<File size={14} aria-hidden="true" />
														)}
														<span className="bots-files__name">
															{entry.name}
														</span>
													</button>
												)}
											</td>
											<td>
												{entry.kind === 'file' ? formatBytes(entry.size) : ''}
											</td>
											<td>{shortAge(entry.mtime, now)}</td>
											<td>
												{locked ? (
													<span className="bots-faint">Locked</span>
												) : confirmDelete === entry.name ? (
													<div
														className="bots-row-actions bots-files__confirm"
														onKeyDown={(event) => {
															if (event.key !== 'Escape') return;
															event.stopPropagation();
															restoreFocus.current = entry.name;
															setConfirmDelete(undefined);
														}}
													>
														<button
															type="button"
															className="bots-btn bots-btn--sm bots-btn--danger"
															autoFocus
															aria-label={`Delete ${entry.name}`}
															onClick={() => {
																setConfirmDelete(undefined);
																if (files)
																	run('Deleting…', () => files.delete(path));
															}}
														>
															Delete
														</button>
														<button
															type="button"
															className="bots-btn bots-btn--sm"
															onClick={() => {
																restoreFocus.current = entry.name;
																setConfirmDelete(undefined);
															}}
														>
															Cancel
														</button>
													</div>
												) : (
													<button
														type="button"
														ref={(button) => {
															if (button)
																triggers.current.set(entry.name, button);
															else triggers.current.delete(entry.name);
														}}
														className="bots-icon-btn bots-files__more"
														aria-label={`More actions for ${entry.name}`}
														aria-haspopup="menu"
														aria-expanded={menu?.entry.name === entry.name}
														data-terminay-bot-file-more={entry.name}
														onMouseDown={(event) => {
															// The open menu closes on any outside press; a press
															// on its own button toggles it instead.
															if (menu?.entry.name === entry.name)
																event.nativeEvent.stopPropagation();
														}}
														onClick={(event) => {
															if (menu?.entry.name === entry.name) {
																closeMenu();
																return;
															}
															openMenu(
																entry,
																belowRightEdge(event.currentTarget),
																event.detail === 0,
															);
														}}
													>
														<MoreHorizontal size={16} aria-hidden="true" />
													</button>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
					{truncated ? (
						<p className="bots-faint bots-pad">
							This folder has more entries than can be listed.
						</p>
					) : null}
				</div>
				{preview !== undefined ? (
					<aside className="bots-card bots-files__preview" aria-label="Preview">
						<div className="bots-toolbar bots-toolbar--tight">
							<span className="bots-mono bots-faint">{preview.path}</span>
							<button
								type="button"
								className="bots-link"
								onClick={() => setPreview(undefined)}
							>
								Close
							</button>
						</div>
						{preview.kind === 'image' ? (
							<img src={preview.url} alt={preview.path} />
						) : (
							<pre>
								{preview.text}
								{preview.cut ? '\n… (preview shows the first 256 KiB)' : ''}
							</pre>
						)}
					</aside>
				) : null}
			</div>
		</div>
	);
}
