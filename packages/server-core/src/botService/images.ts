import { Buffer } from 'node:buffer';
import {
	BOT_ATTACHMENT_TYPE_BYTES,
	BOT_MESSAGE_UPLOAD_LIMITS,
	botAttachmentLimit,
	botAttachmentType,
	botEnvironmentId,
	isBotImageMime,
} from '@terminay/protocol';
import { type EngineDriver, ownedResource } from './engine.js';
import { BotError } from './store.js';

export const BOT_IMAGE_BYTES = 2 * 1024 * 1024;
/** The reader's header line plus the base64 of the largest allowed file. */
const ATTACHMENT_OUTPUT_BYTES =
	Math.ceil(BOT_MESSAGE_UPLOAD_LIMITS.fileBytes / 3) * 4 + 4096;
/** Strict base64: Buffer alone skips bad characters, so re-encode and compare. */
function strictBase64(value: string): Buffer | undefined {
	const bytes = Buffer.from(value, 'base64');
	return bytes.toString('base64') === value ? bytes : undefined;
}
const reader = `import os,sys,stat,base64
path=sys.argv[1]
root='/tmp' if path.startswith('/tmp/') else '/home/bot'
parts=path[len(root)+1:].split('/')
fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:
 for part in parts[:-1]:
  nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
  os.close(fd)
  fd=nxt
 out=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
 try:
  info=os.fstat(out)
  if not stat.S_ISREG(info.st_mode) or info.st_size > ${BOT_IMAGE_BYTES}: raise ValueError('invalid image')
  with os.fdopen(out,'rb',closefd=False) as f: data=f.read(${BOT_IMAGE_BYTES + 1})
  if len(data)>${BOT_IMAGE_BYTES}: raise ValueError('image too large')
  sys.stdout.write(base64.b64encode(data).decode())
 finally: os.close(out)
finally: os.close(fd)
`;
// One JSON header line, then the base64 content when the file is within the
// limit. An oversized file sends only its size and first bytes. Failures that
// are expected report a cause, and never facts about a file not safely opened.
const attachmentReader = `import base64,errno,json,os,stat,sys
limit=${BOT_MESSAGE_UPLOAD_LIMITS.fileBytes}
head=${BOT_ATTACHMENT_TYPE_BYTES}
path=sys.argv[1]
root='/tmp' if path.startswith('/tmp/') else '/home/bot'
parts=path[len(root)+1:].split('/')
def say(**value): sys.stdout.write(json.dumps(value)+'\\n')
def read():
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for part in parts[:-1]:
   nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   os.close(fd)
   fd=nxt
  out=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
  try:
   info=os.fstat(out)
   if not stat.S_ISREG(info.st_mode): return say(error='not-regular')
   with os.fdopen(out,'rb',closefd=False) as f:
    if info.st_size>limit:
     return say(size=info.st_size,over=True,head=base64.b64encode(f.read(head)).decode())
    data=f.read(limit+1)
   if len(data)>limit:
    return say(size=len(data),over=True,head=base64.b64encode(data[:head]).decode())
   say(size=len(data))
   sys.stdout.write(base64.b64encode(data).decode())
  finally: os.close(out)
 finally: os.close(fd)
try: read()
except OSError as e:
 causes={errno.ENOENT:'missing',errno.ELOOP:'unsafe',errno.ENOTDIR:'unsafe',errno.EACCES:'denied'}
 if e.errno not in causes: raise
 say(error=causes[e.errno])
`;
function containerPath(value: unknown, label: string): string {
	const lower = label.toLowerCase();
	if (
		typeof value !== 'string' ||
		value.length > 4096 ||
		[...value].some((char) => char.charCodeAt(0) < 32)
	)
		throw new Error(`Invalid ${lower} path`);
	if (!value.startsWith('/tmp/') && !value.startsWith('/home/bot/'))
		throw new Error(`${label} must be inside the bot container`);
	if (
		value
			.split('/')
			.slice(1)
			.some((p) => !p || p === '.' || p === '..')
	)
		throw new Error(`Invalid ${lower} path`);
	return value;
}
export function botImagePath(value: unknown): string {
	return containerPath(value, 'Image');
}
export function botImageMime(bytes: Uint8Array): string {
	const b = Buffer.from(bytes);
	if (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
		return 'image/png';
	if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
	if (/^GIF8[79]a/.test(b.subarray(0, 6).toString())) return 'image/gif';
	if (
		b.subarray(0, 4).toString() === 'RIFF' &&
		b.subarray(8, 12).toString() === 'WEBP'
	)
		return 'image/webp';
	throw new Error('Only PNG, JPEG, GIF and WebP images are supported');
}
export async function readBotImage(
	driver: EngineDriver,
	serverId: string,
	botId: string,
	path: unknown,
	signal?: AbortSignal,
): Promise<{ mime: string; bytes: Uint8Array }> {
	const safe = botImagePath(path),
		name = `terminay-bot-${botEnvironmentId(botId)}`;
	const container = await driver.inspect('container', name);
	if (
		!container ||
		!ownedResource(container, serverId, botId) ||
		!container.State?.Running
	)
		throw new Error('The bot container must be running to read this image');
	const encoded = await driver.exec(name, ['python3', '-c', reader, safe], {
		user: 'bot',
		signal,
		deadlineMs: 10000,
		maxBytes: 3 * 1024 * 1024,
	});
	const bytes = Buffer.from(encoded.trim(), 'base64');
	if (bytes.length > BOT_IMAGE_BYTES) throw new Error('Image exceeds 2 MiB');
	return { mime: botImageMime(bytes), bytes };
}

const mebibytes = (bytes: number) =>
	`${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
function attachmentSizeRefusal(
	name: string,
	size: number,
	mime: string,
): BotError {
	if (!isBotImageMime(mime))
		return new BotError(
			'validation',
			`${name} is ${mebibytes(size)} (${mime}); non-image attachments are limited to 5 MiB`,
		);
	const hint =
		mime === 'image/gif'
			? '. Convert an animation to MP4 or WebM to attach up to 5 MiB'
			: '';
	return new BotError(
		'validation',
		`${name} is ${mebibytes(size)} (${mime}); images are limited to 2 MiB${hint}`,
	);
}
const READ_REFUSALS: Readonly<Record<string, string>> = {
	missing: 'does not exist in the bot container',
	unsafe: 'cannot be attached through a symlink',
	denied: 'cannot be read by the bot',
	'not-regular': 'is not a regular file',
};
/**
 * Read one file a bot attaches to a post, under the user-upload rules. The
 * bytes, size and path are untrusted; the name is used only in refusals.
 */
export async function readBotAttachment(
	driver: EngineDriver,
	serverId: string,
	botId: string,
	path: unknown,
	displayName: string,
	signal?: AbortSignal,
): Promise<{ mime: string; bytes: Uint8Array }> {
	let safe: string;
	try {
		safe = containerPath(path, 'Attachment');
	} catch (error) {
		throw new BotError('validation', (error as Error).message);
	}
	const name = `terminay-bot-${botEnvironmentId(botId)}`;
	const container = await driver.inspect('container', name);
	if (
		!container ||
		!ownedResource(container, serverId, botId) ||
		!container.State?.Running
	)
		throw new BotError(
			'conflict',
			'The bot container must be running to read this attachment',
		);
	const output = await driver.exec(
		name,
		['python3', '-c', attachmentReader, safe],
		{
			user: 'bot',
			signal,
			deadlineMs: 30000,
			maxBytes: ATTACHMENT_OUTPUT_BYTES,
		},
	);
	const malformed = () =>
		new BotError('internal', `${displayName} could not be read`);
	// A transport may trim the final newline of a header-only reply.
	const newline = output.indexOf('\n');
	const headerEnd = newline < 0 ? output.length : newline;
	if (headerEnd > 1024) throw malformed();
	let header: {
		error?: unknown;
		size?: unknown;
		over?: unknown;
		head?: unknown;
	};
	try {
		header = JSON.parse(output.slice(0, headerEnd));
	} catch {
		throw malformed();
	}
	if (!header || typeof header !== 'object' || Array.isArray(header))
		throw malformed();
	if (typeof header.error === 'string') {
		const reason = READ_REFUSALS[header.error];
		if (!reason) throw malformed();
		throw new BotError('validation', `${displayName} ${reason}`);
	}
	const size = header.size;
	if (!Number.isSafeInteger(size) || (size as number) < 0) throw malformed();
	if (header.over === true) {
		const head =
			typeof header.head === 'string' ? strictBase64(header.head) : undefined;
		if (
			!head ||
			head.length > BOT_ATTACHMENT_TYPE_BYTES ||
			(size as number) <= BOT_MESSAGE_UPLOAD_LIMITS.fileBytes
		)
			throw malformed();
		throw attachmentSizeRefusal(
			displayName,
			size as number,
			botAttachmentType(head),
		);
	}
	if (header.over !== undefined || header.head !== undefined) throw malformed();
	const bytes = strictBase64(
		newline < 0 ? '' : output.slice(newline + 1).trim(),
	);
	if (!bytes || bytes.length !== size) throw malformed();
	if (bytes.length < 1)
		throw new BotError('validation', `${displayName} is empty`);
	const mime = botAttachmentType(bytes);
	if (bytes.length > botAttachmentLimit(mime))
		throw attachmentSizeRefusal(displayName, bytes.length, mime);
	return { mime, bytes };
}

/** Where an execution's message images are copied inside its bot container. */
export const BOT_EXECUTION_IMAGE_ROOT = '/tmp/terminay-attachments';
const extensions: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
};
/** An image's extension from its type; any other file's from the offered
 * name's last extension when it is 1-10 ASCII letters or digits, else `bin`. */
export function attachmentExtension(mime: string, name: string): string {
	const image = extensions[mime];
	if (image) return image;
	const dot = name.lastIndexOf('.');
	const tail = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
	return /^[a-z0-9]{1,10}$/.test(tail) ? tail : 'bin';
}
/** Server-chosen: position and extension only, never the rest of the offered name. */
export function executionAttachmentPath(
	executionId: string,
	index: number,
	mime: string,
	name: string,
): string {
	if (!/^[a-z0-9]{24}$/.test(executionId) || !Number.isSafeInteger(index))
		throw new Error('Invalid execution attachment');
	return `${BOT_EXECUTION_IMAGE_ROOT}/${executionId}/${index + 1}.${attachmentExtension(mime, name)}`;
}
// Traverses with dir_fd and O_NOFOLLOW, writes a temporary file, then renames it
// into place, so a symlink is never followed and no partial image is left.
const writer = `import os,sys
execution,name=sys.argv[1],sys.argv[2]
data=sys.stdin.buffer.read(${BOT_MESSAGE_UPLOAD_LIMITS.fileBytes + 1})
if len(data)>${BOT_MESSAGE_UPLOAD_LIMITS.fileBytes}: raise ValueError('attachment too large')
def sub(parent,part):
 try: os.mkdir(part,0o700,dir_fd=parent)
 except FileExistsError: pass
 fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
 os.close(parent)
 return fd
fd=sub(os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY),'terminay-attachments')
fd=sub(fd,execution)
part='.'+name+'.part'
try: os.unlink(part,dir_fd=fd)
except FileNotFoundError: pass
out=os.open(part,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
with os.fdopen(out,'wb') as f: f.write(data)
os.replace(part,name,src_dir_fd=fd,dst_dir_fd=fd)
os.close(fd)
`;
const remover = `import os,shutil,sys
path='${BOT_EXECUTION_IMAGE_ROOT}/'+sys.argv[1]
if os.path.isdir(path) and not os.path.islink(path): shutil.rmtree(path,ignore_errors=True)
`;
async function ownedRunningContainer(
	driver: EngineDriver,
	serverId: string,
	botId: string,
): Promise<string> {
	const name = `terminay-bot-${botEnvironmentId(botId)}`;
	const container = await driver.inspect('container', name);
	if (
		!container ||
		!ownedResource(container, serverId, botId) ||
		!container.State?.Running
	)
		throw new Error('The bot container must be running to receive attachments');
	return name;
}
/** Copy one execution's message attachments into the owning bot container. */
export async function writeExecutionAttachments(
	driver: EngineDriver,
	serverId: string,
	botId: string,
	executionId: string,
	files: readonly { name: string; mime: string; bytes: Uint8Array }[],
	signal?: AbortSignal,
): Promise<string[]> {
	if (!files.length) return [];
	const container = await ownedRunningContainer(driver, serverId, botId);
	const paths: string[] = [];
	for (const [index, image] of files.entries()) {
		if (image.bytes.length > botAttachmentLimit(image.mime))
			throw new Error('Attachment exceeds its size limit');
		const path = executionAttachmentPath(
			executionId,
			index,
			image.mime,
			image.name,
		);
		await driver.exec(
			container,
			[
				'python3',
				'-c',
				writer,
				executionId,
				path.slice(path.lastIndexOf('/') + 1),
			],
			{
				user: 'bot',
				signal,
				deadlineMs: 10000,
				maxBytes: 4096,
				input: Buffer.from(image.bytes),
			},
		);
		paths.push(path);
	}
	return paths;
}
/** Best effort: remove an execution's attachment copies; the durable attachment remains. */
export async function removeExecutionAttachments(
	driver: EngineDriver,
	botId: string,
	executionId: string,
): Promise<void> {
	if (!/^[a-z0-9]{24}$/.test(executionId)) return;
	await driver
		.exec(
			`terminay-bot-${botEnvironmentId(botId)}`,
			['python3', '-c', remover, executionId],
			{ user: 'bot', deadlineMs: 10000, maxBytes: 4096 },
		)
		.catch(() => undefined);
}
