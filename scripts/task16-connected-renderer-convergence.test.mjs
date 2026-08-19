import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('default project colors derive from stable server and project identity', async () => {
	const [app, collection, model] = await Promise.all([
		read('src/App.tsx'),
		read('src/workspace/useProjectCollection.ts'),
		read('src/workspace/projectTabModel.ts'),
	]);

	assert.match(app, /projectColorScope:\s*currentServerId/);
	assert.match(collection, /createProjectTab\([\s\S]*projectColorScope/);
	assert.match(
		model,
		/getDeterministicProjectTabColor\(`\$\{colorScope\}:\$\{id\}`/,
	);
	assert.doesNotMatch(model, /Math\.random/);
});

test('browser connection profile label reaches the shared renderer context', async () => {
	const web = await read('src/web/main.tsx');
	assert.match(web, /connectionLabel:\s*label/);
	assert.match(web, /label = desktop\.context\.profile\?\.label \?\? 'Local'/);
	assert.match(web, /sessionHost\.hostName\?\.trim\(\) \|\| 'Remote'/);
	assert.doesNotMatch(
		web,
		/connectionLabel:\s*(?:parsed|clientId|completion|token)/,
	);
});
