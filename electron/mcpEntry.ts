import { runMcpServer } from './mcp/index'

runMcpServer().catch((error) => {
  process.stderr.write(
    `terminay mcp failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
