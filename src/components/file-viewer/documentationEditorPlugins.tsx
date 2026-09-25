import {
	AdmonitionDirectiveDescriptor,
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	ButtonWithTooltip,
	CodeToggle,
	CreateLink,
	codeBlockPlugin,
	codeMirrorPlugin,
	DiffSourceToggleWrapper,
	diffSourcePlugin,
	directivesPlugin,
	frontmatterPlugin,
	headingsPlugin,
	type ImagePreviewHandler,
	InsertAdmonition,
	InsertCodeBlock,
	InsertFrontmatter,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	imagePlugin,
	importVisitors$,
	jsxPlugin,
	ListsToggle,
	linkPlugin,
	listsPlugin,
	type MdastImportVisitor,
	markdownShortcutPlugin,
	lexicalTheme as mdxEditorLexicalTheme,
	quotePlugin,
	realmPlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from '@mdxeditor/editor';
import { $createTextNode } from 'lexical';
import type * as Mdast from 'mdast';
import { collapseSoftLineBreaks } from './documentationMarkdownCompat';

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

/**
 * MDXEditor imports an mdast `text` node verbatim, so a paragraph wrapped over
 * several source lines keeps its newlines, and Lexical — which forces
 * `white-space: pre-wrap` on its editable root — renders each one as a line
 * break. The document then reads nothing like the live preview beside it, or
 * like any other Markdown renderer. Upstream reads this as a difference between
 * Markdown engines (mdx-editor/editor#646), so the correction lives here.
 *
 * CSS cannot fix it: collapsing a newline without collapsing the spaces Lexical
 * depends on needs `white-space-collapse: preserve-spaces`, which no Chromium
 * implements. So the newline is collapsed on the way in instead, and the
 * document model holds the space it always stood for.
 */
const softLineBreakTextVisitor: MdastImportVisitor<Mdast.Text> = {
	testNode: 'text',
	visitNode({ mdastNode, actions }) {
		const node = $createTextNode(collapseSoftLineBreaks(mdastNode.value));
		node.setFormat(actions.getParentFormatting());
		const style = actions.getParentStyle();
		if (style !== '') node.setStyle(style);
		actions.addAndStepInto(node);
	},
};

/**
 * Import visitors are matched first to last and the core text visitor is
 * registered before any plugin's, so replacing it means taking the front of the
 * list rather than appending to it. Every later plugin appends, which leaves
 * this one in front.
 */
export const softLineBreakPlugin = realmPlugin({
	init(realm) {
		realm.pub(importVisitors$, [
			softLineBreakTextVisitor as MdastImportVisitor<Mdast.Nodes>,
			...realm.getValue(importVisitors$),
		]);
	},
});

/**
 * Built once per Documentation editor instance, so each can load the images
 * its own document references and offer View source for its own panel.
 */
export const createDocumentationEditorPlugins = (
	imagePreviewHandler?: ImagePreviewHandler,
	onViewSource?: () => void,
) => [
	softLineBreakPlugin(),
	headingsPlugin(),
	listsPlugin(),
	quotePlugin(),
	thematicBreakPlugin(),
	linkPlugin(),
	imagePlugin({ imagePreviewHandler }),
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
				{onViewSource ? (
					<ButtonWithTooltip
						className="documentation-editor__view-source"
						onClick={onViewSource}
						title="View source"
					>
						View source
					</ButtonWithTooltip>
				) : null}
			</DiffSourceToggleWrapper>
		),
	}),
];
