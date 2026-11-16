// The parts of noVNC's RFB that the bot desktop uses. noVNC ships no types.
declare module '@novnc/novnc' {
	export default class RFB extends EventTarget {
		constructor(
			target: HTMLElement,
			urlOrChannel: string | object,
			options?: Readonly<{ shared?: boolean; credentials?: object }>,
		);
		viewOnly: boolean;
		scaleViewport: boolean;
		resizeSession: boolean;
		clipViewport: boolean;
		focusOnClick: boolean;
		showDotCursor: boolean;
		background: string;
		disconnect(): void;
		focus(): void;
		/** Sends `text` to the server's clipboard (ExtendedClipboard when offered). */
		clipboardPasteFrom(text: string): void;
		/** Presses and releases, or with `down` only presses or releases. */
		sendKey(keysym: number, code: string | null, down?: boolean): void;
		addEventListener(
			type: 'clipboard',
			listener: (event: CustomEvent<{ text: string }>) => void,
		): void;
		addEventListener(type: string, listener: (event: Event) => void): void;
	}
}
