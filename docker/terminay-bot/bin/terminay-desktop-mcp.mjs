#!/usr/bin/env node
// Terminay desktop MCP: a dependency-free stdio MCP server that gives the agent eyes and
// hands on its whole desktop (browser chrome, dialogs, other apps, a terminal), not
// just the web page chrome-devtools-mcp can reach.
//
//   terminay-desktop-mcp --endpoint=<base>
//   terminay-desktop-mcp --cap-output -- <mcp command> [args...]
//
// <base> is the desktop control service: the worker's tokenized CDP proxy for
// container agents (http://<gateway>:<port>/<token>) or the VM loopback CDP port for
// machine agents (http://127.0.0.1:<port>). initialize/tools/list are answered here
// without touching the desktop, so starting a session never starts one; the first
// tool call lazily starts it through the proxy.
//
// With --cap-output it instead wraps another stdio MCP server (chrome-devtools-mcp),
// passing messages through but moving any oversized tool result into a file, so one
// snapshot of a long page can't fill the agent's context window.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export function checkWork() {
	return new Promise((resolve, reject) =>
		execFile(
			'/usr/local/bin/terminay-bot-mcp',
			['--check-work'],
			{ timeout: 10000, maxBuffer: 4096 },
			(error) =>
				error
					? reject(
							new Error(
								'Acquire shared work; this execution may be revoked or no longer own the desktop.',
							),
						)
					: resolve(),
		),
	);
}
const SERVER_INFO = { name: 'terminay-desktop', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const REQUEST_TIMEOUT_MS = 120_000;

const MAX_SAVE_BYTES = 50 * 1024 * 1024;
const PREVIEW_LINES = 10;
const PREVIEW_LINE_CHARS = 200;
// About 10k tokens: well under any context window, yet larger than ordinary snapshots.
const MAX_RESULT_TEXT_CHARS = 40_000;

const ACTION_TYPES = [
	'move',
	'click',
	'double_click',
	'right_click',
	'drag',
	'scroll',
	'type',
	'key',
	'wait',
	'launch',
];
const WINDOW_ACTIONS = [
	'list',
	'focus',
	'close',
	'move',
	'maximize',
	'restore',
];

export const TOOLS = [
	{
		name: 'desktop_screenshot',
		description: [
			'Take a screenshot of your whole desktop: the browser window including its tab strip, address bar and menus, any dialogs or popups, other app windows such as the terminal or apps you installed, and the taskbar at the bottom. Returns the image plus the screen size, pointer position and active window title. Coordinates for desktop_act are pixels in the full-screen image.',
			'Use this (not the chrome-devtools screenshot) to see native apps. Pass window (an id from desktop_windows) to capture just that window, or region {x,y,width,height} in screen pixels to zoom in on a small area: it is enlarged up to 4x so small text, icons and palette swatches are readable. For a cropped image the result gives its origin and scale; the screen point for image pixel (px,py) is (origin.x + px/scale, origin.y + py/scale).',
			'Pass savePath to also write the PNG to a file (relative paths resolve against your working directory), for example to attach it to a message.',
		].join('\n\n'),
		inputSchema: {
			type: 'object',
			properties: {
				window: {
					type: 'string',
					description:
						'Capture only this window (an id such as 0x01800003 from desktop_windows).',
				},
				region: {
					type: 'object',
					description:
						'Capture and enlarge this area of the screen, in screen pixels.',
					properties: {
						x: { type: 'integer', minimum: 0 },
						y: { type: 'integer', minimum: 0 },
						width: { type: 'integer', minimum: 1 },
						height: { type: 'integer', minimum: 1 },
					},
					required: ['x', 'y', 'width', 'height'],
					additionalProperties: false,
				},
				savePath: {
					type: 'string',
					description: 'Also save the PNG to this file path.',
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: 'desktop_windows',
		description: [
			"List the app windows on your desktop, or manage one. action list (the default) returns each window's id, title, position and size in screen pixels, owning process id, and which one has keyboard focus.",
			'focus raises a window and gives it keyboard focus (do this before typing into it); close asks it to close the way its close button would; move {x?,y?,width?,height?} moves and/or resizes it; maximize and restore toggle full-screen size.',
			'Window ids change when apps restart, so list again rather than reusing old ids.',
		].join('\n\n'),
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: WINDOW_ACTIONS },
				windowId: {
					type: 'string',
					description: 'Window id from the list, for example 0x01800003.',
				},
				x: { type: 'integer', minimum: 0 },
				y: { type: 'integer', minimum: 0 },
				width: { type: 'integer', minimum: 1 },
				height: { type: 'integer', minimum: 1 },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'desktop_act',
		description: [
			'Control your desktop with the mouse and keyboard, then get a fresh screenshot. Use this for anything outside the web page itself: browser tabs, the address bar, browser menus and settings, permission/download/print/file dialogs, extensions, the taskbar, and other apps (launch a terminal or a new browser window).',
			'For reading and interacting with page content, prefer the chrome-devtools tools; they are faster and more precise. To find, focus, move or close app windows, use desktop_windows instead of guessing at title bars.',
			'Actions run in order. x/y are pixels in the most recent screenshot (top-left is 0,0). Always look at the returned screenshot before acting again; the human can use the same desktop at the same time, so things may have moved.',
			'Action types: move {x,y}; click {x?,y?,button?: left|middle|right, count?: 1-3}; double_click {x,y}; right_click {x,y}; drag {fromX,fromY,toX,toY}; scroll {x?,y?,direction: up|down|left|right, amount?: 1-25}; type {text} (\\n presses Enter); key {keys} using xdotool key names joined with + and separated by spaces, e.g. "ctrl+t", "ctrl+l", "Return", "Escape", "alt+Tab"; wait {ms <= 10000}; launch {app: terminal|browser, url?}.',
			'If you need the human (for example to enter a password or solve a CAPTCHA), ask them in Team chat instead of guessing.',
		].join('\n\n'),
		inputSchema: {
			type: 'object',
			properties: {
				actions: {
					type: 'array',
					minItems: 1,
					maxItems: 50,
					items: {
						type: 'object',
						properties: {
							type: { type: 'string', enum: ACTION_TYPES },
							x: { type: 'number' },
							y: { type: 'number' },
							fromX: { type: 'number' },
							fromY: { type: 'number' },
							toX: { type: 'number' },
							toY: { type: 'number' },
							button: { type: 'string', enum: ['left', 'middle', 'right'] },
							count: { type: 'integer', minimum: 1, maximum: 3 },
							direction: {
								type: 'string',
								enum: ['up', 'down', 'left', 'right'],
							},
							amount: { type: 'integer', minimum: 1, maximum: 25 },
							text: { type: 'string' },
							keys: { type: 'string' },
							ms: { type: 'integer', minimum: 0, maximum: 10000 },
							app: { type: 'string', enum: ['terminal', 'browser'] },
							url: { type: 'string' },
						},
						required: ['type'],
					},
				},
				screenshot: {
					type: 'boolean',
					description: 'Return a screenshot after the actions (default true).',
				},
			},
			required: ['actions'],
			additionalProperties: false,
		},
	},
	{
		name: 'browser_save',
		description: [
			'Save a web page or log to a file in your workspace instead of reading it into the conversation. Use this for anything long (CI/job logs, build output, large pages, API responses) rather than take_snapshot, which returns the whole page and can exhaust your context.',
			"With `url`, downloads it using the browser's cookies for that URL, so pages behind the browser's login work, and saves the raw body. Prefer raw/plain-text endpoints, e.g. a Gitea or Forgejo Actions job log at <repo>/actions/runs/<run>/jobs/<job>/logs.",
			"Without `url`, saves the rendered text of the browser's active tab.",
			"Returns the file path, size, line count and the first and last few lines. Then search or slice the file with your shell (rg, grep -n, sed -n 'A,Bp', tail) instead of printing it whole.",
		].join('\n\n'),
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description:
						"http(s) URL to download with the browser's cookies. Omit to save the active tab's text.",
				},
				path: {
					type: 'string',
					description:
						'File to write, absolute or relative to your home directory. Defaults to ~/browser-saves/<timestamp>-<name>.txt.',
				},
			},
			additionalProperties: false,
		},
	},
];

