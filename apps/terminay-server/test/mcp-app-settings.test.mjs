import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	createInitialWorkspace,
	createSettingsOperationRegistry,
	createShellProfileOperationRegistry,
	DEFAULT_MCP_PERMISSIONS,
	isMcpReachableSettingPath,
	MCP_REACHABLE_SETTING_PATHS,
	McpApprovalService,
	mcpPrincipalCommandRequest,
	mcpPrincipalQueryRequest,
	OrderedEventJournal,
	SETTING_AUTHORITY,
	ServerSettingsRepository,
	ShellProfileCatalogueService,
	ShellProfileDiscoveryService,
	WorkspaceStore,
} from '@terminay/server-core';
import {
	createMcpPermissionGate,
	createSettingsControlAdapter,
	createTerminalControlAdapter,
	describeSettingsUpdate,
	planSettingsUpdate,
	ProjectHandleCodec,
	settingsState,
} from '../dist/index.js';

/**
 * The settings and shell profile tools (ADR-0072): an allow-list of server
 * settings, applied whole or not at all through the Settings normalisation,
 * and shell profiles managed through the profile editor's own operations.
 */

const KEY = new Uint8Array(32).fill(5);
const SECRET = 'do-not-leak-this-secret';

function context(overrides = {}) {
	return {
		terminalSessionId: 'home-terminal',
		projectId: AUTOMATION_SPACE_PROJECT_ID,
		reach: 'workspace',
		scope: 'write',
		connectionId: 'local',
		requestId: 'r',
		signal: new AbortController().signal,
		...overrides,
	};
}
const projectTerminal = () =>
	context({ terminalSessionId: 'caller', projectId: 'project-a', reach: undefined });

async function fixture({ references = () => [] } = {}) {
	// A stored file carrying a secret reference, as one from the vault does.
	let persisted = {
		schemaVersion: 2,
		revision: 3,
		settings: {},
		secretReferences: {
			'dictation.apiKey': { configured: true, label: SECRET },
		},
	};
	const settings = new ServerSettingsRepository({
		load: async () => structuredClone(persisted),
		commit: async (state) => {
			persisted = structuredClone(state);
		},
		backup: async () => undefined,
	});
	await settings.load();
	const journal = new OrderedEventJournal();
	const settingsRegistry = createSettingsOperationRegistry(settings, journal);
	const discovery = new ShellProfileDiscoveryService({
		platform: 'darwin',
		accountShell: '/bin/zsh',
		environmentShell: '/bin/bash',
		probeExecutable: async (candidate) =>
			['/bin/zsh', '/bin/bash'].includes(candidate) ? candidate : null,
		readEtcShells: async () => '/bin/zsh\n/bin/bash\n',
	});
	const profiles = new ShellProfileCatalogueService({
		settings,
		discovery,
		projectReferences: (profileId) => references(profileId),
	});
	const profileRegistry = createShellProfileOperationRegistry(profiles);
	const registryFor = (operation) =>
		operation.startsWith('settings.')
			? settingsRegistry.operations
			: profileRegistry.operations;
	const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
	const principals = [];
	const adapter = createSettingsControlAdapter({
		query: async (operation, payload, signal) => {
			const request = mcpPrincipalQueryRequest(operation, payload, signal);
			principals.push(request.context.clientId);
			return registryFor(operation).queries[operation](request);
		},
		command: async (operation, payload, signal, expectedRevision) => {
			const request = mcpPrincipalCommandRequest(
				operation,
				payload,
				signal,
				expectedRevision,
			);
			principals.push(request.context.clientId);
			const outcome = await registryFor(operation).commands[operation](request);
			return outcome?.result ?? outcome;
		},
		state: () => workspace.state,
		projectHandles: new ProjectHandleCodec('server-a', KEY),
	});
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		settings: adapter,
	});
	const call = (op, params = {}, caller = context()) =>
		dispatch({ id: op, version: 1, op, params }, caller);
	return { settings, journal, adapter, call, principals, profiles };
}

