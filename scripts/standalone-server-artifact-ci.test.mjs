import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);

test('CI constructs the isolated standalone server archive twice on each supported native Linux runner', async () => {
	const workflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8');
	const builder = await readFile(resolve(root, 'scripts/build-standalone-server-artifact.mjs'), 'utf8');
	assert.match(workflow, /standalone-server-artifact:/u);
	const artifactJob = workflow.slice(
		workflow.indexOf('  standalone-server-artifact:'),
		workflow.indexOf('\n  smoke:', workflow.indexOf('  standalone-server-artifact:')),
	);
	assert.match(artifactJob, /Prepare versioned checkout[\s\S]*apt-get install --yes --no-install-recommends ca-certificates git/u);
	assert.match(artifactJob, /git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/u);
	assert.ok(
		artifactJob.indexOf('Prepare versioned checkout') < artifactJob.indexOf('Check out code'),
		'the slim release container must install git before actions/checkout so native evidence has repository provenance',
	);
	assert.match(workflow, /target:\s+linux-x64/u);
	assert.match(workflow, /target:\s+linux-arm64/u);
	assert.match(workflow, /build-standalone-server-artifact\.mjs/u);
	assert.match(workflow, /STANDALONE_SERVER_ARCHIVE/u);
	assert.match(workflow, /sha256sum "\$ARCHIVE_ONE"/u);
	assert.match(workflow, /node_modules\/@terminay\/\(server-core\|protocol\)\)\/src/u);
	assert.match(workflow, /terminay-server-\$\{\{ matrix\.target \}\}/u);
	assert.match(workflow, /Probe the extracted archive without build tools/u);
	assert.match(workflow, /apt-get purge --yes build-essential gcc g\+\+ make python3/u);
	assert.match(workflow, /probe-standalone-server-archive\.mjs/u);
	assert.match(workflow, /--target "\$TARGET"[\s\S]*--archive "\$STANDALONE_SERVER_ARCHIVE"/u);
	assert.ok(
		workflow.indexOf('Probe the extracted archive without build tools') < workflow.indexOf('Upload standalone server artifact'),
		'the native archive must be probed before upload',
	);
	assert.match(workflow, /Bind native runner evidence to the probed archive/u);
	assert.match(workflow, /record-native-runner-evidence\.mjs/u);
	assert.match(workflow, /verifyNativeRunnerEvidence/u);
	assert.match(workflow, /expectedCommit:\s+process\.env\.GITHUB_SHA/u);
	assert.match(workflow, /STANDALONE_SERVER_EVIDENCE/u);
	assert.ok(
		workflow.indexOf('Probe the extracted archive without build tools') <
			workflow.indexOf('Bind native runner evidence to the probed archive') &&
			workflow.indexOf('Bind native runner evidence to the probed archive') <
			workflow.indexOf('Upload standalone server artifact'),
		'native identity and archive digest evidence must be recorded only after the probe and uploaded with it',
	);
	assert.match(builder, /stageProductionDependencyClosure/u);
	assert.match(builder, /stageCompiledWorkspacePackage/u);
	assert.doesNotMatch(builder, /await cp\(serverRoot, join\(root, 'server'\)/u);
});
