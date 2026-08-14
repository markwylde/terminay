import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Desktop presents canonical auxiliary routes through verified native windows', async () => {
	const [main, workspace] = await Promise.all([
		read('electron/main.ts'),
		read('src/web/ConnectedWebRendererWorkspace.tsx'),
	]);
	for (const route of [
		'settings',
		'macros',
		'recordings',
		'project-environments',
	]) {
		assert.match(workspace, new RegExp(`['"]${route}['"]`));
	}
	assert.match(main, /const AUXILIARY_TITLES/u);
	assert.match(workspace, /disposition:\s*'native-window'/u);
	assert.match(workspace, /window\.terminayHost\.requestAction/u);
	assert.match(main, /presentCanonicalAuxiliaryRoute/u);
	assert.match(main, /auxiliaryWindowsByPresentation/u);
	assert.match(main, /prepareCanonicalHttpRemoteLaunch/u);
	assert.match(main, /createDesktopReconnectTransport/u);
	assert.match(main, /serverUiPreload\.cjs/u);
	assert.doesNotMatch(
		main,
		/Route presentation is unavailable during Desktop bootstrap/u,
	);
});

test('canonical launch failures retain a bounded retry surface', async () => {
	const [main, diagnostics, recovery] = await Promise.all([
		read('electron/main.ts'),
		read('electron/diagnostics/core.ts'),
		read('electron/canonicalLaunchRecovery.ts'),
	]);
	assert.match(recovery, /Terminay could not open this workspace/u);
	assert.match(main, /showCanonicalLaunchRecovery/u);
	assert.match(main, /canonical-launch-recovery/u);
	assert.match(main, /launchWithRecovery/u);
	assert.match(recovery, /slice\(0, 320\)/u);
	assert.match(diagnostics, /renderer\.bootstrap\.failed/u);
	assert.doesNotMatch(
		main,
		/embedded server UI verification failed[\s\S]{0,300}window\.close/u,
	);
});