test('the reachable settings are exactly the allow-list, and none of the excluded ones', () => {
	assert.deepEqual(
		[...MCP_REACHABLE_SETTING_PATHS],
		[
			'agentIntegration',
			'aiTabMetadata',
			'activityIndicators',
			'autoCloseTerminalOnExitZero',
			'convertEol',
			'dictation',
			'disableStdin',
			'fileViewer',
			'gitPushAgent',
			'ignoreBracketedPasteMode',
			'keepTerminalsAfterQuit',
			'macros',
			'moveTerminalsIntoNewWorktreeFolders',
			'pixel',
			'programSetTabTitles',
			'rightClickSelectsWord',
			'scrollback',
			'scrollOnEraseInDisplay',
			'scrollOnUserInput',
			'scrollSensitivity',
			'smoothScrollDuration',
			'tabStopWidth',
			'wordSeparator',
		],
	);
	for (const key of MCP_REACHABLE_SETTING_PATHS)
		assert.equal(SETTING_AUTHORITY[key], 'server', key);
	for (const key of [
		'terminayMcp',
		'remoteAccess',
		'recording',
		'shell',
		'shellProfiles',
		'theme',
		'fontSize',
		'keyboardShortcuts',
	]) {
		assert.equal(MCP_REACHABLE_SETTING_PATHS.includes(key), false, key);
		assert.equal(isMcpReachableSettingPath(key), false, key);
	}
	for (const path of [
		'terminayMcp.permissions.automationsManage',
		'terminayMcp.enabled',
		'dictation.microphoneDeviceId',
		'dictation.apiKey',
		'aiTabMetadata.title.secretToken',
	])
		assert.equal(isMcpReachableSettingPath(path), false, path);
	assert.equal(isMcpReachableSettingPath('activityIndicators.greenDelaySeconds'), true);
});

test('a setting added to SETTING_AUTHORITY later is unreachable until the allow-list names it', () => {
	SETTING_AUTHORITY.futureIntegration = 'server';
	try {
		assert.equal(SETTING_AUTHORITY.futureIntegration, 'server');
		assert.equal(isMcpReachableSettingPath('futureIntegration'), false);
		assert.equal(isMcpReachableSettingPath('futureIntegration.apiHost'), false);
		assert.equal(MCP_REACHABLE_SETTING_PATHS.includes('futureIntegration'), false);
	} finally {
		delete SETTING_AUTHORITY.futureIntegration;
	}
});

test('get_settings returns the reachable settings and never a credential or secret reference', async () => {
	const f = await fixture();
	const result = await f.call('get_settings');
	assert.equal(result.settings.scrollback, 5000);
	assert.equal(result.settings.activityIndicators.greenDelaySeconds, 1);
	for (const key of ['terminayMcp', 'remoteAccess', 'recording', 'shell', 'shellProfiles'])
		assert.equal(key in result.settings, false, key);
	const text = JSON.stringify(result);
	assert.equal(text.includes(SECRET), false);
	assert.equal(text.includes('secretReferences'), false);
	assert.equal(text.includes('apiKey'), false);
	assert.ok(f.principals.every((principal) => principal === 'system:mcp'));
});

test('update_settings changes scrollback through settings.update, as the MCP principal', async () => {
	const f = await fixture();
	const before = f.journal.replay().events.length;
	const result = await f.call('update_settings', { settings: { scrollback: 10000 } });
	assert.deepEqual(result.updated, ['scrollback']);
	assert.equal(result.settings.scrollback, 10000);
	assert.equal(f.settings.settings.scrollback, 10000);
	// Every client learns of it as of a change made in Settings.
	const events = f.journal.replay().events.slice(before);
	assert.deepEqual(
		events.map((event) => event.event),
		['settings.changed'],
	);
	const nested = await f.call('update_settings', {
		settings: { 'activityIndicators.greenDelaySeconds': 3 },
	});
	assert.equal(nested.settings['activityIndicators.greenDelaySeconds'], 3);
	assert.equal(f.settings.settings.activityIndicators.amberDelaySeconds, 0);
	assert.ok(f.principals.every((principal) => principal === 'system:mcp'));
});

