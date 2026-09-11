// The workspace UI ships Monaco as an editor, not as a language service. This
// module is the only Monaco entry in the bundle: it loads the editor core, the
// standalone chrome, and the tokenizers for the languages the file viewer
// names. It deliberately imports nothing from `vs/language/*`, so the
// TypeScript, CSS, HTML, and JSON language workers and their modes are never
// emitted. Diagnostics, completions, and hovers are a server concern.
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/inspectTokens/inspectTokens.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/toggleHighContrast/toggleHighContrast.js';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css';
// Tokenizers only. Keep this list in step with `languageFromFilePath` in
// `codeHighlight.tsx`; `scripts/file-viewer-monaco-languages.test.mjs` fails
// when an emitted language id has no tokenizer here or in `monacoSetup.ts`.
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

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
			new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
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
