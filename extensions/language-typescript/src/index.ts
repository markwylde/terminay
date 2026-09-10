import { defineExtension } from '@terminay/extension-api';
import type {
	LanguageServerLaunch,
	LanguageServerLaunchRequest,
	LanguageServerProviderRuntime,
} from '@terminay/extension-api';
import { languageServerCliPath, resolveTypeScript } from './resolve.js';

export const EXTENSION_ID = 'com.terminay.language.typescript';
export const LANGUAGE_SERVER_ID = 'typescript';

export {
	bundledTypeScript,
	languageServerCliPath,
	resolveTypeScript,
} from './resolve.js';
export type { ResolvedTypeScript } from './resolve.js';

/**
 * Starts `typescript-language-server --stdio`. It is launched through this
 * extension's own Node executable rather than through the CLI's executable
 * bit, so the server runs on the runtime the host already vouches for and the
 * launch does not depend on how the package was extracted.
 */
export const typescriptLanguageServer: LanguageServerProviderRuntime = {
	async launch(
		request: LanguageServerLaunchRequest,
		signal: AbortSignal,
	): Promise<LanguageServerLaunch> {
		if (signal.aborted) throw new Error('language server launch was aborted');
		const typescript = resolveTypeScript(request.projectRoot);
		return {
			command: process.execPath,
			args: [languageServerCliPath(), '--stdio'],
			initializationOptions: {
				tsserver: { path: typescript.tsserverPath },
			},
			description: typescript.description,
		};
	},
};

export default defineExtension({
	activate(context) {
		context.registerLanguageServerProvider({
			id: LANGUAGE_SERVER_ID,
			runtime: typescriptLanguageServer,
		});
	},
});
