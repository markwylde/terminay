import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertNoClientLanguageWorkers,
	findClientLanguageWorkerChunks,
} from './server-ui-bundle-language-workers.mjs';

const clean = [
	'assets/main-wAbJggzu.js',
	'assets/editor.api2-BmVe3eMZ.js',
	'assets/editor.worker-Ab12Cd34.js',
	'assets/pdf.worker.min-CHFwMXne.mjs',
	'assets/simple-mode-DXiLM1-G.js',
	'assets/main-skjs4veq.css',
	'server.html',
];

test('a bundle with only the base editor worker passes', () => {
	assert.deepEqual(findClientLanguageWorkerChunks(clean), []);
	assert.doesNotThrow(() => assertNoClientLanguageWorkers(clean));
});

test('a bundle carrying a language worker or mode fails and names the file', () => {
	const offending = [
		...clean,
		'assets/ts.worker-DgFMIcEs.js',
		'assets/tsMode-BebajUI9.js',
		'assets/json.worker-CxwlJRnL.js',
		'assets/cssMode-CLYJ8WXJ.js',
		'assets/html.worker-DG8hnSJR.js',
	];
	assert.deepEqual(findClientLanguageWorkerChunks(offending), [
		'assets/cssMode-CLYJ8WXJ.js',
		'assets/html.worker-DG8hnSJR.js',
		'assets/json.worker-CxwlJRnL.js',
		'assets/ts.worker-DgFMIcEs.js',
		'assets/tsMode-BebajUI9.js',
	]);
	assert.throws(
		() => assertNoClientLanguageWorkers(offending),
		/ts\.worker-DgFMIcEs\.js/u,
	);
});
