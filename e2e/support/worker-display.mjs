import { spawn } from 'node:child_process';

/** Each worker owns its X selection/clipboard and native window focus. */
export async function createWorkerDisplay({ enabled = process.env.TERMINAY_E2E_WORKER_DISPLAY === '1', spawnServer = spawn, env = process.env, readyTimeoutMs = 10_000 } = {}) {
  if (!enabled) return { close: async () => {} };
  const previous = env.DISPLAY;
  const server = spawnServer('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  server.stderr?.on('data', (chunk) => { diagnostics = (diagnostics + String(chunk)).slice(-8000); });
  try {
    const display = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`worker Xvfb did not become ready: ${diagnostics}`)), readyTimeoutMs);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      server.once('error', fail);
      server.once('exit', (code) => fail(new Error(`worker Xvfb exited ${code}: ${diagnostics}`)));
      server.stdio[3].on('data', (chunk) => {
        output += String(chunk);
        if (!output.includes('\n')) return;
        clearTimeout(timer);
        const number = output.trim();
        if (!/^\d+$/u.test(number)) reject(new Error(`invalid worker Xvfb display: ${number}`));
        else resolve(`:${number}`);
      });
    });
    env.DISPLAY = display;
  } catch (error) {
    server.kill('SIGKILL');
    throw error;
  }
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      if (previous === undefined) delete env.DISPLAY;
      else env.DISPLAY = previous;
      if (server.exitCode !== null && server.exitCode !== undefined) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 2_000);
        server.once('exit', () => { clearTimeout(timer); resolve(); });
        server.kill('SIGTERM');
      });
    },
  };
}