export function parseEndpoint(argv) {
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg.startsWith('--endpoint='))
			return arg.slice('--endpoint='.length).replace(/\/+$/, '');
		if (arg === '--endpoint' && argv[i + 1])
			return argv[i + 1].replace(/\/+$/, '');
	}
	return null;
}

async function desktopRequest(endpoint, route, init = {}, fetchImpl = fetch) {
	let response;
	try {
		response = await fetchImpl(`${endpoint}/terminay-desktop/${route}`, {
			...init,
			headers: { ...init.headers, 'x-terminay-execution': '1' },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`The desktop is not reachable (${error instanceof Error ? error.message : String(error)}). It may still be starting; try again shortly.`,
		);
	}
	const text = await response.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		// fall through with the raw text
	}
	if (!response.ok) {
		const message =
			body && typeof body.error === 'string'
				? body.error
				: text.slice(0, 300) || `HTTP ${response.status}`;
		throw new Error(
			response.status === 404 && !body
				? 'The desktop is not available for this session.'
				: message,
		);
	}
	return body ?? {};
}

// A minimal client-side WebSocket (RFC 6455) for CDP. Node only has a global
// WebSocket from v22, and machine agents run the distro's Node, so speak the
// protocol directly: masked text frames out, reassembled text frames in.
function openWebSocket(url, timeoutMs = 15_000) {
	return new Promise((resolvePromise, reject) => {
		const target = new URL(url);
		const secure = target.protocol === 'wss:';
		const req = (secure ? httpsRequest : httpRequest)({
			host: target.hostname,
			port: target.port || (secure ? 443 : 80),
			path: `${target.pathname}${target.search}`,
			agent: false,
			headers: {
				connection: 'Upgrade',
				upgrade: 'websocket',
				'sec-websocket-version': '13',
				'sec-websocket-key': randomBytes(16).toString('base64'),
			},
			timeout: timeoutMs,
		});
		req.on('upgrade', (_res, socket, head) =>
			resolvePromise(wrapSocket(socket, head)),
		);
		req.on('response', (res) =>
			reject(
				new Error(
					`Browser refused the CDP connection (HTTP ${res.statusCode}).`,
				),
			),
		);
		req.on('timeout', () =>
			req.destroy(new Error('Timed out connecting to the browser.')),
		);
		req.on('error', reject);
		req.end();
	});
}

