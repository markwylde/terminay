/**
 * Clipboard paste is UI behaviour, not terminal transport authority. Keep its
 * failure handling separate so a denied or malformed clipboard read never
 * leaves a server-backed terminal input queue in an indeterminate state.
 */

export const CLIPBOARD_IMAGE_MIME_TYPES = Object.freeze([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/webp',
	'image/gif',
] as const);

export type ClipboardImageMimeType =
	(typeof CLIPBOARD_IMAGE_MIME_TYPES)[number];

export type TerminalClipboardContents =
	| Readonly<{ kind: 'text'; text: string }>
	| Readonly<{
			kind: 'image';
			bytes: Uint8Array<ArrayBuffer>;
			mimeType: ClipboardImageMimeType;
	  }>
	| Readonly<{ kind: 'empty' }>;

export function shouldHandleTerminalPasteShortcut(
	event: Pick<
		KeyboardEvent,
		'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
	>,
	isMac: boolean,
	canUseDesktopClipboard: boolean,
): boolean {
	const key = event.key.toLowerCase();
	if (key !== 'v' || event.altKey) return false;

	// Desktop handles Cmd+V itself so an image-only system clipboard item can be
	// materialized by Electron and inserted as a shell-safe temporary file path.
	if (isMac && event.metaKey && !event.ctrlKey && !event.shiftKey)
		return canUseDesktopClipboard;

	return (
		(event.ctrlKey && event.shiftKey && !event.metaKey) ||
		(!isMac && event.metaKey && !event.ctrlKey && !event.shiftKey)
	);
}

/**
 * WebKit reads the clipboard only for a live user activation, and rejects with
 * NotAllowedError before it ever offers its own paste confirmation otherwise.
 *
 * Which event carries that activation is not symmetric. HTML defines an
 * activation triggering input event as keydown, mousedown, pointerdown *only*
 * when its pointerType is "mouse", pointerup only when its pointerType is not
 * "mouse", and touchend. A finger tap therefore grants nothing on pointerdown
 * and everything on pointerup, so a touch clipboard read belongs in pointerup.
 * That also survives the preventDefault an accessory key needs on its
 * pointerdown to stop the tap blurring the terminal and dismissing the
 * keyboard, which a plain click handler does not reliably do.
 *
 * Latch briefly so the click closing the same tap does not paste a second time.
 * A button activated without a pointer at all — a keyboard, an assistive
 * device — still sees its click and pastes once.
 */
export function createTerminalPasteActivation(
	paste: () => void,
	now: () => number = () => Date.now(),
): Readonly<{ onPointerUp: () => void; onClick: () => void }> {
	let pastedByPointerAt: number | undefined;
	return Object.freeze({
		onPointerUp: () => {
			pastedByPointerAt = now();
			paste();
		},
		onClick: () => {
			// A tap that never completes leaves the latch set. Expire it so a later
			// activation is never swallowed by a click that already went away.
			if (
				pastedByPointerAt !== undefined &&
				now() - pastedByPointerAt < TERMINAL_PASTE_ACTIVATION_LATCH_MS
			) {
				pastedByPointerAt = undefined;
				return;
			}
			pastedByPointerAt = undefined;
			paste();
		},
	});
}

export const TERMINAL_PASTE_ACTIVATION_LATCH_MS = 1_000;

/**
 * A browser refuses a clipboard read by rejecting, and the reason it gives is
 * the only thing that distinguishes a denied permission from a missing user
 * gesture. Keep the name, because `NotAllowedError` is the part that identifies
 * the refusal, and keep it short enough for one terminal line.
 */
export function describeClipboardFailure(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.replaceAll(/\s+/gu, ' ').trim();
		if (message.length === 0) return error.name;
		const described =
			error.name.length > 0 && !message.startsWith(error.name)
				? `${error.name}: ${message}`
				: message;
		return described.length > 160 ? `${described.slice(0, 159)}…` : described;
	}
	return 'the clipboard could not be read';
}

