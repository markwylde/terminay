import * as mdxEditor from '@mdxeditor/editor';
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
	syntaxExtensions$,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from '@mdxeditor/editor';
import type { NodeRef } from '@mdxeditor/gurx';
import { $createTextNode } from 'lexical';
import type * as Mdast from 'mdast';
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown';
import { sameMarkdownDocument } from './documentationEditorChanges';
import { collapseSoftLineBreaks } from './documentationMarkdownCompat';

/** Answers whether two Markdown texts are the same document to this editor. */
export type SameDocument = (left: string, right: string) => boolean;

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
 * The cell MDXEditor's parser reads its mdast extensions from. The package
 * exports it but leaves it out of its type declarations.
 */
const mdastExtensions$ = (
	mdxEditor as unknown as {
		mdastExtensions$?: NodeRef<
			NonNullable<FromMarkdownOptions['mdastExtensions']>
		>;
	}
).mdastExtensions$;

/**
 * Hands the editor's owner a comparison that reads Markdown with the syntax
 * and mdast extensions the editor itself parses with, so frontmatter,
 * directives, and JSX are the same document to both. The extensions are read
 * at each comparison, because plugins after this one are still adding theirs.
 */
export const documentComparisonPlugin = realmPlugin<{
	receive: (sameDocument: SameDocument) => void;
}>({
	init(realm, params) {
		params?.receive((left, right) => {
			// Without the editor's mdast extensions nothing can be said to be the
			// same document, and an edit is saved rather than dropped.
			if (mdastExtensions$ === undefined) return false;
			return sameMarkdownDocument(left, right, {
				extensions: realm.getValue(syntaxExtensions$),
				mdastExtensions: realm.getValue(mdastExtensions$),
			});
		});
	},
});

/**
 * Built once per Documentation editor instance, so each can load the images
 * its own document references and compare documents as it reads them.
 */
export const createDocumentationEditorPlugins = (
	imagePreviewHandler?: ImagePreviewHandler,
	receiveDocumentComparison: (sameDocument: SameDocument) => void = () => {},
) => [
	documentComparisonPlugin({ receive: receiveDocumentComparison }),
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
			</DiffSourceToggleWrapper>
		),
	}),
];
