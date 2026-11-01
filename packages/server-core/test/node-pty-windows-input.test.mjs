import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runInThisContext } from 'node:vm';

// Exercise the installed WindowsTerminal's real write/defer methods on every
// platform. Only its native agent constructor is replaced: the tested sink is
// the byte stream that feeds ConPTY's input pipe, not ConPTY's console parser.
const require = createRequire(import.meta.url);
const entry = join(dirname(require.resolve('node-pty/package.json')), 'lib/windowsTerminal.js');
const localRequire = createRequire(entry);
const module = { exports: {} };
runInThisContext(`(function(require,module,exports){${readFileSync(entry, 'utf8')}\n})`, { filename: entry })(
  (name) => name === './windowsPtyAgent' ? { WindowsPtyAgent: class {} } : localRequire(name),
  module, module.exports,
);

for (const ready of [true, false]) {
  test(`Windows node-pty preserves high mouse bytes at its ConPTY pipe (ready=${ready})`, () => {
    const terminal = Object.create(module.exports.WindowsTerminal.prototype);
    terminal._isReady = ready;
    terminal._deferreds = [];
    const pipe = new PassThrough();
    const received = [];
    pipe.on('data', (bytes) => received.push(Buffer.from(bytes)));
    terminal._agent = { inSocket: pipe };
    const mouse = Buffer.from([27, 91, 77, 32, 128, 255]);
    const keyboard = Buffer.from('é 🐱\r', 'utf8');
    terminal.write(mouse);
    terminal.write(keyboard);
    if (!ready) {
      assert.equal(received.length, 0);
      for (const deferred of terminal._deferreds) deferred.run();
    }
    assert.deepEqual(Buffer.concat(received), Buffer.concat([mouse, keyboard]));
    pipe.destroy();
  });
}