export function isClipboardImageMimeType(
	value: string,
): value is ClipboardImageMimeType {
	return (CLIPBOARD_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function preferTerminalClipboardContents(
	text: string | undefined,
	image:
		| Readonly<{
				bytes: Uint8Array<ArrayBuffer>;
				mimeType: ClipboardImageMimeType;
		  }>
		| undefined,
): TerminalClipboardContents {
	if (typeof text === 'string' && text.length > 0)
		return { kind: 'text', text };
	if (image !== undefined) return { kind: 'image', ...image };
	return { kind: 'empty' };
}

export async function readBrowserTerminalClipboard(
	clipboard: Pick<Clipboard, 'read' | 'readText'> | undefined,
): Promise<TerminalClipboardContents> {
	if (clipboard === undefined) return { kind: 'empty' };
	// Reading every clipboard flavour is what makes an image paste possible, but
	// it is also the narrower browser capability. A host that only exposes the
	// text route must still paste text rather than fail the whole interaction.
	if (typeof clipboard.read !== 'function') {
		if (typeof clipboard.readText !== 'function') return { kind: 'empty' };
		return preferTerminalClipboardContents(
			await clipboard.readText(),
			undefined,
		);
	}
	const items = await clipboard.read();
	let text: string | undefined;
	let image:
		| { bytes: Uint8Array<ArrayBuffer>; mimeType: ClipboardImageMimeType }
		| undefined;
	for (const item of items) {
		for (const type of item.types) {
			if (type === 'text/plain' && text === undefined) {
				const blob = await item.getType(type);
				const value = await blob.text();
				if (value.length > 0) text = value;
				continue;
			}
			if (isClipboardImageMimeType(type) && image === undefined) {
				const blob = await item.getType(type);
				const buffer = await blob.arrayBuffer();
				image = { bytes: new Uint8Array(buffer), mimeType: type };
			}
		}
	}
	return preferTerminalClipboardContents(text, image);
}

export async function readPasteEventClipboard(
	event: Pick<ClipboardEvent, 'clipboardData'>,
): Promise<TerminalClipboardContents> {
	const data = event.clipboardData;
	if (data === null) return { kind: 'empty' };
	const text = data.getData('text/plain');
	const image = await imageFromPasteData(data);
	return preferTerminalClipboardContents(text, image);
}

export function shouldClaimBrowserImagePaste(
	event: Pick<ClipboardEvent, 'clipboardData'>,
	canUseDesktopClipboard: boolean,
): boolean {
	if (canUseDesktopClipboard) return false;
	const data = event.clipboardData;
	if (data === null) return false;
	if (data.getData('text/plain').length > 0) return false;
	return pasteDataHasImage(data);
}

export async function pasteTerminalClipboard(
	readClipboardText: () => Promise<unknown> | unknown,
	options: {
		readonly announceInput: () => void;
		readonly paste: (text: string) => void;
		readonly focus: () => void;
	},
): Promise<boolean> {
	try {
		const pasted = await readClipboardText();
		if (typeof pasted !== 'string' || pasted.length === 0) {
			return false;
		}

		options.announceInput();
		options.paste(pasted);
		return true;
	} catch {
		// Reading the system clipboard is recoverable. Refocus the xterm surface
		// and leave transport delivery entirely to xterm's ordinary onData path.
		options.focus();
		return false;
	}
}

export async function pasteOrMaterializeTerminalClipboard(
	readClipboard: () =>
		| Promise<TerminalClipboardContents>
		| TerminalClipboardContents,
	options: {
		readonly announceInput: () => void;
		readonly paste: (text: string) => void;
		readonly focus: () => void;
		readonly materializeImage?: (
			image: Extract<TerminalClipboardContents, { kind: 'image' }>,
		) => Promise<string>;
		readonly onImageUploadFailed?: (error: unknown) => void;
		/** A refused or unreadable clipboard is the one failure the user cannot
		 * see for themselves: nothing reaches the terminal and nothing is drawn.
		 * Report it rather than leaving a denied paste indistinguishable from an
		 * empty one. */
		readonly onClipboardReadFailed?: (error: unknown) => void;
		readonly escapePath: (path: string) => string;
	},
): Promise<boolean> {
	try {
		const contents = await readClipboard();
		if (contents.kind === 'text') {
			options.announceInput();
			options.paste(contents.text);
			return true;
		}
		if (contents.kind !== 'image' || options.materializeImage === undefined) {
			if (contents.kind === 'empty') options.focus();
			return false;
		}
		try {
			const path = await options.materializeImage(contents);
			if (path.length === 0) {
				options.focus();
				return false;
			}
			options.announceInput();
			options.paste(options.escapePath(path));
			return true;
		} catch (error) {
			options.onImageUploadFailed?.(error);
			options.focus();
			return false;
		}
	} catch (error) {
		options.onClipboardReadFailed?.(error);
		options.focus();
		return false;
	}
}

function pasteDataHasImage(data: DataTransfer): boolean {
	if (
		Array.from(data.files).some((file) => isClipboardImageMimeType(file.type))
	)
		return true;
	return Array.from(data.items).some(
		(item) => item.kind === 'file' && isClipboardImageMimeType(item.type),
	);
}

async function imageFromPasteData(
	data: DataTransfer,
): Promise<
	| { bytes: Uint8Array<ArrayBuffer>; mimeType: ClipboardImageMimeType }
	| undefined
> {
	for (const file of Array.from(data.files)) {
		const image = await imageFromFile(file);
		if (image !== undefined) return image;
	}
	for (const item of Array.from(data.items)) {
		if (item.kind !== 'file') continue;
		const file = item.getAsFile();
		if (file === null) continue;
		const image = await imageFromFile(file);
		if (image !== undefined) return image;
	}
	return undefined;
}

async function imageFromFile(
	file: File,
): Promise<
	| { bytes: Uint8Array<ArrayBuffer>; mimeType: ClipboardImageMimeType }
	| undefined
> {
	if (!isClipboardImageMimeType(file.type)) return undefined;
	const bytes = new Uint8Array(await file.arrayBuffer());
	return { bytes, mimeType: file.type };
}
