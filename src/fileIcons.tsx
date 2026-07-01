import {
	IconFileDatabase,
	IconFileTypeBmp,
	IconFileTypeCss,
	IconFileTypeCsv,
	IconFileTypeDoc,
	IconFileTypeDocx,
	IconFileTypeHtml,
	IconFileTypeJpg,
	IconFileTypeJs,
	IconFileTypeJsx,
	IconFileTypePdf,
	IconFileTypePhp,
	IconFileTypePng,
	IconFileTypePpt,
	IconFileTypeRs,
	IconFileTypeSql,
	IconFileTypeSvg,
	IconFileTypeTs,
	IconFileTypeTsx,
	IconFileTypeTxt,
	IconFileTypeVue,
	IconFileTypeXls,
	IconFileTypeXml,
	IconFileTypeZip,
} from '@tabler/icons-react';
import {
	File,
	FileArchive,
	FileAudio,
	FileCode,
	FileCog,
	FileImage,
	FileJson,
	FileKey,
	FileTerminal,
	FileText,
	FileType,
	FileVideo,
} from 'lucide-react';
import type { ComponentType, JSX } from 'react';

export type FileIconProps = {
	size?: number;
	className?: string;
	'aria-hidden'?: boolean;
};

export type FileIconComponent = ComponentType<FileIconProps>;

const ICONS_BY_EXTENSION: Record<string, FileIconComponent> = {
	// languages with dedicated marks
	cjs: IconFileTypeJs,
	css: IconFileTypeCss,
	cts: IconFileTypeTs,
	htm: IconFileTypeHtml,
	html: IconFileTypeHtml,
	js: IconFileTypeJs,
	jsx: IconFileTypeJsx,
	less: IconFileTypeCss,
	mjs: IconFileTypeJs,
	mts: IconFileTypeTs,
	php: IconFileTypePhp,
	rs: IconFileTypeRs,
	sass: IconFileTypeCss,
	scss: IconFileTypeCss,
	sql: IconFileTypeSql,
	ts: IconFileTypeTs,
	tsx: IconFileTypeTsx,
	vue: IconFileTypeVue,
	xml: IconFileTypeXml,
	// other code
	c: FileCode,
	cc: FileCode,
	cpp: FileCode,
	cs: FileCode,
	go: FileCode,
	h: FileCode,
	hpp: FileCode,
	java: FileCode,
	kt: FileCode,
	lua: FileCode,
	pl: FileCode,
	py: FileCode,
	rb: FileCode,
	scala: FileCode,
	swift: FileCode,
	// shell
	bat: FileTerminal,
	cmd: FileTerminal,
	fish: FileTerminal,
	ps1: FileTerminal,
	sh: FileTerminal,
	zsh: FileTerminal,
	// data & config
	cfg: FileCog,
	conf: FileCog,
	ini: FileCog,
	json: FileJson,
	json5: FileJson,
	jsonc: FileJson,
	toml: FileCog,
	yaml: FileCog,
	yml: FileCog,
	// documents
	csv: IconFileTypeCsv,
	doc: IconFileTypeDoc,
	docx: IconFileTypeDocx,
	log: IconFileTypeTxt,
	markdown: FileText,
	md: FileText,
	mdx: FileText,
	pdf: IconFileTypePdf,
	ppt: IconFileTypePpt,
	pptx: IconFileTypePpt,
	tsv: IconFileTypeCsv,
	txt: IconFileTypeTxt,
	xls: IconFileTypeXls,
	xlsx: IconFileTypeXls,
	// images
	avif: FileImage,
	bmp: IconFileTypeBmp,
	gif: FileImage,
	heic: FileImage,
	heif: FileImage,
	icns: FileImage,
	ico: FileImage,
	jpeg: IconFileTypeJpg,
	jpg: IconFileTypeJpg,
	png: IconFileTypePng,
	svg: IconFileTypeSvg,
	tif: FileImage,
	tiff: FileImage,
	webp: FileImage,
	// audio & video
	aac: FileAudio,
	avi: FileVideo,
	flac: FileAudio,
	m4a: FileAudio,
	m4v: FileVideo,
	mkv: FileVideo,
	mov: FileVideo,
	mp3: FileAudio,
	mp4: FileVideo,
	ogg: FileAudio,
	wav: FileAudio,
	webm: FileVideo,
	// archives
	'7z': FileArchive,
	bz2: FileArchive,
	gz: FileArchive,
	rar: FileArchive,
	tar: FileArchive,
	tgz: FileArchive,
	xz: FileArchive,
	zip: IconFileTypeZip,
	// misc
	cer: FileKey,
	crt: FileKey,
	db: IconFileDatabase,
	eot: FileType,
	key: FileKey,
	otf: FileType,
	pem: FileKey,
	sqlite: IconFileDatabase,
	sqlite3: IconFileDatabase,
	ttf: FileType,
	woff: FileType,
	woff2: FileType,
};

export function getFileIcon(fileName: string): FileIconComponent {
	const lastDot = fileName.lastIndexOf('.');
	if (lastDot <= 0) {
		return File;
	}
	const extension = fileName.slice(lastDot + 1).toLowerCase();
	return ICONS_BY_EXTENSION[extension] ?? File;
}

export function FileTypeIcon({
	name,
	size = 14,
}: {
	name: string;
	size?: number;
}): JSX.Element {
	const Icon = getFileIcon(name);
	return <Icon size={size} aria-hidden />;
}
