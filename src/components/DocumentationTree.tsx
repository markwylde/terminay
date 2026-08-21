import type {
	DocumentationCatalog,
	DocumentationDocument,
} from '@terminay/client-core';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import type { ReactNode } from 'react';

export function DocumentationTree({
	catalog,
	error,
	expandedFolders,
	loading,
	onOpen,
	onToggleFolder,
}: {
	readonly catalog?: DocumentationCatalog;
	readonly error?: string;
	readonly expandedFolders: ReadonlySet<string>;
	readonly loading: boolean;
	readonly onOpen: (path: string) => void;
	readonly onToggleFolder: (path: string) => void;
}) {
	if (loading && catalog === undefined)
		return (
			<div className="documentation-tree" role="status">
				Loading documentation…
			</div>
		);
	if (error !== undefined && catalog === undefined)
		return (
			<div className="documentation-tree" role="alert">
				Documentation unavailable: {error}
			</div>
		);
	if (catalog === undefined || catalog.documents.length === 0)
		return (
			<div className="documentation-tree">No Markdown documents found.</div>
		);
	const root: Node = { folders: new Map(), documents: [] };
	for (const document of catalog.documents) insert(root, document);
	return (
		<div className="documentation-tree" role="tree">
			{render(root, '', expandedFolders, onToggleFolder, onOpen)}
			{catalog.partial ? (
				<div role="status">Showing a partial document catalog.</div>
			) : null}
		</div>
	);
}
type Node = {
	readonly folders: Map<string, Node>;
	readonly documents: DocumentationDocument[];
};
function insert(root: Node, document: DocumentationDocument): void {
	const parts = document.relativePath.split('/');
	const name = parts.pop();
	if (name === undefined) return;
	let node = root;
	let path = '';
	for (const part of parts) {
		path = path ? `${path}/${part}` : part;
		let child = node.folders.get(part);
		if (!child) {
			child = { folders: new Map(), documents: [] };
			node.folders.set(part, child);
		}
		node = child;
	}
	node.documents.push(document);
}
function render(
	node: Node,
	path: string,
	expanded: ReadonlySet<string>,
	toggle: (path: string) => void,
	open: (path: string) => void,
): ReactNode {
	return (
		<>
			{[...node.folders.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, child]) => {
					const childPath = path ? `${path}/${name}` : name;
					const isExpanded = expanded.has(childPath);
					return (
						<div key={childPath} className="documentation-tree__folder">
							<button
								type="button"
								className="documentation-tree__row"
								role="treeitem"
								aria-expanded={isExpanded}
								onClick={() => toggle(childPath)}
							>
								<ChevronRight
									className="documentation-tree__chevron"
									data-expanded={isExpanded}
									size={14}
									aria-hidden="true"
								/>
								<Folder size={15} aria-hidden="true" />
								<span>{name}</span>
							</button>
							{isExpanded ? (
								<fieldset className="documentation-tree__group">
									{render(child, childPath, expanded, toggle, open)}
								</fieldset>
							) : null}
						</div>
					);
				})}
			{node.documents
				.slice()
				.sort(
					(a, b) =>
						a.title.localeCompare(b.title) ||
						a.relativePath.localeCompare(b.relativePath),
				)
				.map((document) => (
					<button
						key={document.relativePath}
						type="button"
						role="treeitem"
						className="documentation-tree__row documentation-tree__document"
						title={document.relativePath}
						aria-label={
							document.title ===
							document.relativePath
								.replace(/^.*\//u, '')
								.replace(/\.mdx?$/iu, '')
								? document.title
								: `${document.title}, ${document.relativePath}`
						}
						onClick={() => open(document.relativePath)}
					>
						<span className="documentation-tree__spacer" />
						<FileText size={15} aria-hidden="true" />
						<span>{document.title}</span>
					</button>
				))}
		</>
	);
}