test('update_settings refuses the MCP policy and the Enable switch, naming them', async () => {
	const f = await fixture();
	for (const path of [
		'terminayMcp.permissions.automationsManage',
		'terminayMcp.enabled',
		'terminayMcp',
	]) {
		const outcome = await f.call('update_settings', {
			settings: { [path]: path === 'terminayMcp' ? {} : 'allow' },
		});
		assert.equal(outcome.ok, false, path);
		assert.equal(outcome.error.code, 'bad_request', path);
		assert.match(outcome.error.message, new RegExp(path.replaceAll('.', '\\.')));
	}
	assert.equal(f.settings.settings.terminayMcp.permissions.automationsManage, 'ask');
	assert.equal(f.settings.settings.terminayMcp.enabled, true);
	assert.equal(f.settings.revision, 3);
});

test('a batch with one bad setting is refused whole, naming it, and scrollback is unchanged', async () => {
	const f = await fixture();
	const outcome = await f.call('update_settings', {
		settings: { scrollback: 20000, 'remoteAccess.exposeOnStartup': true },
	});
	assert.equal(outcome.error.code, 'bad_request');
	assert.match(outcome.error.message, /remoteAccess\.exposeOnStartup/);
	assert.equal(f.settings.settings.scrollback, 5000);
	assert.equal(f.settings.settings.remoteAccess.exposeOnStartup, false);
	// An unknown setting and an invalid value are refused the same way.
	for (const [settings, named] of [
		[{ scrollback: 20000, scrollbak: 1 }, /scrollbak is not a setting/],
		[{ scrollback: 'lots' }, /scrollback cannot be set/],
		[{ scrollback: 5_000_000 }, /scrollback cannot be set/],
		[{ 'recording.recordNewTerminals': true }, /recording\.recordNewTerminals/],
		[{ 'shellProfiles.defaultProfileId': 'x' }, /shellProfiles\.defaultProfileId/],
	]) {
		const refused = await f.call('update_settings', { settings });
		assert.equal(refused.error.code, 'bad_request', JSON.stringify(settings));
		assert.match(refused.error.message, named);
	}
	assert.equal(f.settings.settings.scrollback, 5000);
	assert.equal(f.settings.revision, 3);
});

test('settings tools need workspace reach', async () => {
	const f = await fixture();
	for (const op of ['get_settings', 'update_settings'])
		assert.equal(
			(await f.call(op, { settings: { scrollback: 1 } }, projectTerminal())).error
				.code,
			'out_of_scope',
			op,
		);
	assert.equal(f.settings.settings.scrollback, 5000);
});

test("update_settings' approval shows each setting's current and requested value", async () => {
	const f = await fixture();
	const approvals = new McpApprovalService({
		policies: { ...DEFAULT_MCP_PERMISSIONS },
	});
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		settings: f.adapter,
		permissions: createMcpPermissionGate({
			approvals,
			describe: async ({ params }) => ({
				agent: 'Pixel',
				terminalTitle: 'Pixel',
				...describeSettingsUpdate(
					planSettingsUpdate(params.settings, settingsState(await f.settings.load())),
				),
			}),
		}),
	});
	const pending = dispatch(
		{
			id: 'u',
			version: 1,
			op: 'update_settings',
			params: {
				settings: { scrollback: 10000, 'activityIndicators.showActiveTabs': true },
			},
		},
		context(),
	);
	await new Promise((resolve) => setImmediate(resolve));
	const [approval] = approvals.list();
	assert.equal(approval.group, 'settingsChange');
	assert.equal(approval.summary, 'change 2 settings');
	assert.deepEqual(
		approval.details.map((detail) => [detail.label, detail.value]),
		[
			['scrollback', '5000 → 10000'],
			['activityIndicators.showActiveTabs', 'false → true'],
		],
	);
	// Nothing changes until a user allows it.
	assert.equal(f.settings.settings.scrollback, 5000);
	approvals.decide(approval.id, 'once');
	await pending;
	assert.equal(f.settings.settings.scrollback, 10000);
	// A request naming an excluded setting is refused before anyone is asked.
	assert.throws(
		() =>
			planSettingsUpdate(
				{ 'terminayMcp.enabled': false },
				settingsState({ revision: 1, settings: f.settings.settings }),
			),
		/terminayMcp\.enabled/,
	);
});

