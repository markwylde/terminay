import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHostCapabilityProvider } from '../packages/client-core/dist/index.js';
import { createResponsiveWorkspaceShellModel } from '../packages/responsive-ui/dist/index.js';

const [app, webMount, sharedMount] = await Promise.all([
	readFile('src/App.tsx', 'utf8'),
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
]);

test('responsive server workspace renders Git from the connected server client', () => {
	assert.match(app, /<WorktreesPanel/u);
	assert.match(app, /terminalClientContext\?\.gitClient/u);
	assert.match(webMount, /<ConnectedRendererWorkspace/u);
	assert.match(sharedMount, /<App/u);
});

test('Agents are a server-driven workspace region in wide and narrow modes', () => {
	assert.match(app, /<AgentsSidebar/u);
	assert.match(app, /terminalClientContext\?\.agentStatusClient/u);
	for (const viewportWidth of [1280, 390]) {
		const capabilities = createHostCapabilityProvider();
		const shell = createResponsiveWorkspaceShellModel(
			{
				connection: {},
				host: { capabilities },
			},
			{
				connectionProfiles: { snapshot: () => ({ profiles: [] }) },
				navigation: { route: 'workspace' },
				viewportWidth,
			},
		);
		assert.ok(shell.routeComponent.component.regions.includes('agents'));
		assert.equal(shell.layout, viewportWidth > 1000 ? 'wide' : 'narrow');
	}
});
