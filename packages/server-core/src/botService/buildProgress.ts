import { randomUUID } from 'node:crypto';
import type {
	BotBuildProgress,
	BotBuildStep,
	BotBuildStepState,
} from '@terminay/protocol';
import { parseBotBuildProgress } from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';

/** Engine events are facts. Unknown text stays output, never a guessed percent. */
export class BotBuildTracker {
	private value: BotBuildProgress | null = null;
	private buffer = '';
	private tail = '';
	private sequential: string | null = null;
	constructor(
		private readonly statePath?: string,
		private readonly now: () => number = Date.now,
	) {
		if (statePath) {
			const saved = loadCanonicalStateSync(statePath, 'bot-builds', {
				validate: (raw) => {
					const record = raw as {
						version?: unknown;
						progress?: unknown;
						output?: unknown;
					};
					if (
						record?.version !== 1 ||
						typeof record.output !== 'string' ||
						Buffer.byteLength(record.output) > 262144
					)
						throw new Error('invalid build record');
					return {
						progress: parseBotBuildProgress(record.progress),
						output: record.output,
					};
				},
			});
			this.value = saved?.progress ?? null;
			this.tail = saved?.output ?? '';
			if (this.value?.state === 'running') {
				this.value = {
					...this.value,
					state: 'interrupted',
					truncated: true,
					endedAt: this.now(),
					revision: this.value.revision + 1,
				};
				this.persist();
			}
		}
	}
	get retainedOutput(): string {
		return this.tail;
	}
	get revision(): number {
		return this.value?.revision ?? 0;
	}
	get snapshot(): BotBuildProgress | null {
		return structuredClone(this.value);
	}
	start(
		engineIdentity: string,
		fingerprint: string,
		previousImageAvailable: boolean,
	): void {
		this.buffer = '';
		this.tail = '';
		this.sequential = null;
		this.value = {
			id: randomUUID(),
			engineIdentity,
			fingerprint,
			revision: 0,
			startedAt: this.now(),
			endedAt: null,
			state: 'running',
			previousImageAvailable,
			steps: [],
			truncated: false,
		};
		this.step('prepare', 'Preparing image build', 'running');
	}
	private persist(): void {
		if (this.statePath)
			writeFileDurablySync(
				this.statePath,
				JSON.stringify({ version: 1, progress: this.value, output: this.tail }),
				{
					keepPrevious: true,
				},
			);
	}
	step(id: string, description: string, state: BotBuildStepState): void {
		const v = this.value;
		if (v?.state !== 'running') return;
		const steps = [...v.steps],
			index = steps.findIndex((s) => s.id === id),
			previous = steps[index];
		if (index < 0 && steps.length >= 128) {
			this.value = { ...v, truncated: true };
			return;
		}
		const end = ['completed', 'cached', 'failed'].includes(state);
		const next: BotBuildStep = {
			id: id.slice(0, 256),
			description: redactBuildOutput(description).slice(0, 1024),
			state,
			startedAt:
				previous?.startedAt ?? (state === 'pending' ? null : this.now()),
			endedAt: end ? this.now() : null,
			log: previous?.log ?? '',
			truncated: previous?.truncated ?? false,
		};
		if (index < 0) steps.push(next);
		else steps[index] = next;
		this.value = { ...v, steps, revision: v.revision + 1 };
		this.persist();
	}
	private log(id: string, text: string): void {
		const v = this.value;
		if (!v) return;
		const steps = v.steps.map((s) =>
			s.id !== id
				? s
				: {
						...s,
						log: (s.log + text).slice(-4096),
						truncated: s.truncated || s.log.length + text.length > 4096,
					},
		);
		this.value = { ...v, steps, revision: v.revision + 1 };
	}
	output(chunk: string): void {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: engine output includes ANSI escape sequences.
		const plain = chunk.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
		this.buffer += plain.replace(/\r/g, '\n');
		let index = this.buffer.indexOf('\n');
		while (index >= 0) {
			this.line(this.buffer.slice(0, index));
			this.buffer = this.buffer.slice(index + 1);
			index = this.buffer.indexOf('\n');
		}
		if (this.buffer.length > 65536) {
			this.line(this.buffer.slice(0, 65536));
			this.buffer = '';
			if (this.value) this.value = { ...this.value, truncated: true };
		}
	}
	private line(line: string): void {
		line = redactBuildOutput(line);
		const bytes = Buffer.from(`${this.tail}${line}\n`);
		let from = Math.max(0, bytes.length - 262144);
		while (from < bytes.length && (bytes[from]! & 0xc0) === 0x80) from++;
		this.tail = bytes.subarray(from).toString('utf8');
		if (!line.trim()) return;
		const application = line.match(
			/TERMINAY_BUILD_STEP ([a-z0-9-]+) (running|completed) (.{1,1024})$/,
		);
		if (application) {
			this.step(
				application[1]!,
				application[3]!,
				application[2] as BotBuildStepState,
			);
			return;
		}
		const kit = line.match(/^#(\d+)\s+(.*)$/);
		const classic = line.match(/^(?:Step|STEP)\s+(\d+)\/(\d+)\s*:\s*(.*)$/);
		if (kit) {
			const id = `vertex-${kit[1]}`,
				text = kit[2]!,
				old = this.value?.steps.find((s) => s.id === id);
			if (/^(DONE|CACHED|ERROR)/.test(text))
				this.step(
					id,
					old?.description ?? 'Building image',
					text.startsWith('ERROR')
						? 'failed'
						: text.startsWith('CACHED')
							? 'cached'
							: 'completed',
				);
			else if (text.startsWith('[') || !old) this.step(id, text, 'running');
			this.log(id, `${line}\n`);
		} else if (classic) {
			if (this.sequential) {
				const s = this.value?.steps.find((s) => s.id === this.sequential);
				if (s?.state === 'running') this.step(s.id, s.description, 'completed');
			}
			this.sequential = `step-${classic[1]}`;
			this.step(this.sequential, describeBuildStep(classic[3]!), 'running');
			this.log(this.sequential, `${line}\n`);
		} else {
			const id =
				this.sequential ??
				this.value?.steps.filter((s) => s.state === 'running').at(-1)?.id ??
				'output';
			if (!this.value?.steps.some((s) => s.id === id))
				this.step(id, 'Building image', 'running');
			if (/Using cache|---> Using cache/i.test(line)) {
				const step = this.value?.steps.find((s) => s.id === id);
				if (step) this.step(id, step.description, 'cached');
			}
			this.log(id, `${line}\n`);
		}
	}
	event(raw: Record<string, unknown>): void {
		for (const rawVertex of Array.isArray(raw.vertexes) ? raw.vertexes : []) {
			if (!rawVertex || typeof rawVertex !== 'object') continue;
			const v = rawVertex as Record<string, unknown>;
			if (typeof v.digest !== 'string') continue;
			this.step(
				v.digest,
				String(v.name ?? 'Building image'),
				v.error
					? 'failed'
					: v.cached
						? 'cached'
						: v.completed
							? 'completed'
							: 'running',
			);
		}
	}
	finish(success: boolean): void {
		if (this.buffer) {
			this.line(this.buffer);
			this.buffer = '';
		}
		if (!this.value) return;
		const endedAt = this.now();
		let failed = false;
		const steps = this.value.steps.map((s) => {
			if (s.state !== 'running') return s;
			if (success) return { ...s, state: 'completed' as const, endedAt };
			failed = true;
			return { ...s, state: 'failed' as const, endedAt };
		});
		if (!success && !failed && !steps.some((s) => s.state === 'failed'))
			steps.push({
				id: 'failure',
				description: 'Image build failed',
				state: 'failed',
				startedAt: endedAt,
				endedAt,
				log: 'See build output for details.',
				truncated: false,
			});
		this.value = {
			...this.value,
			state: success ? 'completed' : 'failed',
			endedAt,
			steps: steps.slice(0, 128),
			revision: this.value.revision + 1,
		};
		this.persist();
	}
}
export function describeBuildStep(command: string): string {
	if (command.includes('terminay-artcraft-install'))
		return 'Installing creative applications';
	if (command.includes('chrome-devtools-mcp'))
		return 'Installing browser automation tools';
	if (command.includes('npm install'))
		return 'Installing pinned native agent CLIs';
	if (command.includes('apt-get install'))
		return 'Installing desktop and developer tools';
	if (command.startsWith('FROM')) return 'Preparing the public base image';
	if (command.startsWith('COPY')) return 'Adding runtime files';
	if (command.includes('useradd')) return 'Preparing the bot account and home';
	if (command.startsWith('RUN')) return 'Running an image setup command';
	if (command.startsWith('ENV')) return 'Configuring the runtime environment';
	if (command.startsWith('WORKDIR')) return 'Preparing the working directory';
	if (command.startsWith('LABEL')) return 'Recording image metadata';
	if (command.startsWith('ENTRYPOINT') || command.startsWith('CMD'))
		return 'Configuring container startup';
	return command.slice(0, 1024);
}

/** Build inputs are public; also scrub accidental credential-shaped diagnostics. */
function redactBuildOutput(value: string): string {
	return value
		.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
		.replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
		.replace(
			/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s]+)/gi,
			'$1[redacted]',
		)
		.replace(
			/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/g,
			'[redacted]',
		);
}
