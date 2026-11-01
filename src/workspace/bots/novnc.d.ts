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
	}
}
