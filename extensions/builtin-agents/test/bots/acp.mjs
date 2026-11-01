import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

/** Small test client. Deadlines bound requests; notifications drive all waits. */
export class Acp extends EventEmitter {
	constructor(executable, env) {
		super();
		this.sequence = 0;
		this.pending = new Map();
		this.updates = [];
		this.permissions = [];
		this.child = spawn(executable, [], {
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		this.child.stdin.on('error', () => {});
		this.child.stderr.resume(); // Adapter stderr may include credentials: never forward it.
		this.lines = createInterface({ input: this.child.stdout });
		this.lines.on('line', (line) => {
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.method === 'session/request_permission') {
				this.permissions.push(message.params);
				const option = message.params.options.find(
					(o) => o.kind === 'allow_once',
				);
				this.send({
					jsonrpc: '2.0',
					id: message.id,
					result: {
						outcome: option
							? { outcome: 'selected', optionId: option.optionId }
							: { outcome: 'cancelled' },
					},
				});
			} else if (message.method && message.id !== undefined) {
				this.send({
					jsonrpc: '2.0',
					id: message.id,
					error: { code: -32601, message: 'No client capabilities' },
				});
				this.emit('unsupported', message.method);
			} else if (message.method === 'session/update') {
				this.updates.push(message.params.update);
				this.emit('update');
			} else {
				const pending = this.pending.get(message.id);
				if (!pending) return;
				this.pending.delete(message.id);
				clearTimeout(pending.timer);
				if (message.error)
					pending.reject(
						new Error(`ACP ${pending.method} failed (${message.error.code})`),
					);
				else pending.resolve(message.result);
			}
		});
		this.child.on('error', () => this.ended());
		this.child.on('exit', () => this.ended());
	}
	ended() {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('ACP process ended'));
		}
		this.pending.clear();
		this.emit('update');
	}
	send(message) {
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}
	notify(method, params) {
		this.send({ jsonrpc: '2.0', method, params });
	}
	call(method, params) {
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`ACP ${method} deadline`));
			}, 60_000);
			this.pending.set(id, { resolve, reject, timer, method });
			this.send({ jsonrpc: '2.0', id, method, params });
		});
	}
	async waitFor(predicate) {
		if (predicate(this.updates)) return;
		await new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				this.off('update', check);
			};
			const check = () => {
				if (predicate(this.updates)) {
					cleanup();
					resolve();
				}
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error('ACP update deadline'));
			}, 60_000);
			this.on('update', check);
			check();
		});
	}
	async close() {
		if (this.child.exitCode !== null || this.child.signalCode !== null) return;
		await new Promise((resolve) => {
			const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
			this.child.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
			this.child.kill('SIGTERM');
		});
		this.lines.close();
	}
}
