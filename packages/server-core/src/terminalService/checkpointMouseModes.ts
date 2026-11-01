import type { Terminal } from '@xterm/headless';

/**
 * SerializeAddon 0.15 omits mouse encoding and only writes enabled tracking.
 * Keep this pinned-xterm compatibility access in one place. A checkpoint may
 * replace a display with unrelated modes, so restore explicit defaults too.
 */
export function serializeCheckpointMouseModes(terminal: Terminal): string {
	const mouse = (
		terminal as unknown as {
			_core: {
				mouseStateService: { activeProtocol: string; activeEncoding: string };
			};
		}
	)._core.mouseStateService;
	const protocols: Record<string, number | null> = {
		NONE: null,
		X10: 9,
		VT200: 1000,
		DRAG: 1002,
		ANY: 1003,
	};
	const encodings: Record<string, number | null> = {
		DEFAULT: null,
		SGR: 1006,
		SGR_PIXELS: 1016,
	};
	const protocol = protocols[mouse.activeProtocol];
	const encoding = encodings[mouse.activeEncoding];
	if (protocol === undefined || encoding === undefined) {
		throw new Error('Unsupported xterm checkpoint mouse state');
	}
	return (
		'\x1b[?9;1000;1002;1003;1006;1016l' +
		(protocol === null ? '' : `\x1b[?${protocol}h`) +
		(encoding === null ? '' : `\x1b[?${encoding}h`)
	);
}
