import {
	createTerminayHostBytePacket,
	parseTerminayHostActionRequest,
	parseTerminayHostBytePacket,
	parseTerminayHostContext,
	type TerminayHostActionRequest,
	type TerminayHostContext,
} from '@terminay/protocol';
import { contextBridge, ipcRenderer } from 'electron';
import type { AppCommand } from '../src/types/terminay';
import type { ServerUiHostBridge } from './serverUiHostContract';

const GET_CONTEXT = 'server-ui-host:get-context';
const REQUEST_ACTION = 'server-ui-host:request-action';
const APP_COMMANDS = new Set<AppCommand>([
	'clear-terminal',
	'close-active',
	'new-project',
	'new-terminal',
	'open-command-bar',
	'open-extensions',
	'open-project-environments',
	'open-recordings',
	'open-settings',
	'open-macros',
	'popout-active',
	'save-active',
	'set-project-root-folder-to-working-directory',
	'split-horizontal',
	'split-vertical',
	'start-dictation',
	'toggle-file-explorer-sidebar',
]);

function isAppCommand(value: unknown): value is AppCommand {
	return typeof value === 'string' && APP_COMMANDS.has(value as AppCommand);
}
let contextPromise: Promise<TerminayHostContext> | undefined;
const context = () =>
	(contextPromise ??= ipcRenderer
		.invoke(GET_CONTEXT)
		.then(parseTerminayHostContext));

const bridge: ServerUiHostBridge = Object.freeze({
	getContext: context,
	requestAction: async (request: TerminayHostActionRequest) => {
		const bound = await context();
		await ipcRenderer.invoke(
			REQUEST_ACTION,
			parseTerminayHostActionRequest(request, bound),
		);
	},
	subscribeAppCommands: (listener) => {
		if (typeof listener !== 'function')
			throw new TypeError('app command listener is invalid');
		const wrapper = (
			_event: Electron.IpcRendererEvent,
			command: unknown,
		) => {
			if (isAppCommand(command)) void Promise.resolve(listener(command));
		};
		ipcRenderer.on('app:command', wrapper);
		return () => ipcRenderer.off('app:command', wrapper);
	},
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayHost', bridge);

let bytePort: MessagePort | undefined;
let resolveBytePort: ((port: MessagePort) => void) | undefined;
const bytePortReady = new Promise<MessagePort>((resolve) => {
	resolveBytePort = resolve;
});
const byteListeners = new Set<(frame: Uint8Array | null) => void>();
ipcRenderer.on('server-ui-host:byte-endpoint', (event) => {
	const port = event.ports[0];
	if (!port || bytePort !== undefined) {
		port?.close();
		return;
	}
	bytePort = port;
	resolveBytePort?.(port);
	resolveBytePort = undefined;
	port.onmessage = (message) =>
		void context().then((bound) => {
			try {
				const packet = parseTerminayHostBytePacket(
					message.data,
					bound.serverId,
				);
				for (const listener of byteListeners) listener(packet.frame);
			} catch {
				for (const listener of byteListeners) listener(null);
			}
		});
	port.onmessageerror = () => {
		for (const listener of byteListeners) listener(null);
	};
	port.start();
});

const bytes = Object.freeze({
	version: 1,
	send: async (frame: Uint8Array) => {
		const bound = await context();
		if (
			!(frame instanceof Uint8Array) ||
			frame.byteLength === 0 ||
			frame.byteLength > 16_777_216
		)
			throw new TypeError('server frame must be bounded bytes');
		const port = bytePort ?? (await bytePortReady);
		port.postMessage(createTerminayHostBytePacket(bound.serverId, frame));
	},
	subscribe: (listener: (frame: Uint8Array | null) => void) => {
		if (typeof listener !== 'function')
			throw new TypeError('byte listener is invalid');
		byteListeners.add(listener);
		return () => byteListeners.delete(listener);
	},
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayBytes', bytes);
