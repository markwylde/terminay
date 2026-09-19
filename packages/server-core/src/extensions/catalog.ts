export interface OfficialExtensionCatalogueRecord {
	readonly extensionId: string;
	readonly packageName: string;
	readonly displayName: string;
	readonly description: string;
	readonly publisher: 'Terminay';
	readonly official: true;
}

/** Catalogue membership is presentation metadata, never extra runtime authority. */
export const OFFICIAL_EXTENSION_CATALOGUE: readonly OfficialExtensionCatalogueRecord[] =
	Object.freeze([
		Object.freeze({
			extensionId: 'com.terminay.builtin-agents',
			packageName: 'terminay-builtin-agents',
			displayName: 'Built-in Agents',
			description:
				'Show Claude Code, Codex, Grok, and oh-my-pi sessions in the Agents sidebar, and register the Terminay MCP server with coding-agent CLIs.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.language.typescript',
			packageName: 'terminay-language-typescript',
			displayName: 'TypeScript',
			description:
				'Diagnostics, completion, hover, and go-to-definition for TypeScript and JavaScript.',
			publisher: 'Terminay',
			official: true,
		}),
	]);
