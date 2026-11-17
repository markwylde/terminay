/** A message composer: text, files by button, drop and paste, and an
 * idempotent send. Chat's main stream and each thread panel have their own. */
import type { BotMessagesClient } from '@terminay/client-core';
import type { BotMessage } from '@terminay/protocol';
import { FileText, Paperclip, X } from 'lucide-react';
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	acceptChatFiles,
	type ChatSendAttempt,
	chatFileKind,
	chatSendAttempt,
	formatFileSize,
} from './botsModel';
import { useFitTextarea } from './useFitTextarea';
import { refusalText } from './useServerBots';

interface PendingFile {
	readonly key: string;
	readonly file: File;
	readonly kind: 'image' | 'file';
	/** Display name sent with the upload; pasted files get a generated one. */
	readonly name: string;
	/** Thumbnail object URL, for images only. */
	readonly url: string | undefined;
}

export type BotPostResult = Readonly<{
	message: BotMessage;
	sessionId?: string;
	error?: string;
}>;

export function BotComposer({
	client,
	botId,
	draft,
	onDraftChange,
	clearSentDraft,
	threadId,
	label,
	placeholder,
	inputRef,
	actions,
	onPosted,
	onSignIn,
}: Readonly<{
	client: BotMessagesClient;
	botId: string;
	draft: string;
	onDraftChange: (value: string) => void;
	/** Clears the draft if it still reads `sent`, against the owner's current
	 * state; for a composer that can unmount before its post completes. */
	clearSentDraft?: (sent: string) => void;
	/** Post replies into this thread; absent for the main stream. */
	threadId?: string;
	label: string;
	placeholder: string;
	/** The textarea, for callers that move focus or the caret into it. */
	inputRef?: (element: HTMLTextAreaElement | null) => void;
	/** Extra controls beside the attach button. */
	actions?: ReactNode;
	/** A post was accepted; `result.error` is a start failure, if any. */
	onPosted: (result: BotPostResult) => void;
	onSignIn: () => void;
}>) {
	const [sending, setSending] = useState(false),
		[error, setError] = useState<string>();
	// Files waiting to be sent. Each keeps the upload token it was given, so a
	// retry of the same attempt does not upload or post it twice.
	const [pending, setPending] = useState<readonly PendingFile[]>([]),
		[attachError, setAttachError] = useState<string>(),
		[dragging, setDragging] = useState(false);
	const picker = useRef<HTMLInputElement>(null),
		mounted = useRef(false),
		pendingRef = useRef(pending),
		attempt = useRef<ChatSendAttempt | undefined>(undefined),
		tokens = useRef(new Map<string, string>()),
		pasted = useRef(0),
		draftRef = useRef(draft);
	pendingRef.current = pending;
	draftRef.current = draft;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			for (const item of pendingRef.current)
				if (item.url) URL.revokeObjectURL(item.url);
		};
	}, []);
	const fit = useFitTextarea(draft),
		textareaRef = useCallback(
			(element: HTMLTextAreaElement | null) => {
				fit(element);
				inputRef?.(element);
			},
			[fit, inputRef],
		);
	// Files are classified by their first bytes, as the server does, so a
	// thumbnail is shown only for content the server will store as an image.
	const addFiles = async (files: readonly File[]) => {
		if (!files.length) return;
		const offered = await Promise.all(
			files.map(async (file) => ({
				file,
				size: file.size,
				kind: chatFileKind(
					new Uint8Array(await file.slice(0, 12).arrayBuffer()),
				),
			})),
		).catch(() => {
			if (mounted.current)
				setAttachError(
					'The selected files could not be read. Try attaching them again.',
				);
			return undefined;
		});
		if (!mounted.current || !offered) return;
		const { accepted, refusal } = acceptChatFiles(
			pendingRef.current.length,
			offered,
		);
		setAttachError(refusal);
		if (!accepted.length) return;
		const added = accepted.map(({ file, kind }) => ({
			key: crypto.randomUUID(),
			file,
			kind,
			name:
				file.name && file.name !== 'image.png'
					? file.name
					: kind === 'image'
						? `pasted-${++pasted.current}.${file.type.split('/')[1] || 'png'}`
						: `pasted-${++pasted.current}`,
			url: kind === 'image' ? URL.createObjectURL(file) : undefined,
		}));
		pendingRef.current = [...pendingRef.current, ...added];
		setPending((current) => [...current, ...added]);
	};
	const removeFile = (key: string) => {
		setPending((current) => {
			const gone = current.find((item) => item.key === key);
			if (gone?.url) URL.revokeObjectURL(gone.url);
			return current.filter((item) => item.key !== key);
		});
		tokens.current.delete(key);
		setAttachError(undefined);
	};
	const clearFiles = (sent: readonly PendingFile[]) => {
		const keys = new Set(sent.map((item) => item.key));
		for (const item of sent) {
			if (item.url) URL.revokeObjectURL(item.url);
			tokens.current.delete(item.key);
		}
		setPending((current) => current.filter((item) => !keys.has(item.key)));
	};
	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...event.clipboardData.files];
		if (!files.length) return;
		// A screenshot paste carries no text; text alongside a file still pastes.
		if (!event.clipboardData.types.includes('text/plain'))
			event.preventDefault();
		void addFiles(files);
	};
	const hasFiles = (event: DragEvent) =>
		[...event.dataTransfer.types].includes('Files');
	const send = async () => {
		const images = pendingRef.current;
		if (sending || (!draft.trim() && !images.length)) return;
		// The thread is fixed when the send starts: a post already under way
		// lands in its own thread even if the panel moves on.
		const text = draft,
			thread = threadId;
		// The same text and images reuse the previous attempt's key, so a post
		// whose response was lost is replayed, not duplicated.
		const current = chatSendAttempt(
			attempt.current,
			JSON.stringify([text, images.map((image) => image.key), thread ?? null]),
			() => crypto.randomUUID(),
		);
		attempt.current = current;
		setSending(true);
		setError(undefined);
		setAttachError(undefined);
		try {
			const uploads: string[] = [];
			for (const image of images) {
				let token = tokens.current.get(image.key);
				if (!token) {
					const bytes = new Uint8Array(await image.file.arrayBuffer());
					token = (await client.upload(botId, image.name, bytes)).token;
					tokens.current.set(image.key, token);
				}
				uploads.push(token);
			}
			const result = await client.post(
				botId,
				text,
				current.key,
				uploads,
				thread,
			);
			attempt.current = undefined;
			if (clearSentDraft) clearSentDraft(text);
			else if (mounted.current && draftRef.current === text) onDraftChange('');
			onPosted(result);
			if (!mounted.current) return;
			clearFiles(images);
			// A start failure shows as the message's warning with Retry and
			// Dismiss; only a missing sign-in also needs the composer's link.
			if (
				result.error &&
				(result.message.dispatch?.state !== 'failed' ||
					/not signed in/.test(result.error))
			)
				setError(result.error);
		} catch (cause) {
			const message = refusalText(cause);
			// Staged uploads expire or vanish on restart: upload again next time.
			if (/no longer available/i.test(message)) {
				for (const image of images) tokens.current.delete(image.key);
				attempt.current = undefined;
			}
			if (mounted.current) setError(message);
		} finally {
			if (mounted.current) setSending(false);
		}
	};
	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === 'Enter' &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault();
			void send();
		}
	};
	return (
		<div className="bots-composer" data-terminay-bot-composer-thread={threadId}>
			{error ? (
				<div
					className="bots-note bots-note--error"
					role="alert"
					data-terminay-bot-chat-error="true"
				>
					{error}
					{error.includes('sign') ? (
						<button
							type="button"
							className="bots-link"
							data-terminay-bot-open-signin="true"
							onClick={onSignIn}
						>
							Open Sign-in
						</button>
					) : null}
				</div>
			) : null}
			<form
				className={dragging ? 'bots-composer--drop' : undefined}
				data-terminay-bot-composer-form="true"
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
				onDragOver={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = 'copy';
					setDragging(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node))
						setDragging(false);
				}}
				onDrop={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					setDragging(false);
					void addFiles([...event.dataTransfer.files]);
				}}
			>
				{pending.length ? (
					<ul
						className="bots-composer__images"
						aria-label="Files to send"
						data-terminay-bot-pending-images="true"
					>
						{pending.map((item) => (
							<li
								key={item.key}
								className={
									item.url
										? 'bots-composer__image'
										: 'bots-composer__image bots-composer__file'
								}
								data-terminay-bot-pending-kind={item.kind}
							>
								{item.url ? (
									<img src={item.url} alt={item.name} />
								) : (
									<>
										<FileText size={18} aria-hidden="true" />
										<span className="bots-composer__file-text">
											<span
												className="bots-composer__file-name"
												title={item.name}
											>
												{item.name}
											</span>
											<span className="bots-composer__file-size">
												{formatFileSize(item.file.size)}
											</span>
										</span>
									</>
								)}
								<button
									type="button"
									className="bots-composer__remove"
									aria-label={`Remove ${item.name}`}
									title={`Remove ${item.name}`}
									disabled={sending}
									onClick={() => removeFile(item.key)}
								>
									<X size={12} aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				) : null}
				{attachError ? (
					<p
						className="bots-composer__refusal"
						role="status"
						data-terminay-bot-attach-error="true"
					>
						{attachError}
					</p>
				) : null}
				<textarea
					ref={textareaRef}
					value={draft}
					rows={1}
					aria-label={label}
					placeholder={placeholder}
					onChange={(event) => onDraftChange(event.target.value)}
					onKeyDown={keyDown}
					onPaste={onPaste}
					data-terminay-bot-composer="true"
				/>
				<input
					ref={picker}
					type="file"
					hidden
					multiple
					data-terminay-bot-attach-input="true"
					onChange={(event) => {
						void addFiles([...(event.target.files ?? [])]);
						event.target.value = '';
					}}
				/>
				<div className="bots-composer__row">
					<div className="bots-composer__actions">
						<button
							type="button"
							className="bots-btn bots-btn--sm bots-btn--ghost bots-composer__attach"
							aria-label="Attach files"
							title="Attach files"
							disabled={sending}
							data-terminay-bot-attach="true"
							onClick={() => picker.current?.click()}
						>
							<Paperclip size={16} aria-hidden="true" />
						</button>
						{actions}
					</div>
					<button
						type="submit"
						className="bots-btn bots-btn--primary"
						disabled={sending || (!draft.trim() && !pending.length)}
						data-terminay-bot-send="true"
					>
						{sending ? 'Posting…' : threadId ? 'Reply' : 'Send'}
					</button>
				</div>
			</form>
		</div>
	);
}
