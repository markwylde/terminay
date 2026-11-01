/**
 * A bot's memories: the Markdown files in its home's `memories` directory.
 * Works whether the container runs or not; a memory the bot writes appears
 * without reloading, because the tab watches the directory while it is open.
 */

import type { BotMemory, BotProfile } from '@terminay/protocol';
import { Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shortAge } from './botsModel';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';

export const PINNED_CONTEXT_BYTES = 16 * 1024;

/** A file name for a new memory's title. */
export function memoryFileName(title: string): string {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug.length > 0 ? slug : 'memory'}.md`;
}

export function BotMemoriesPanel({
	server,
	bot,
}: Readonly<{ server: ServerBots; bot: BotProfile }>) {
	const now = useNow();
	const [search, setSearch] = useState('');
	const [memories, setMemories] = useState<readonly BotMemory[]>();
	const [selected, setSelected] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string>();
	const { client } = server;

	// Watch the directory while the tab is open, so the bot's own writes show.
	useEffect(() => {
		let stop: (() => Promise<void>) | undefined;
		let live = true;
		client
			.watchMemories(bot.id)
			.then((unwatch) => {
				if (live) stop = unwatch;
				else void unwatch().catch(() => {});
			})
			.catch(() => {});
		return () => {
			live = false;
			void stop?.().catch(() => {});
		};
	}, [client, bot.id]);

	useEffect(() => {
		let live = true;
		const timer = setTimeout(() => {
			client
				.memories(bot.id, search.trim())
				.then((list) => {
					if (!live) return;
					setMemories(list);
					setError(undefined);
				})
				.catch((cause: unknown) => {
					if (live) setError(refusalText(cause));
				});
		}, 150);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [client, bot.id, search, server.revision, bot.pinnedMemories]);

	const pinnedCount = bot.pinnedMemories.length;
	const current = memories?.find((m) => m.path === selected);

	return (
		<div className="bots-sesswrap" data-terminay-bot-panel="memories">
			<div className="bots-slist">
				<div className="bots-stool">
					<div className="bots-toolbar bots-toolbar--tight">
						<label className="bots-filter-input">
							<Search size={14} aria-hidden="true" />
							<span className="bots-sr">Search memories</span>
							<input
								value={search}
								placeholder="Search memories…"
								onChange={(event) => setSearch(event.target.value)}
							/>
						</label>
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => {
								setCreating(true);
								setSelected(undefined);
							}}
							data-terminay-bot-memory-new="true"
						>
							<Plus size={13} aria-hidden="true" /> New
						</button>
					</div>
					<p className="bots-faint">
						{pinnedCount} pinned. Pinned memories, newest first, up to 16 KiB,
						start every session.
					</p>
				</div>
				<div className="bots-scroll bots-slist__rows">
					{error ? (
						<div className="bots-note bots-note--error">{error}</div>
					) : null}
					{memories === undefined ? (
						<p className="bots-faint bots-pad">Loading memories…</p>
					) : memories.length === 0 ? (
						<p className="bots-faint bots-pad">
							{search ? 'No memories match.' : 'No memories yet.'}
						</p>
					) : (
						memories.map((memory) => (
							<button
								key={memory.path}
								type="button"
								className={`bots-srow${memory.path === selected ? ' bots-srow--on' : ''}`}
								onClick={() => {
									setCreating(false);
									setSelected(memory.path);
								}}
								data-terminay-bot-memory={memory.path}
							>
								<span className="bots-srow__body">
									<span className="bots-stitle">
										{memory.pinned ? (
											<Pin size={11} aria-label="Pinned" className="bots-pin" />
										) : null}
										{memory.title}
									</span>
									<span className="bots-smeta">
										<span className="bots-mono">{memory.path}</span>
										<span>{shortAge(memory.modifiedAt, now)}</span>
									</span>
								</span>
							</button>
						))
					)}
				</div>
			</div>
			<div className="bots-sdetail bots-scroll">
				{creating ? (
					<MemoryEditor
						key="new"
						server={server}
						bot={bot}
						memory={undefined}
						onSaved={(path) => {
							setCreating(false);
							setSelected(path);
						}}
						onDeleted={() => setCreating(false)}
					/>
				) : current !== undefined ? (
					<MemoryEditor
						key={current.path}
						server={server}
						bot={bot}
						memory={current}
						onSaved={() => {}}
						onDeleted={() => setSelected(undefined)}
					/>
				) : (
					<div className="bots-placeholder">
						<b>Memories</b>
						<span>
							Markdown notes in the bot’s home. The bot reads and writes them;
							you can too.
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

function MemoryEditor({
	server,
	bot,
	memory,
	onSaved,
	onDeleted,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	memory: BotMemory | undefined;
	onSaved: (path: string) => void;
	onDeleted: () => void;
}>) {
	const [title, setTitle] = useState('');
	const [text, setText] = useState<string>();
	const [saved, setSaved] = useState<string>();
	const [error, setError] = useState<string>();
	const [confirming, setConfirming] = useState(false);
	const { client } = server;
	const path = memory?.path;

	useEffect(() => {
		if (path === undefined) {
			setText('');
			setSaved('');
			return;
		}
		let live = true;
		client
			.memory(bot.id, path)
			.then((contents) => {
				if (!live) return;
				setText((current) =>
					current === undefined || current === saved ? contents : current,
				);
				setSaved(contents);
			})
			.catch((cause: unknown) => {
				if (live) setError(refusalText(cause));
			});
		return () => {
			live = false;
		};
		// Reload when the file changes underneath, keeping unsaved edits.
	}, [client, bot.id, path, memory?.modifiedAt]);

	const dirty = text !== undefined && text !== saved;
	const save = () => {
		if (text === undefined) return;
		const target = path ?? memoryFileName(title);
		const contents =
			path === undefined && title.trim().length > 0 && !text.startsWith('#')
				? `# ${title.trim()}\n\n${text}`
				: text;
		setError(undefined);
		client
			.writeMemory(bot.id, target, contents)
			.then(() => {
				setSaved(contents);
				setText(contents);
				server.refreshBot(bot.id);
				onSaved(target);
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	};

	return (
		<div
			className="bots-memory"
			data-terminay-bot-memory-editor={path ?? 'new'}
		>
			<div className="bots-toolbar">
				{path === undefined ? (
					<label className="bots-field bots-grow">
						<span>Title</span>
						<input
							value={title}
							placeholder="Deploy notes"
							onChange={(event) => setTitle(event.target.value)}
							data-terminay-bot-memory-title="true"
						/>
					</label>
				) : (
					<div>
						<h3 className="bots-h3">{memory?.title}</h3>
						<span className="bots-faint bots-mono">memories/{path}</span>
					</div>
				)}
				<div className="bots-row-actions">
					{memory !== undefined ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							aria-pressed={memory.pinned}
							onClick={() =>
								client
									.pinMemory(bot.id, memory.path, !memory.pinned)
									.then(() => server.refreshBot(bot.id))
									.catch((cause: unknown) => setError(refusalText(cause)))
							}
							data-terminay-bot-memory-pin={memory.pinned ? 'on' : 'off'}
						>
							{memory.pinned ? (
								<>
									<PinOff size={13} aria-hidden="true" /> Unpin
								</>
							) : (
								<>
									<Pin size={13} aria-hidden="true" /> Pin
								</>
							)}
						</button>
					) : null}
					{memory !== undefined ? (
						confirming ? (
							<button
								type="button"
								className="bots-btn bots-btn--sm bots-btn--danger"
								onClick={() =>
									client
										.deleteMemory(bot.id, memory.path)
										.then(() => {
											server.refreshBot(bot.id);
											onDeleted();
										})
										.catch((cause: unknown) => setError(refusalText(cause)))
								}
							>
								Delete memory
							</button>
						) : (
							<button
								type="button"
								className="bots-icon-btn"
								aria-label="Delete memory"
								onClick={() => setConfirming(true)}
							>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						)
					) : null}
					<button
						type="button"
						className="bots-btn bots-btn--sm bots-btn--primary"
						disabled={
							text === undefined ||
							(path === undefined ? title.trim().length === 0 : !dirty)
						}
						onClick={save}
						data-terminay-bot-memory-save="true"
					>
						Save
					</button>
				</div>
			</div>
			{error ? <div className="bots-note bots-note--error">{error}</div> : null}
			{text === undefined ? (
				<p className="bots-faint">Loading…</p>
			) : (
				<textarea
					className="bots-in bots-memory__text bots-mono"
					value={text}
					aria-label="Memory text"
					onChange={(event) => setText(event.target.value)}
					data-terminay-bot-memory-text="true"
				/>
			)}
		</div>
	);
}
