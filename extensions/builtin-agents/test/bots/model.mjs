import { createServer } from 'node:http';

/** Both provider wire formats, loopback only. Never forwards a request. */
export async function fakeModel({ listen = true } = {}) {
	const state = { action: 'text', count: 0, requests: [] };
	const server = createServer(async (request, response) => {
		let body = '';
		for await (const chunk of request) body += chunk;
		let data;
		try {
			data = JSON.parse(body);
		} catch {
			response.writeHead(400).end();
			return;
		}
		state.requests.push({ path: request.url, model: data.model });
		const anthropic = request.url.split('?')[0].endsWith('/messages');
		const responses = request.url.split('?')[0].endsWith('/responses');
		if (!anthropic && !responses) {
			response.writeHead(404).end();
			return;
		}
		// Side requests (titles, prompt suggestions) must not use up the one tool
		// turn: only answer the conformance prompt itself with a tool call.
		const offersShell = (data.tools ?? []).some((t) =>
			['Bash', 'exec_command', 'shell', 'shell_command'].includes(t.name),
		);
		const lastUser = [...(data.messages ?? data.input ?? [])]
			.reverse()
			.find((m) => m?.role === 'user');
		const content = Array.isArray(lastUser?.content)
			? lastUser.content
			: [{ text: lastUser?.content }];
		const asksCheck = content.some(
			(part) =>
				typeof part?.text === 'string' &&
				part.text.includes('Perform the conformance check.'),
		);
		const tool =
			state.action !== 'text' &&
			offersShell &&
			asksCheck &&
			state.count++ === 0;
		const command =
			state.action === 'cancel'
				? // Claude Code refuses a bare long `sleep`.
					"node -e 'setTimeout(() => {}, 300000)'"
				: 'node -e \'require("fs").writeFileSync("/home/bot/tool-proof.json",JSON.stringify({user:require("os").userInfo().username,credentials:Object.keys(process.env).filter(k=>/^(CODEX_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)$/.test(k)&&process.env[k])}))\'';
		response.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
		});
		const event = (name, value) =>
			response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
		if (anthropic) {
			const id = `msg_${state.requests.length}`;
			event('message_start', {
				type: 'message_start',
				message: {
					id,
					type: 'message',
					role: 'assistant',
					model: data.model,
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 1, output_tokens: 0 },
				},
			});
			const selected = (data.tools ?? []).find((t) => t.name === 'Bash');
			if (tool && !selected) {
				response.destroy(new Error('missing Bash tool'));
				return;
			}
			const block = tool
				? { type: 'tool_use', id: `tool_${id}`, name: selected.name, input: {} }
				: { type: 'text', text: '' };
			event('content_block_start', {
				type: 'content_block_start',
				index: 0,
				content_block: block,
			});
			event('content_block_delta', {
				type: 'content_block_delta',
				index: 0,
				delta: tool
					? {
							type: 'input_json_delta',
							partial_json: JSON.stringify({
								command,
								description: 'Conformance shell check',
							}),
						}
					: { type: 'text_delta', text: 'offline-pong' },
			});
			event('content_block_stop', { type: 'content_block_stop', index: 0 });
			event('message_delta', {
				type: 'message_delta',
				delta: {
					stop_reason: tool ? 'tool_use' : 'end_turn',
					stop_sequence: null,
				},
				usage: { output_tokens: 1 },
			});
			event('message_stop', { type: 'message_stop' });
		} else {
			const id = `resp_${state.requests.length}`;
			let seq = 0;
			const emit = (name, value) =>
				event(name, { type: name, sequence_number: seq++, ...value });
			const base = {
				id,
				object: 'response',
				created_at: 1,
				model: data.model,
				status: 'in_progress',
				output: [],
			};
			emit('response.created', { response: base });
			const selected = (data.tools ?? []).find((t) =>
				['exec_command', 'shell', 'shell_command'].includes(t.name),
			);
			if (tool && !selected) {
				response.destroy(new Error('missing shell tool'));
				return;
			}
			const args =
				selected?.name === 'shell'
					? { command: ['bash', '-lc', command] }
					: selected?.name === 'shell_command'
						? { command }
						: { cmd: command, yield_time_ms: 1000 };
			const item = tool
				? {
						type: 'function_call',
						id: `fc_${id}`,
						call_id: `call_${id}`,
						name: selected.name,
						arguments: '',
						status: 'in_progress',
					}
				: {
						type: 'message',
						id: `msg_${id}`,
						role: 'assistant',
						content: [],
						status: 'in_progress',
					};
			emit('response.output_item.added', { output_index: 0, item });
			if (tool) {
				emit('response.function_call_arguments.delta', {
					item_id: item.id,
					output_index: 0,
					delta: JSON.stringify(args),
				});
				item.arguments = JSON.stringify(args);
				emit('response.function_call_arguments.done', {
					item_id: item.id,
					output_index: 0,
					arguments: item.arguments,
				});
			} else {
				const part = { type: 'output_text', text: '', annotations: [] };
				emit('response.content_part.added', {
					item_id: item.id,
					output_index: 0,
					content_index: 0,
					part,
				});
				emit('response.output_text.delta', {
					item_id: item.id,
					output_index: 0,
					content_index: 0,
					delta: 'offline-pong',
				});
				part.text = 'offline-pong';
				emit('response.output_text.done', {
					item_id: item.id,
					output_index: 0,
					content_index: 0,
					text: part.text,
				});
				emit('response.content_part.done', {
					item_id: item.id,
					output_index: 0,
					content_index: 0,
					part,
				});
				item.content = [part];
			}
			item.status = 'completed';
			emit('response.output_item.done', { output_index: 0, item });
			emit('response.completed', {
				response: {
					...base,
					status: 'completed',
					output: [item],
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				},
			});
		}
		response.end();
	});
	if (listen)
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
	return {
		url: listen ? `http://127.0.0.1:${server.address().port}` : undefined,
		handle: server.listeners('request')[0],
		state,
		next(action) {
			state.action = action;
			state.count = 0;
		},
		async close() {
			if (!server.listening) return;
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
