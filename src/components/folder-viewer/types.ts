export type FolderPanelInstanceParams = {
	color?: string;
	emoji?: string;
	folderPath: string;
	inheritsProjectColor?: boolean;
	isFocused?: boolean;
	projectColor?: string;
};

export type FolderViewMode = 'tree' | 'tasks' | 'list' | 'thumbnail' | 'gallery';

export type FolderNodeStats = {
	createdAtMs: number | null;
	mode: number | null;
	modifiedAtMs: number | null;
	size: number | null;
};

export type FolderFileNode = {
	kind: 'file';
	extension: string;
	isImage: boolean;
	name: string;
	path: string;
	relativePath: string;
	stats: FolderNodeStats;
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
	stats?: FolderNodeStats;
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
