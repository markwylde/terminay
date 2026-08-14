import type { JsonValue } from '@terminay/protocol';
import {
	DEFAULT_SHELL_PROFILES_SETTINGS,
	shellProfilesSettingsAsJson,
} from '../shellProfiles/normalize.js';
import type { SettingsObject } from './types.js';

/** Defaults owned by Terminay Server. Device/rendering settings are excluded. */
export const DEFAULT_SERVER_SETTINGS: SettingsObject = {
	agentIntegration: { enabled: true },
	aiTabMetadata: {
		title: { provider: 'disabled', claudeCodeModel: '', codexModel: '' },
		note: { provider: 'disabled', claudeCodeModel: '', codexModel: '' },
	},
	activityIndicators: {
		amberDelaySeconds: 0,
		greenDelaySeconds: 1,
		showActiveTabs: false,
		showFinishedTabs: true,
		signalDetection: true,
		progressStaleSeconds: 15,
		tabSwitchSuppressionSeconds: 1,
	},
	autoCloseTerminalOnExitZero: false,
	convertEol: true,
	dictation: {
		enabled: true,
		provider: 'openai',
		model: 'gpt-4o-transcribe',
		language: 'en',
		prompt: '',
		silenceStopSeconds: 5,
		maxDurationSeconds: 60,
	},
	disableStdin: false,
	fileViewer: {
		customFileExtensions: [],
		diffLayout: 'side-by-side',
		folderTaskIgnoredDirectories:
			'.git\n.hg\n.svn\nnode_modules\nbower_components\ndist\nbuild\nout\n.next\n.nuxt\n.cache\ncoverage\ntarget\nvendor\n.venv\nvenv\n__pycache__',
		refreshIntervalSeconds: 5,
	},
	gitPushAgent: {
		provider: 'disabled',
		claudeCodeModel: '',
		codexModel: '',
		prompt: '',
	},
	ignoreBracketedPasteMode: false,
	macros: {
		maxSteps: 256,
		maxFields: 64,
		maxOutputBytes: 131072,
		maxDelayMs: 300000,
		maxConcurrentRuns: 4,
		disconnectPolicy: 'cancel',
	},
	remoteAccess: {
		bindAddress: '0.0.0.0',
		origin: 'https://localhost:9443',
		pairingMode: 'lan',
		pinFailureLimit: 3,
		reconnectGrantLifetime: '24h',
		tlsCertPath: '',
		tlsKeyPath: '',
		webRtcHostedDomain: 'terminay.com',
		webRtcIceServers: 'stun:stun.l.google.com:19302',
	},
	recording: {
		captureInput: false,
		directory: '~/Documents/TerminaySessions',
		openTimelineAfterSaving: false,
		recordNewTerminals: false,
		sensitiveInputPolicy: 'drop',
	},
	rightClickSelectsWord: false,
	scrollback: 5000,
	scrollOnEraseInDisplay: false,
	scrollOnUserInput: true,
	scrollSensitivity: 1,
	smoothScrollDuration: 0,
	shell: { program: '', startupMode: 'auto', extraArgs: '' },
	shellProfiles: shellProfilesSettingsAsJson(DEFAULT_SHELL_PROFILES_SETTINGS),
	tabStopWidth: 8,
	terminayMcp: { enabled: true },
	wordSeparator: ' ()[]{}\',"`',
};

export const defaultServerSettings = DEFAULT_SERVER_SETTINGS;

export function cloneDefaultServerSettings(): SettingsObject {
	return structuredClone(DEFAULT_SERVER_SETTINGS) as SettingsObject;
}

export function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value === 'object')
		return Object.values(value as Record<string, unknown>).every(isJsonValue);
	return false;
}
