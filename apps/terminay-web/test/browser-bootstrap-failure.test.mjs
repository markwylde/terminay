import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBrowserBootstrapFailure } from '../dist/index.js';

test('browser bootstrap failures list every missing required capability', () => {
	const failure = describeBrowserBootstrapFailure({
		step: 'bundle-installation',
		error: {
			failures: [
				{
					compatible: false,
					component: 'host-capability',
					code: 'missing-capability',
					capability: 'clipboardWrite',
					required: { minimum: 1, maximum: 1 },
				},
				{
					compatible: false,
					component: 'host-capability',
					code: 'missing-capability',
					capability: 'filePicker',
					required: { minimum: 1, maximum: 1 },
				},
			{
				compatible: false,
				component: 'application-protocol',
				code: 'version-mismatch',
				message: 'protocol revisions differ',
				},
			],
		},
	});

	assert.equal(failure.kind, 'browser-bootstrap-failure');
	assert.equal(failure.step, 'bundle-installation');
	assert.deepEqual(failure.missingRequiredCapabilities, [
		'clipboardWrite',
		'filePicker',
	]);
	assert.match(failure.summary, /requires browser capabilities/u);
	assert.deepEqual(failure.details, [
		'Missing required browser capability: clipboard Write.',
		'Missing required browser capability: file Picker.',
		'The server application protocol is not compatible with this workspace host.',
	]);
});

test('browser bootstrap failures name the failed step without rendering an arbitrary error', () => {
	const failure = describeBrowserBootstrapFailure({
		step: 'session-host',
		error: new Error('credential=do-not-render'),
	});

	assert.equal(failure.stepLabel, 'the secure session host check');
	assert.match(failure.summary, /secure session host check/u);
	assert.deepEqual(failure.details, []);
	assert.doesNotMatch(JSON.stringify(failure), /credential=do-not-render/u);
});