function wrapSocket(socket, head) {
	const listeners = new Set();
	let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
	let fragments = [];
	const send = (opcode, payload) => {
		const mask = randomBytes(4);
		const length = payload.length;
		const header =
			length < 126
				? Buffer.alloc(2)
				: length < 65536
					? Buffer.alloc(4)
					: Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		if (length < 126) header[1] = 0x80 | length;
		else if (length < 65536) {
			header[1] = 0x80 | 126;
			header.writeUInt16BE(length, 2);
		} else {
			header[1] = 0x80 | 127;
			header.writeBigUInt64BE(BigInt(length), 2);
		}
		const masked = Buffer.alloc(length);
		for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
		socket.write(Buffer.concat([header, mask, masked]));
	};
	const drain = () => {
		while (buffer.length >= 2) {
			const fin = (buffer[0] & 0x80) !== 0;
			const opcode = buffer[0] & 0x0f;
			let length = buffer[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (buffer.length < 4) return;
				length = buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (buffer.length < 10) return;
				length = Number(buffer.readBigUInt64BE(2));
				offset = 10;
			}
			// Servers never mask frames sent to clients.
			if (buffer.length < offset + length) return;
			const payload = buffer.subarray(offset, offset + length);
			buffer = buffer.subarray(offset + length);
			if (opcode === 0x9) send(0xa, payload);
			else if (opcode === 0x8) socket.end();
			else if (opcode === 0x1 || opcode === 0x0) {
				fragments.push(Buffer.from(payload));
				if (fin) {
					const text = Buffer.concat(fragments).toString('utf-8');
					fragments = [];
					for (const listener of listeners) listener(text);
				}
			}
		}
	};
	socket.on('data', (chunk) => {
		buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
		drain();
	});
	return {
		send: (text) => send(0x1, Buffer.from(text, 'utf-8')),
		onMessage: (listener) => listeners.add(listener),
		onClose: (listener) => socket.on('close', listener),
		close: () => socket.destroy(),
	};
}

