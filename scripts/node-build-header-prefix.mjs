import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** node-gyp may use local headers only for the exact currently running Node. */
export function verifiedNodeHeaderPrefix({ executable = process.execPath, version = process.versions.node } = {}) {
  try {
    const prefix = dirname(dirname(realpathSync(executable)));
    const header = readFileSync(join(prefix, 'include/node/node_version.h'), 'utf8');
    const parts = ['MAJOR', 'MINOR', 'PATCH'].map(part => {
      const value = new RegExp(`^\\s*#\\s*define\\s+NODE_${part}_VERSION\\s+(\\d+)\\b`, 'mu').exec(header)?.[1];
      return value;
    });
    return parts.every(part => part !== undefined) && parts.join('.') === version ? prefix : null;
  } catch { return null; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prefix = verifiedNodeHeaderPrefix();
  if (prefix) process.stdout.write(prefix);
}
