import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  CONTROL_SOCKET_ENV,
  CONTROL_TOKEN_ENV,
  getDefaultControlSocketPath,
} from '../control/protocol'
import type { ControlOp, ControlParamsByOp } from '../control/protocol'
import { type ControlClient, createControlClient } from './client'

type ToolResult = CallToolResult

const NOT_IN_TERMINAY_MESSAGE =
  'Terminay MCP is not running inside a Terminay terminal, so there are no terminals to control.'

const splitDirection = z.enum(['right', 'left', 'above', 'below'])

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../package.json') as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const candidates = (error as Error & { candidates?: string[] }).candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    return `Ambiguous terminal; did you mean: ${candidates.join(', ')}`
  }
  return error.message
}

export async function runMcpServer(): Promise<void> {
  // The socket path env is an override; otherwise derive it from OS conventions.
  // MCP clients rarely forward inherited env, so scope is resolved server-side
  // from this process's ancestry rather than from a forwarded token.
  const socketPath = process.env[CONTROL_SOCKET_ENV] || getDefaultControlSocketPath()
  const token = process.env[CONTROL_TOKEN_ENV] || undefined

  const server = new McpServer({ name: 'terminay', version: readVersion() })

  let client: ControlClient | null = null
  const getClient = (): ControlClient => {
    if (!client) {
      client = createControlClient({ socketPath, token })
    }
    return client
  }

  const callOp = async <Op extends ControlOp>(op: Op, params: ControlParamsByOp[Op]): Promise<ToolResult> => {
    try {
      const result = await getClient().request(op, params)
      const summary = `${op} ok`
      return textResult(`${summary}\n${JSON.stringify(result, null, 2)}`)
    } catch (error) {
      // The socket isn't there -> Terminay isn't running (or this process isn't
      // under a Terminay terminal). Reset the client so the next call retries.
      if ((error as Error & { code?: string })?.code === 'not_connected') {
        client = null
        return textResult(NOT_IN_TERMINAY_MESSAGE, true)
      }
      return textResult(describeError(error), true)
    }
  }

  server.registerTool(
    'list_terminals',
    {
      description:
        'List the terminals (tabs) in the current Terminay window. Each has a name, id, busy/attention state, cwd, and exit code.',
      inputSchema: {},
    },
    async () => callOp('list_terminals', {}),
  )

  server.registerTool(
    'read_terminal',
    {
      description: 'Read the recent output of a terminal by its name or id.',
      inputSchema: {
        terminal: z.string(),
        lines: z.number().optional(),
      },
    },
    async ({ terminal, lines }) => callOp('read_terminal', { terminal, lines }),
  )

  server.registerTool(
    'get_terminal_status',
    {
      description: 'Get whether a terminal is working/idle/exited, plus attention and last exit code.',
      inputSchema: {
        terminal: z.string(),
      },
    },
    async ({ terminal }) => callOp('get_terminal_status', { terminal }),
  )

  server.registerTool(
    'open_terminal',
    {
      description:
        'Open a new terminal tab in the current window. Optionally split relative to the calling terminal.',
      inputSchema: {
        name: z.string().optional(),
        cwd: z.string().optional(),
        split: splitDirection.optional(),
      },
    },
    async ({ name, cwd, split }) => callOp('open_terminal', { name, cwd, split }),
  )

  server.registerTool(
    'write_terminal',
    {
      description: 'Type text into a terminal. Set submit=true to press Enter after.',
      inputSchema: {
        terminal: z.string(),
        text: z.string(),
        submit: z.boolean().optional(),
      },
    },
    async ({ terminal, text, submit }) => callOp('write_terminal', { terminal, text, submit }),
  )

  server.registerTool(
    'run_command',
    {
      description: 'Run a command in a terminal (types it and presses Enter).',
      inputSchema: {
        terminal: z.string(),
        command: z.string(),
      },
    },
    async ({ terminal, command }) => callOp('run_command', { terminal, command }),
  )

  server.registerTool(
    'close_terminal',
    {
      description: 'Close a terminal tab by name or id.',
      inputSchema: {
        terminal: z.string(),
      },
    },
    async ({ terminal }) => callOp('close_terminal', { terminal }),
  )

  server.registerTool(
    'focus_terminal',
    {
      description: 'Bring a terminal tab to the foreground.',
      inputSchema: {
        terminal: z.string(),
      },
    },
    async ({ terminal }) => callOp('focus_terminal', { terminal }),
  )

  server.registerTool(
    'rename_terminal',
    {
      description: 'Rename a terminal tab.',
      inputSchema: {
        terminal: z.string(),
        name: z.string(),
      },
    },
    async ({ terminal, name }) => callOp('rename_terminal', { terminal, name }),
  )

  server.registerTool(
    'split_terminal',
    {
      description: 'Split a terminal, opening a new one beside it.',
      inputSchema: {
        terminal: z.string(),
        direction: splitDirection,
      },
    },
    async ({ terminal, direction }) => callOp('split_terminal', { terminal, direction }),
  )

  server.registerTool(
    'wait_for_idle',
    {
      description:
        'Block until a terminal has had no output for `seconds` seconds. Optional overall timeout (seconds).',
      inputSchema: {
        terminal: z.string(),
        seconds: z.number(),
        timeout: z.number().optional(),
      },
    },
    async ({ terminal, seconds, timeout }) => callOp('wait_for_idle', { terminal, seconds, timeout }),
  )

  server.registerTool(
    'wait_for_command',
    {
      description: 'Block until the next command in a terminal finishes, returning its exit code.',
      inputSchema: {
        terminal: z.string(),
        timeout: z.number().optional(),
      },
    },
    async ({ terminal, timeout }) => callOp('wait_for_command', { terminal, timeout }),
  )

  server.registerTool(
    'wait_for_attention',
    {
      description:
        'Block until a terminal rings a bell or raises a notification (e.g. asks for input).',
      inputSchema: {
        terminal: z.string(),
        timeout: z.number().optional(),
      },
    },
    async ({ terminal, timeout }) => callOp('wait_for_attention', { terminal, timeout }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
