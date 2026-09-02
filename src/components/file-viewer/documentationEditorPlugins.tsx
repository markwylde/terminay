import {
	AdmonitionDirectiveDescriptor,
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	CodeToggle,
	CreateLink,
	codeBlockPlugin,
	codeMirrorPlugin,
	DiffSourceToggleWrapper,
	diffSourcePlugin,
	directivesPlugin,
	frontmatterPlugin,
	headingsPlugin,
	InsertAdmonition,
	InsertCodeBlock,
	InsertFrontmatter,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	imagePlugin,
	jsxPlugin,
	ListsToggle,
	linkPlugin,
	listsPlugin,
	markdownShortcutPlugin,
	lexicalTheme as mdxEditorLexicalTheme,
	quotePlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from '@mdxeditor/editor';

export const documentationEditorPluginNames = Object.freeze([
	'headingsPlugin',
	'listsPlugin',
	'quotePlugin',
	'thematicBreakPlugin',
	'linkPlugin',
	'imagePlugin',
	'tablePlugin',
	'codeBlockPlugin',
	'codeMirrorPlugin',
	'frontmatterPlugin',
	'directivesPlugin',
	'jsxPlugin',
	'markdownShortcutPlugin',
	'diffSourcePlugin',
	'toolbarPlugin',
]);

export const documentationLexicalTheme = {
	...mdxEditorLexicalTheme,
	admonition: {
		caution:
			'documentation-editor__admonition documentation-editor__admonition--caution',
		danger:
			'documentation-editor__admonition documentation-editor__admonition--danger',
		info: 'documentation-editor__admonition documentation-editor__admonition--info',
		note: 'documentation-editor__admonition documentation-editor__admonition--note',
		tip: 'documentation-editor__admonition documentation-editor__admonition--tip',
	},
};

/** Configured once for every Documentation editor instance. */
export const documentationEditorPlugins = [
	headingsPlugin(),
	listsPlugin(),
	quotePlugin(),
	thematicBreakPlugin(),
	linkPlugin(),
	imagePlugin(),
	tablePlugin(),
	codeBlockPlugin(),
	codeMirrorPlugin({
		codeBlockLanguages: {
			'': 'Plain text',
			bash: 'Shell',
			css: 'CSS',
			html: 'HTML',
			javascript: 'JavaScript',
			json: 'JSON',
			jsx: 'JavaScript (React)',
			markdown: 'Markdown',
			tsx: 'TypeScript (React)',
			typescript: 'TypeScript',
			yaml: 'YAML',
		},
	}),
	frontmatterPlugin(),
	directivesPlugin({
		directiveDescriptors: [AdmonitionDirectiveDescriptor],
	}),
	jsxPlugin(),
	markdownShortcutPlugin(),
	diffSourcePlugin({ viewMode: 'rich-text' }),
	toolbarPlugin({
		toolbarContents: () => (
			<DiffSourceToggleWrapper>
				<UndoRedo />
				<BlockTypeSelect />
				<BoldItalicUnderlineToggles />
				<CodeToggle />
				<ListsToggle />
				<CreateLink />
				<InsertImage />
				<InsertTable />
				<InsertCodeBlock />
				<InsertAdmonition />
				<InsertFrontmatter />
				<InsertThematicBreak />
			</DiffSourceToggleWrapper>
		),
	}),
];
