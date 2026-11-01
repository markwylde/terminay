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
	File,
	Folder,
	FolderPlus,
	Link2,
	Lock,
	Pencil,
	Trash2,
	Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function save(name: string, bytes: Uint8Array) {
	const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Preview =
	| { kind: 'text'; path: string; text: string; cut: boolean }
	| { kind: 'image'; path: string; url: string };

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
	const [entries, setEntries] = useState<readonly BotFileEntry[]>();
	const [truncated, setTruncated] = useState(false);
	const [error, setError] = useState<string>();
	const [preview, setPreview] = useState<Preview>();
	const [renaming, setRenaming] = useState<string>();
	const [confirmDelete, setConfirmDelete] = useState<string>();
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
		if (files === undefined) return;
		files
			.list(dir)
			.then((listing) => {
				setEntries(sortEntries(listing.entries));
				setTruncated(listing.truncated);
				setError(undefined);
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	}, [files, dir]);
	useEffect(list, [list]);

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

	const run = (label: string, work: () => Promise<unknown>) => {
		setProgress(label);
		setError(undefined);
		work()
			.then(list)
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setProgress(undefined));
	};

	const open = (entry: BotFileEntry) => {
		if (files === undefined || entry.kind === 'credential-link') return;
		const path = joinPath(dir, entry.name);
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

	const download = (entry: BotFileEntry) => {
		if (files === undefined) return;
		const path = joinPath(dir, entry.name);
		run(`Downloading ${entry.name}…`, async () => {
			const { bytes } = await collect(
				entry.kind === 'dir' ? files.downloadFolder(path) : files.read(path),
			);
			save(entry.kind === 'dir' ? `${entry.name}.tar` : entry.name, bytes);
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

	const crumbs = dir === '.' ? [] : dir.split('/');

	return (
		<div className="bots-files" data-terminay-bot-files={dir}>
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
														onClick={() => open(entry)}
														title={
															locked
																? 'A credential link. It cannot be opened, downloaded, renamed, or deleted.'
																: entry.kind === 'link'
																	? 'Links are never followed.'
																	: undefined
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
														{entry.name}
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
												) : (
													<div className="bots-row-actions">
														{entry.kind === 'file' || entry.kind === 'dir' ? (
															<button
																type="button"
																className="bots-icon-btn"
																aria-label={`Download ${entry.name}`}
																onClick={() => download(entry)}
															>
																<Download size={14} aria-hidden="true" />
															</button>
														) : null}
														<button
															type="button"
															className="bots-icon-btn"
															aria-label={`Rename ${entry.name}`}
															onClick={() => setRenaming(entry.name)}
														>
															<Pencil size={14} aria-hidden="true" />
														</button>
														{confirmDelete === entry.name ? (
															<button
																type="button"
																className="bots-btn bots-btn--sm bots-btn--danger"
																onClick={() => {
																	setConfirmDelete(undefined);
																	if (files)
																		run('Deleting…', () => files.delete(path));
																}}
															>
																Delete
															</button>
														) : (
															<button
																type="button"
																className="bots-icon-btn"
																aria-label={`Delete ${entry.name}`}
																onClick={() => setConfirmDelete(entry.name)}
															>
																<Trash2 size={14} aria-hidden="true" />
															</button>
														)}
													</div>
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