test('save_shell_profile adds a profile as the Settings > Shell editor does', async () => {
	const f = await fixture();
	const saved = await f.call('save_shell_profile', {
		profile: {
			name: 'Login zsh',
			target: { kind: 'executable', executable: '/bin/zsh' },
			args: ['-l'],
			environment: { RELEASE_MARKER: SECRET, REMOVE_ME: null },
		},
	});
	assert.equal(saved.created, true, JSON.stringify(saved));
	assert.match(saved.profile, /^profile:/);
	const listed = await f.call('list_shell_profiles', {}, projectTerminal());
	const entry = listed.profiles.find((profile) => profile.id === saved.profile);
	assert.equal(entry.name, 'Login zsh');
	assert.equal(entry.kind, 'custom');
	assert.equal(entry.available, true);
	assert.equal(entry.argument_count, 1);
	assert.equal(entry.environment_variable_count, 2);
	// Environment values are redacted, as every catalogue response redacts them.
	const text = JSON.stringify(listed);
	assert.equal(text.includes(SECRET), false);
	assert.equal(text.includes('RELEASE_MARKER'), false);
	assert.equal(listed.default_profile, 'system');
	// A change keeps the arguments and environment the agent never saw.
	await f.call('save_shell_profile', {
		profile: { id: saved.profile, name: 'Login zsh 2' },
	});
	const detail = await f.profiles.detail(saved.profile);
	assert.equal(detail.name, 'Login zsh 2');
	assert.deepEqual(detail.args, ['-l']);
	assert.equal(detail.environment.RELEASE_MARKER, SECRET);
	// A profile never carries a secret: a secret-like variable is refused.
	const secretLike = await f.call('save_shell_profile', {
		profile: { id: saved.profile, environment: { API_TOKEN: 'x' } },
	});
	assert.equal(secretLike.error.code, 'bad_request');
	assert.equal((await f.profiles.detail(saved.profile)).environment.API_TOKEN, undefined);
	// The default and the order go through the editor's operations too.
	assert.deepEqual(
		await f.call('set_default_shell_profile', { profile_id: saved.profile }),
		{ default_profile: saved.profile },
	);
	assert.equal(
		(await f.call('list_shell_profiles')).default_profile,
		saved.profile,
	);
});

test('save_shell_profile refuses a profile outside the bounds and saves nothing', async () => {
	const f = await fixture();
	const before = f.settings.revision;
	const outcome = await f.call('save_shell_profile', {
		profile: {
			name: 'Too many',
			target: { kind: 'executable', executable: '/bin/zsh' },
			args: Array.from({ length: 65 }, (_, index) => `-${index}`),
		},
	});
	assert.equal(outcome.ok, false);
	assert.equal(outcome.error.code, 'bad_request');
	assert.equal(f.settings.revision, before);
	assert.deepEqual(
		(await f.call('list_shell_profiles')).profiles.filter(
			(profile) => profile.kind === 'custom',
		),
		[],
	);
});

test('delete_shell_profile refuses a profile a project uses, and deletes one nothing uses', async () => {
	let referenced = new Set();
	const f = await fixture({
		references: (profileId) => (referenced.has(profileId) ? ['project-a'] : []),
	});
	const saved = await f.call('save_shell_profile', {
		profile: { name: 'Bash', target: { kind: 'executable', executable: '/bin/bash' } },
	});
	referenced = new Set([saved.profile]);
	const refused = await f.call('delete_shell_profile', { profile_id: saved.profile });
	assert.equal(refused.error.code, 'conflict');
	assert.equal(refused.error.message.includes('project-a'), false);
	assert.ok(await f.profiles.detail(saved.profile));
	referenced = new Set();
	assert.deepEqual(
		await f.call('delete_shell_profile', { profile_id: saved.profile }),
		{ profile: saved.profile, deleted: true },
	);
	const unknown = await f.call('delete_shell_profile', { profile_id: saved.profile });
	assert.equal(unknown.error.code, 'not_found');
});

test('only list_shell_profiles is open to project reach', async () => {
	const f = await fixture();
	for (const [op, params] of [
		['save_shell_profile', { profile: { name: 'x', target: { kind: 'system' } } }],
		['delete_shell_profile', { profile_id: 'x' }],
		['reorder_shell_profiles', { profile_ids: [] }],
		['set_default_shell_profile', { profile_id: 'system' }],
	])
		assert.equal(
			(await f.call(op, params, projectTerminal())).error.code,
			'out_of_scope',
			op,
		);
	assert.ok(Array.isArray((await f.call('list_shell_profiles', {}, projectTerminal())).profiles));
});