// The desktop endpoint shares Chromium's CDP port (directly for machine agents, via
// the worker's tokenized proxy for container agents, which rewrites the discovery URL
// back through itself), so /json/version yields a browser WebSocket we can reach.
async function connectCdp(endpoint, fetchImpl) {
	let version;
	try {
		const response = await fetchImpl(`${endpoint}/json/version`, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		version = await response.json();
	} catch (error) {
		throw new Error(
			`The browser is not reachable (${error instanceof Error ? error.message : String(error)}). It may still be starting; try again shortly.`,
		);
	}
	if (typeof version?.webSocketDebuggerUrl !== 'string')
		throw new Error('The browser did not report a CDP WebSocket URL.');
	const socket = await openWebSocket(version.webSocketDebuggerUrl);
	const pending = new Map();
	let nextId = 1;
	socket.onMessage((text) => {
		let message;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}
		const waiter = message.id === undefined ? null : pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error)
			waiter.reject(new Error(message.error.message ?? 'CDP error'));
		else waiter.resolve(message.result ?? {});
	});
	socket.onClose(() => {
		for (const waiter of pending.values())
			waiter.reject(new Error('The browser connection closed.'));
		pending.clear();
	});
	const send = (method, params = {}, sessionId) =>
		new Promise((resolveSend, rejectSend) => {
			const id = nextId;
			nextId += 1;
			const timer = setTimeout(() => {
				pending.delete(id);
				rejectSend(new Error(`The browser did not answer ${method} in time.`));
			}, REQUEST_TIMEOUT_MS);
			pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolveSend(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					rejectSend(error);
				},
			});
			socket.send(
				JSON.stringify({
					id,
					method,
					params,
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	return {
		send,
		userAgent:
			typeof version['User-Agent'] === 'string' ? version['User-Agent'] : null,
		close: socket.close,
	};
}

function isUserPage(target) {
	return (
		target.type === 'page' &&
		!/^(devtools|chrome|chrome-extension):/.test(target.url ?? '')
	);
}

async function pageTargets(cdp) {
	const { targetInfos = [] } = await cdp.send('Target.getTargets');
	return targetInfos.filter(isUserPage);
}

async function attach(cdp, targetId) {
	const { sessionId } = await cdp.send('Target.attachToTarget', {
		targetId,
		flatten: true,
	});
	return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
	const { result, exceptionDetails } = await cdp.send(
		'Runtime.evaluate',
		{ expression, returnByValue: true },
		sessionId,
	);
	if (exceptionDetails)
		throw new Error(
			exceptionDetails.exception?.description ??
				exceptionDetails.text ??
				'Page script failed.',
		);
	return result?.value;
}

// Only the selected tab of a browser window is visible, and the focused one is
// what the human (and chrome-devtools) last brought to the front.
async function activePageText(cdp) {
	const pages = await pageTargets(cdp);
	if (!pages.length) throw new Error('The browser has no open tab to save.');
	let best = null;
	for (const page of pages) {
		const sessionId = await attach(cdp, page.targetId);
		const state = await evaluate(
			cdp,
			sessionId,
			"({ visible: document.visibilityState === 'visible', focused: document.hasFocus() })",
		).catch(() => null);
		const score = state?.focused ? 2 : state?.visible ? 1 : 0;
		if (!best || score > best.score) best = { page, sessionId, score };
	}
	const text = await evaluate(
		cdp,
		best.sessionId,
		"(document.body ?? document.documentElement)?.innerText ?? ''",
	);
	return {
		text: String(text ?? ''),
		source: best.page.url,
		contentType: 'text/plain',
	};
}

async function cookieHeaderFor(cdp, url) {
	let pages = await pageTargets(cdp);
	let created = null;
	if (!pages.length) {
		created = await cdp.send('Target.createTarget', {
			url: 'about:blank',
			background: true,
		});
		pages = [{ targetId: created.targetId }];
	}
	try {
		const sessionId = await attach(cdp, pages[0].targetId);
		const { cookies = [] } = await cdp.send(
			'Network.getCookies',
			{ urls: [url] },
			sessionId,
		);
		return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
	} finally {
		if (created)
			await cdp
				.send('Target.closeTarget', { targetId: created.targetId })
				.catch(() => undefined);
	}
}

async function downloadWithBrowserCookies(cdp, url, fetchImpl) {
	const cookie = await cookieHeaderFor(cdp, url);
	const headers = {
		...(cookie ? { cookie } : {}),
		...(cdp.userAgent ? { 'user-agent': cdp.userAgent } : {}),
	};
	let response;
	try {
		response = await fetchImpl(url, {
			headers,
			redirect: 'follow',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`Could not download ${url} (${error instanceof Error ? error.message : String(error)}).`,
		);
	}
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > MAX_SAVE_BYTES)
		throw new Error(
			`${url} is ${declared} bytes, over the ${MAX_SAVE_BYTES}-byte limit.`,
		);
	const body = Buffer.from(await response.arrayBuffer());
	if (body.length > MAX_SAVE_BYTES)
		throw new Error(`${url} is over the ${MAX_SAVE_BYTES}-byte limit.`);
	if (!response.ok)
		throw new Error(
			`${url} returned HTTP ${response.status}: ${body.toString('utf-8').slice(0, 300)}`,
		);
	return {
		text: body,
		source: response.url || url,
		contentType: response.headers.get('content-type') ?? '',
	};
}

export function savePathFor(
	requested,
	source,
	now = new Date(),
	home = homedir(),
) {
	if (requested)
		return isAbsolute(requested) ? requested : resolve(home, requested);
	const stamp = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\..*$/, '')
		.replace('T', '-');
	let name = 'page';
	try {
		const parsed = new URL(source);
		name = `${parsed.hostname}${parsed.pathname}`;
	} catch {
		// keep the default name
	}
	const slug =
		name
			.replace(/[^A-Za-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(-80) || 'page';
	return resolve(home, 'browser-saves', `${stamp}-${slug}.txt`);
}

export function describeSavedFile(path, data, source, contentType) {
	const text = Buffer.isBuffer(data) ? data.toString('utf-8') : data;
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	const clip = (line) =>
		line.length > PREVIEW_LINE_CHARS
			? `${line.slice(0, PREVIEW_LINE_CHARS)}…`
			: line;
	const numbered = (from, to) =>
		lines
			.slice(from, to)
			.map((line, index) => `${from + index + 1}: ${clip(line)}`);
	const preview =
		lines.length <= PREVIEW_LINES * 2
			? numbered(0, lines.length)
			: [
					...numbered(0, PREVIEW_LINES),
					`… ${lines.length - PREVIEW_LINES * 2} more lines …`,
					...numbered(lines.length - PREVIEW_LINES, lines.length),
				];
	const bytes = Buffer.byteLength(data);
	return [
		`Saved ${source} to ${path} (${bytes} bytes, ${lines.length} lines${contentType ? `, ${contentType}` : ''}).`,
		/html/i.test(contentType)
			? 'This is HTML source. If the content you need is rendered by JavaScript, open the page and call browser_save without url to save its rendered text.'
			: null,
		`Search or slice it with your shell (rg -n 'error|fail' ${path}; sed -n '100,160p' ${path}) instead of printing it whole.`,
		'',
		...preview,
	]
		.filter((line) => line !== null)
		.join('\n');
}

// Replace an oversized tool result with a pointer to the file holding it in full.
// Images are kept: they are sized independently of the page text.
export function capToolResult(
	result,
	toolName,
	{ maxChars = MAX_RESULT_TEXT_CHARS, now = new Date(), home = homedir() } = {},
) {
	if (!result || !Array.isArray(result.content)) return result;
	const texts = result.content.filter(
		(item) => item?.type === 'text' && typeof item.text === 'string',
	);
	const total = texts.reduce((sum, item) => sum + item.text.length, 0);
	if (total <= maxChars) return result;
	const text = texts.map((item) => item.text).join('\n');
	const source = `${toolName || 'tool'} result`;
	const path = savePathFor(
		'',
		`terminay://${source.replace(/\s+/g, '-')}`,
		now,
		home,
	);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
	const notice = `This ${source} was too large to return (about ${Math.round(total / 4000)}k tokens), so it was saved to a file instead. For long logs or pages, use browser_save rather than snapshots.`;
	const { structuredContent: _dropped, ...rest } = result;
	return {
		...rest,
		content: [
			{
				type: 'text',
				text: `${notice}\n\n${describeSavedFile(path, text, `the ${source}`, '')}`,
			},
			...result.content.filter((item) => item?.type !== 'text'),
		],
	};
}

export function runCappedServer(
	command,
	args,
	{
		stdin = process.stdin,
		stdout = process.stdout,
		maxChars = MAX_RESULT_TEXT_CHARS,
	} = {},
) {
	const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
	const toolNames = new Map();
	let forwarding = Promise.resolve();
	createInterface({ input: stdin, crlfDelay: Infinity })
		.on('line', (line) => {
			forwarding = forwarding.then(async () => {
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				if (message?.method === 'tools/call') {
					try {
						await checkWork();
					} catch {
						stdout.write(
							`${JSON.stringify({
								jsonrpc: '2.0',
								id: message.id,
								result: {
									isError: true,
									content: [
										{
											type: 'text',
											text: 'Execution does not own shared work.',
										},
									],
								},
							})}\n`,
						);
						return;
					}
					toolNames.set(message.id, message.params?.name);
				}
				child.stdin.write(`${line}\n`);
			});
		})
		.on('close', () => void forwarding.finally(() => child.stdin.end()));
	createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
		'line',
		(line) => {
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				stdout.write(`${line}\n`);
				return;
			}
			if (message && toolNames.has(message.id)) {
				const name = toolNames.get(message.id);
				toolNames.delete(message.id);
				try {
					if (message.result)
						message = {
							...message,
							result: capToolResult(message.result, name, { maxChars }),
						};
				} catch (error) {
					message = {
						...message,
						result: {
							content: [
								{
									type: 'text',
									text: `The ${name} result was too large to return and could not be saved: ${error instanceof Error ? error.message : String(error)}`,
								},
							],
							isError: true,
						},
					};
				}
			}
			stdout.write(`${JSON.stringify(message)}\n`);
		},
	);
	child.on('error', (error) => {
		process.stderr.write(
			`terminay-desktop-mcp: could not start ${command}: ${error.message}\n`,
		);
		process.exit(1);
	});
	// "close" waits for the child's stdout to finish; flush ours before exiting.
	child.on('close', (code, signal) =>
		stdout.write('', () => process.exit(code ?? (signal ? 1 : 0))),
	);
	return child;
}

async function browserSave(endpoint, args, fetchImpl) {
	if (args.url !== undefined && !/^https?:\/\//i.test(String(args.url)))
		return toolError('url must be an http(s) URL.');
	const cdp = await connectCdp(endpoint, fetchImpl);
	let saved;
	try {
		saved = args.url
			? await downloadWithBrowserCookies(cdp, String(args.url), fetchImpl)
			: await activePageText(cdp);
	} finally {
		cdp.close();
	}
	const path = savePathFor(args.path ? String(args.path) : '', saved.source);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, saved.text);
	return {
		content: [
			{
				type: 'text',
				text: describeSavedFile(
					path,
					saved.text,
					saved.source,
					saved.contentType,
				),
			},
		],
	};
}

function screenshotContent(shot, savedTo = null) {
	const cropped = shot.origin
		? [
				`${shot.window ? `Window ${shot.window.id} "${shot.window.title}"` : 'Region'} at ${shot.origin.x},${shot.origin.y} of the ${shot.screenWidth}x${shot.screenHeight} screen`,
				shot.scale > 1
					? `image ${shot.width}x${shot.height} is enlarged ${shot.scale}x, so screen x = ${shot.origin.x} + px/${shot.scale}, screen y = ${shot.origin.y} + py/${shot.scale}`
					: `image ${shot.width}x${shot.height}, so screen x = ${shot.origin.x} + px, screen y = ${shot.origin.y} + py`,
			]
		: [`Screen ${shot.width}x${shot.height}`];
	const details = [
		...cropped,
		shot.cursor ? `pointer at ${shot.cursor.x},${shot.cursor.y}` : null,
		shot.activeWindow ? `active window "${shot.activeWindow}"` : null,
	]
		.filter(Boolean)
		.join(', ');
	return [
		{
			type: 'text',
			text: `${details}.${savedTo ? ` Saved to ${savedTo}.` : ''}`,
		},
		{ type: 'image', data: shot.png, mimeType: 'image/png' },
	];
}

function screenshotRoute(args) {
	if (args.window !== undefined && args.region !== undefined)
		throw new Error('Pass either window or region, not both.');
	const query = new URLSearchParams();
	if (args.window !== undefined) query.set('window', String(args.window));
	if (args.region !== undefined) {
		for (const key of ['x', 'y', 'width', 'height'])
			query.set(key, String(args.region?.[key] ?? ''));
	}
	const search = query.toString();
	return search ? `screenshot?${search}` : 'screenshot';
}

async function savePng(path, base64) {
	const target = resolve(process.cwd(), path);
	try {
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(base64, 'base64'));
	} catch (error) {
		throw new Error(
			`Could not save the screenshot to ${target}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return target;
}

function windowLines(windows) {
	if (!windows.length) return 'No app windows are open.';
	return windows
		.map((window) =>
			[
				`${window.id}${window.focused ? ' (focused)' : ''}`,
				`"${window.title}"`,
				`at ${window.x},${window.y} size ${window.width}x${window.height}`,
				window.pid ? `pid ${window.pid}` : null,
			]
				.filter(Boolean)
				.join('  '),
		)
		.join('\n');
}

export async function callTool(endpoint, name, args = {}, fetchImpl = fetch) {
	if (!endpoint)
		return toolError(
			'The desktop endpoint is not configured for this session.',
		);
	try {
		if (name === 'desktop_screenshot') {
			const shot = await desktopRequest(
				endpoint,
				screenshotRoute(args),
				{},
				fetchImpl,
			);
			const savedTo =
				typeof args.savePath === 'string' && args.savePath.trim()
					? await savePng(args.savePath.trim(), shot.png)
					: null;
			return { content: screenshotContent(shot, savedTo) };
		}
		if (name === 'desktop_windows') {
			const action = args.action ?? 'list';
			const result =
				action === 'list'
					? await desktopRequest(endpoint, 'windows', {}, fetchImpl)
					: await desktopRequest(
							endpoint,
							'windows',
							{
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ ...args, action }),
							},
							fetchImpl,
						);
			const prefix =
				action === 'list' ? '' : `Done: ${action} ${args.windowId}.\n`;
			return {
				content: [
					{
						type: 'text',
						text: `${prefix}${windowLines(result.windows ?? [])}`,
					},
				],
			};
		}
		if (name === 'desktop_act') {
			const payload = {
				actions: args.actions,
				screenshot: args.screenshot !== false,
			};
			const result = await desktopRequest(
				endpoint,
				'act',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				},
				fetchImpl,
			);
			const summary = result.ok
				? `Completed ${result.completed} of ${result.total} actions.`
				: `Stopped after ${result.completed} of ${result.total} actions: ${result.error}. Check the screenshot before continuing.`;
			const content = [
				{ type: 'text', text: summary },
				...(result.screenshot ? screenshotContent(result.screenshot) : []),
			];
			return result.ok ? { content } : { content, isError: true };
		}
		if (name === 'browser_save')
			return await browserSave(endpoint, args, fetchImpl);
		return toolError(`Unknown tool: ${name}`);
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}
}

function toolError(message) {
	return { content: [{ type: 'text', text: message }], isError: true };
}

export async function handleMessage(endpoint, message, fetchImpl = fetch) {
	if (!message || typeof message !== 'object' || Array.isArray(message)) {
		return {
			jsonrpc: '2.0',
			id: null,
			error: { code: -32600, message: 'Invalid Request' },
		};
	}
	const { id, method, params } = message;
	// Notifications (no id) never get a response.
	if (id === undefined || id === null) return null;
	const reply = (result) => ({ jsonrpc: '2.0', id, result });
	switch (method) {
		case 'initialize': {
			const requested = params?.protocolVersion;
			return reply({
				protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
					? requested
					: SUPPORTED_PROTOCOL_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
			});
		}
		case 'ping':
			return reply({});
		case 'tools/list':
			return reply({ tools: TOOLS });
		case 'tools/call':
			await checkWork();
			return reply(
				await callTool(
					endpoint,
					params?.name,
					params?.arguments ?? {},
					fetchImpl,
				),
			);
		default:
			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32601, message: `Method not found: ${method}` },
			};
	}
}

function main() {
	const endpoint = parseEndpoint(process.argv.slice(2));
	const write = (payload) =>
		process.stdout.write(`${JSON.stringify(payload)}\n`);
	const pending = new Set();
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
	lines.on('line', (line) => {
		if (!line.trim()) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			write({
				jsonrpc: '2.0',
				id: null,
				error: { code: -32700, message: 'Parse error' },
			});
			return;
		}
		const work = handleMessage(endpoint, message)
			.then((response) => {
				if (response) write(response);
			})
			.catch((error) => {
				write({
					jsonrpc: '2.0',
					id: message?.id ?? null,
					error: {
						code: -32603,
						message: error instanceof Error ? error.message : String(error),
					},
				});
			})
			.finally(() => pending.delete(work));
		pending.add(work);
	});
	// Answer in-flight tool calls before exiting when the client closes stdin.
	lines.on(
		'close',
		() => void Promise.allSettled([...pending]).then(() => process.exit(0)),
	);
}

function isEntrypoint() {
	try {
		return (
			Boolean(process.argv[1]) &&
			realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
		);
	} catch {
		return false;
	}
}

if (isEntrypoint()) {
	const argv = process.argv.slice(2);
	const separator = argv.indexOf('--');
	if (argv[0] === '--cap-output' && separator > 0 && argv[separator + 1])
		runCappedServer(argv[separator + 1], argv.slice(separator + 2));
	else main();
}
