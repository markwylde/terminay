import type { IpcMain } from 'electron';
import type { DictationService, DictationTranscribeRequest } from './service';
import type { DictationMicrophonePermissionStatus } from '../../src/types/terminay';

type RegisterDictationIpcOptions = {
	clearOpenAiKey: () => Promise<boolean> | boolean;
	dictationService: DictationService;
	getMicrophonePermissionStatus: () =>
		| Promise<DictationMicrophonePermissionStatus>
		| DictationMicrophonePermissionStatus;
	getOpenAiKeyStatus: () => Promise<{ configured: boolean }> | { configured: boolean };
	ipcMain: IpcMain;
	requestMicrophonePermission: () =>
		| Promise<DictationMicrophonePermissionStatus>
		| DictationMicrophonePermissionStatus;
	saveOpenAiKey: (apiKey: string) => Promise<{ configured: boolean }> | { configured: boolean };
};

export function registerDictationIpcHandlers({
	clearOpenAiKey,
	dictationService,
	getMicrophonePermissionStatus,
	getOpenAiKeyStatus,
	ipcMain,
	requestMicrophonePermission,
	saveOpenAiKey,
}: RegisterDictationIpcOptions): void {
	ipcMain.handle('dictation:get-openai-key-status', async () => {
		return getOpenAiKeyStatus();
	});

	ipcMain.handle(
		'dictation:save-openai-key',
		async (_event, payload: { apiKey?: unknown }) => {
			if (typeof payload?.apiKey !== 'string') {
				throw new Error('OpenAI API key is required.');
			}

			return saveOpenAiKey(payload.apiKey);
		},
	);

	ipcMain.handle('dictation:clear-openai-key', async () => {
		await clearOpenAiKey();
		return getOpenAiKeyStatus();
	});

	ipcMain.handle('dictation:get-microphone-permission-status', async () => {
		return getMicrophonePermissionStatus();
	});

	ipcMain.handle('dictation:request-microphone-permission', async () => {
		return requestMicrophonePermission();
	});

	ipcMain.handle(
		'dictation:transcribe',
		async (_event, payload: DictationTranscribeRequest) => {
			return dictationService.transcribe(payload);
		},
	);
}
