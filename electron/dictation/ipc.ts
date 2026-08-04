import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { DictationService, DictationTranscribeRequest } from './service';
import type { DictationMicrophonePermissionStatus } from '../../src/types/terminay';

type RegisterDictationIpcOptions = {
	assertTrustedSender: (event: IpcMainInvokeEvent) => void;
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
	assertTrustedSender,
	clearOpenAiKey,
	dictationService,
	getMicrophonePermissionStatus,
	getOpenAiKeyStatus,
	ipcMain,
	requestMicrophonePermission,
	saveOpenAiKey,
}: RegisterDictationIpcOptions): void {
	ipcMain.handle('dictation:get-openai-key-status', async (event) => {
		assertTrustedSender(event);
		return getOpenAiKeyStatus();
	});

	ipcMain.handle(
		'dictation:save-openai-key',
		async (event, payload: { apiKey?: unknown }) => {
			assertTrustedSender(event);
			if (typeof payload?.apiKey !== 'string') {
				throw new Error('OpenAI API key is required.');
			}

			return saveOpenAiKey(payload.apiKey);
		},
	);

	ipcMain.handle('dictation:clear-openai-key', async (event) => {
		assertTrustedSender(event);
		await clearOpenAiKey();
		return getOpenAiKeyStatus();
	});

	ipcMain.handle('dictation:get-microphone-permission-status', async (event) => {
		assertTrustedSender(event);
		return getMicrophonePermissionStatus();
	});

	ipcMain.handle('dictation:request-microphone-permission', async (event) => {
		assertTrustedSender(event);
		return requestMicrophonePermission();
	});

	ipcMain.handle(
		'dictation:transcribe',
		async (event, payload: DictationTranscribeRequest) => {
			assertTrustedSender(event);
			return dictationService.transcribe(payload);
		},
	);
}
