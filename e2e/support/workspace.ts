import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type WorkspaceSeed = {
  directories?: string[]
  files?: Record<string, string | Uint8Array>
}

export type WorkspaceOptions = {
  name?: string
  seed?: WorkspaceSeed
}

export type FixtureWorkspace = {
  path: (...segments: string[]) => string
  readText: (relativePath: string) => Promise<string>
  rootDir: string
  writeBinary: (relativePath: string, contents: Uint8Array) => Promise<string>
  writeText: (relativePath: string, contents: string) => Promise<string>
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function seedWorkspace(rootDir: string, seed?: WorkspaceSeed): Promise<void> {
  for (const directory of seed?.directories ?? []) {
    await mkdir(path.join(rootDir, directory), { recursive: true })
  }

  for (const [relativePath, contents] of Object.entries(seed?.files ?? {})) {
    const nextPath = path.join(rootDir, relativePath)
    await ensureParentDirectory(nextPath)
    await writeFile(nextPath, contents)
  }
}

export async function createFixtureWorkspace(
  tempDir: string,
  options?: WorkspaceOptions,
): Promise<FixtureWorkspace> {
  await mkdir(tempDir, { recursive: true })
  const prefix = `${options?.name ?? 'workspace'}-`
  const rootDir = await mkdtemp(path.join(tempDir, prefix))

  await seedWorkspace(rootDir, options?.seed)

  return {
    rootDir,

    path: (...segments: string[]) => path.join(rootDir, ...segments),

    async readText(relativePath: string): Promise<string> {
      return readFile(path.join(rootDir, relativePath), 'utf8')
    },

    async writeBinary(relativePath: string, contents: Uint8Array): Promise<string> {
      const nextPath = path.join(rootDir, relativePath)
      await ensureParentDirectory(nextPath)
      await writeFile(nextPath, contents)
      return nextPath
    },

    async writeText(relativePath: string, contents: string): Promise<string> {
      const nextPath = path.join(rootDir, relativePath)
      await ensureParentDirectory(nextPath)
      await writeFile(nextPath, contents, 'utf8')
      return nextPath
    },
  }
}
