import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const DEFAULT_CONFIG_MODE = 0o600

/**
 * Atomically replace a provider config from a temporary file in the same
 * directory. Existing permissions are copied to the replacement.
 */
export async function atomicWriteConfig(path: string, content: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })

  let mode = DEFAULT_CONFIG_MODE
  try {
    mode = (await stat(path)).mode & 0o7777
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw cause
    }
  }

  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  try {
    handle = await open(temporaryPath, 'wx', mode)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined

    // An explicit chmod avoids the process umask changing an existing file's
    // permissions when its replacement is created.
    await chmod(temporaryPath, mode)
    await rename(temporaryPath, path)
  } catch (cause) {
    await handle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw cause
  }
}
