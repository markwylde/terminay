import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const codeHighlight = await read('src/components/file-viewer/codeHighlight.tsx');
const runtime = await read('src/components/file-viewer/monacoRuntime.ts');
const setup = await read('src/components/file-viewer/monacoSetup.ts');
const textViewer = await read('src/components/file-viewer/modes/TextViewer.tsx');
const macros = await read('src/components/MacrosWindow.tsx');

/** Every language id `languageFromFilePath` can return. */
function emittedLanguageIds() {
	const body = codeHighlight.slice(codeHighlight.indexOf('export function languageFromFilePath'));
	const end = body.indexOf('\n}\n');
	return [...body.slice(0, end).matchAll(/return '([a-z]+)'/gu)].map((match) => match[1]);
}

/** Ids whose tokenizer is a Monaco basic-languages contribution in the runtime module. */
function importedTokenizers() {
	return new Set(
		[...runtime.matchAll(/basic-languages\/([a-z]+)\/\1\.contribution\.js/gu)].map(
			(match) => match[1],
		),
	);
}

/** Ids registered with a Monarch grammar in the setup module. */
function registeredGrammars() {
	return new Set(
		[...setup.matchAll(/setMonarchTokensProvider\('([a-z]+)'/gu)].map((match) => match[1]),
	);
}

const REACT_IDS = { typescriptreact: 'typescript', javascriptreact: 'javascript' };

test('every file-viewer language id has a tokenizer and no language service', () => {
	const tokenizers = importedTokenizers();
	const grammars = registeredGrammars();
	for (const id of emittedLanguageIds()) {
		const monacoId = REACT_IDS[id] ?? id;
		assert.ok(
			tokenizers.has(monacoId) || grammars.has(monacoId),
			`${id} must map to a Monaco tokenizer (${monacoId})`,
		);
	}
	assert.doesNotMatch(runtime, /import ['"][^'"]*vs\/language\//u, 'the runtime must import no language service');
	assert.doesNotMatch(runtime, /from 'monaco-editor'/u, 'the runtime must not import the Monaco barrel');
	assert.match(runtime, /editor\.worker\.js/u, 'only the base editor worker is supplied');
});

test('React files highlight as their base language', () => {
	assert.match(runtime, /case 'typescriptreact':\s*return 'typescript'/u);
	assert.match(runtime, /case 'javascriptreact':\s*return 'javascript'/u);
	assert.match(textViewer, /monacoLanguageId\(languageFromFilePath/u);
});

test('every Monaco consumer goes through the runtime module', () => {
	assert.doesNotMatch(textViewer, /from 'monaco-editor'/u);
	assert.match(textViewer, /from '\.\.\/monacoRuntime'/u);
	assert.match(macros, /import '\.\/file-viewer\/monacoRuntime'/u);
	assert.doesNotMatch(macros, /from 'monaco-editor'/u);
});
