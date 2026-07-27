import { contextBridge, ipcRenderer } from 'electron';
import type {
	ServerUiHostAction,
	ServerUiHostBridge,
	ServerUiHostContext,
} from './serverUiHostContract';

const SERVER_UI_GET_CONTEXT_CHANNEL = 'server-ui-host:get-context';
const SERVER_UI_REQUEST_ACTION_CHANNEL = 'server-ui-host:request-action';

function normalizeAction(value: ServerUiHostAction): ServerUiHostAction {
	if (!value || typeof value !== 'object') {
		throw new Error('A host action is required.');
	}

	const keys = Object.keys(value).sort();
	if (
		(value.type === 'close-window' || value.type === 'manage-connections') &&
		keys.length === 1 &&
		keys[0] === 'type'
	) {
		return Object.freeze({ type: value.type });
	}

	if (
		value.type === 'open-connection' &&
		keys.length === 2 &&
		keys[0] === 'profileId' &&
		keys[1] === 'type' &&
		typeof value.profileId === 'string' &&
		/^[a-zA-Z0-9_-]{1,128}$/.test(value.profileId)
	) {
		return Object.freeze({
			profileId: value.profileId,
			type: value.type,
		});
	}

	throw new Error('That host action is not allowed.');
}

const bridge: Readonly<ServerUiHostBridge> = Object.freeze({
	getContext: async () => {
		const context = (await ipcRenderer.invoke(
			SERVER_UI_GET_CONTEXT_CHANNEL,
		)) as ServerUiHostContext;
		return Object.freeze({
			hostKind: context.hostKind,
			profile: Object.freeze({
				id: context.profile.id,
				label: context.profile.label,
			}),
		});
	},
	requestAction: async (action) => {
		await ipcRenderer.invoke(
			SERVER_UI_REQUEST_ACTION_CHANNEL,
			normalizeAction(action),
		);
	},
});

const electronProcess = process as NodeJS.Process & { isMainFrame?: boolean };
if (electronProcess.isMainFrame !== false) {
	contextBridge.exposeInMainWorld('terminayHost', bridge);
}
