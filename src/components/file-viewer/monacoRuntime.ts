// The workspace UI ships Monaco as an editor, not as a language service. This
// module is the only Monaco entry in the bundle: it loads the editor core, the
// standalone chrome, and the tokenizers for the languages the file viewer
// names. It deliberately imports nothing from `languages/features/*`, so the
// TypeScript, CSS, HTML, and JSON language workers and their modes are never
// emitted. Diagnostics, completions, and hovers are a server concern.
// Every editor feature, including the standalone quick-access, inspect-tokens,
// high-contrast, and reference-search contributions, and the codicon styles.
import 'monaco-editor/features/register.all.js';
// Tokenizers only. Keep this list in step with `languageFromFilePath` in
// `codeHighlight.tsx`; `scripts/file-viewer-monaco-languages.test.mjs` fails
// when an emitted language id has no tokenizer here or in `monacoSetup.ts`.
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';

declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker?: (workerId: string, label: string) => Worker;
		};
	}
}

// Only the base editor worker exists. It provides word-based suggestions,
// link detection, and diff computation; it is not a language service.
window.MonacoEnvironment = {
	getWorker: () =>
		new Worker(
			new URL('monaco-editor/editor/editor.worker.js', import.meta.url),
			{ type: 'module' },
		),
};

// Desktop and hosted UI both enforce a network-restrictive CSP. Supplying the
// bundled Monaco instance prevents @monaco-editor/react from attempting its
// default jsDelivr loader, which otherwise leaves the editor blank offline.
loader.config({ monaco });
Object.assign(window, { monaco });

/** Maps a file-viewer language id onto the Monaco tokenizer that renders it. */
export function monacoLanguageId(language: string | undefined): string | undefined {
	switch (language) {
		case 'typescriptreact':
			return 'typescript';
		case 'javascriptreact':
			return 'javascript';
		default:
			return language;
	}
}

export { monaco };
