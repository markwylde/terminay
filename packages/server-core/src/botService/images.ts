import { Buffer } from 'node:buffer';
import { botEnvironmentId } from '@terminay/protocol';
import { type EngineDriver, ownedResource } from './engine.js';

export const BOT_IMAGE_BYTES = 2 * 1024 * 1024;
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
export function botImagePath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > 4096 ||
		[...value].some((char) => char.charCodeAt(0) < 32)
	)
		throw new Error('Invalid image path');
	if (!value.startsWith('/tmp/') && !value.startsWith('/home/bot/'))
		throw new Error('Image must be inside the bot container');
	if (
		value
			.split('/')
			.slice(1)
			.some((p) => !p || p === '.' || p === '..')
	)
		throw new Error('Invalid image path');
	return value;
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
