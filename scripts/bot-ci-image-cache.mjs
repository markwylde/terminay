import { createHash } from 'node:crypto';

/** CI build cache identity; production bots never consume this repository. */
export function botCiImageCache({ repository, platform, fingerprint, dockerfile }) {
  if (!repository) return null;
  if (!/^[a-z0-9][a-z0-9./:_-]+$/u.test(repository) || repository.split('/').at(-1).includes(':')) throw new Error('Invalid bot CI cache repository');
  if (!/^[a-f0-9]{64}$/u.test(fingerprint) || !dockerfile) throw new Error('Incomplete bot image cache inputs');
  const normalized = { 'linux/x86_64': 'linux/amd64', 'linux/amd64': 'linux/amd64', 'linux/aarch64': 'linux/arm64', 'linux/arm64': 'linux/arm64' }[platform];
  if (!normalized) throw new Error(`Unsupported bot CI image platform: ${platform}`);
  const key = createHash('sha256').update(JSON.stringify({ version: 1, platform: normalized, fingerprint, dockerfile })).digest('hex');
  return { reference: `${repository}:${key}`, platform: normalized, fingerprint };
}

export function restoreBotCiImageCache(cache, run, log = console.log) {
  if (!cache) return false;
  try {
    run(['pull', cache.reference]);
    const identity = run(['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}} {{index .Config.Labels "terminay.fingerprint"}}', cache.reference], { capture: true }).trim();
    if (identity !== `${cache.platform} ${cache.fingerprint}`) {
      log('Bot CI cache platform or context differs; rebuilding without that cache');
      return false;
    }
    log('Restored bot CI build cache; the production Dockerfile and all tests still run');
    return true;
  } catch {
    log('No reusable bot CI build cache; cold image setup counts toward readiness');
    return false;
  }
}

/** Call only after every real suite succeeds. Cache publication is best effort. */
export function publishBotCiImageCache(cache, image, run, log = console.log) {
  if (!cache) return false;
  try {
    run(['tag', image, cache.reference]);
    run(['push', cache.reference]);
    log('Published tested bot CI build cache');
    return true;
  } catch {
    log('Bot CI cache publication failed; the completed test result is unchanged');
    return false;
  }
}
