export type FolderPanelInstanceParams = {
	color?: string;
	emoji?: string;
	folderPath: string;
	inheritsProjectColor?: boolean;
	isFocused?: boolean;
	projectColor?: string;
};

export type FolderViewMode = 'tree' | 'list' | 'thumbnail' | 'gallery';

export type FolderFileNode = {
	kind: 'file';
	extension: string;
	isImage: boolean;
	name: string;
	path: string;
	relativePath: string;
};

export type FolderDirectoryNode = {
	kind: 'directory';
	children: FolderTreeNode[];
	childrenLoaded?: boolean;
	isLoadingChildren?: boolean;
	isSymbolicLink?: boolean;
	loadError?: string;
	name: string;
	path: string;
	relativePath: string;
};

export type FolderTreeNode = FolderFileNode | FolderDirectoryNode;

export type FolderSnapshot = {
	files: FolderFileNode[];
	root: FolderDirectoryNode;
	summary: {
		directoryCount: number;
		fileCount: number;
		imageCount: number;
	};
};
