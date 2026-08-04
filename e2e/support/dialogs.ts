import type { Page } from '@playwright/test'

type DialogKind = 'alert' | 'confirm' | 'prompt'

export type DialogCall = {
  defaultValue?: string
  kind: DialogKind
  message: string
  response: boolean | string | null
}

type DialogState = {
  calls: DialogCall[]
  confirmDefault: boolean
  confirmQueue: boolean[]
  promptDefault: string | null
  promptQueue: Array<string | null>
}

type DialogHostWindow = Window & {
  __terminayE2E?: {
    dialogs?: DialogState
  }
}

function installDialogStubsInPage(): void {
  const hostWindow = window as DialogHostWindow
  const existingState = hostWindow.__terminayE2E?.dialogs

  if (existingState) {
    return
  }

  const dialogState: DialogState = {
    calls: [],
    confirmDefault: true,
    confirmQueue: [],
    promptDefault: null,
    promptQueue: [],
  }

  hostWindow.__terminayE2E = {
    ...hostWindow.__terminayE2E,
    dialogs: dialogState,
  }

  window.alert = (message?: string) => {
    dialogState.calls.push({
      kind: 'alert',
      message: String(message ?? ''),
      response: null,
    })
  }

  window.confirm = (message?: string) => {
    const response =
      dialogState.confirmQueue.length > 0 ? dialogState.confirmQueue.shift() ?? true : dialogState.confirmDefault

    dialogState.calls.push({
      kind: 'confirm',
      message: String(message ?? ''),
      response,
    })

    return response
  }

  window.prompt = (message?: string, defaultValue?: string) => {
    const response =
      dialogState.promptQueue.length > 0 ? dialogState.promptQueue.shift() ?? null : dialogState.promptDefault

    dialogState.calls.push({
      defaultValue,
      kind: 'prompt',
      message: String(message ?? ''),
      response,
    })

    return response
  }
}

async function updateDialogState(
  page: Page,
  update:
    | { kind: 'clear-calls' }
    | { kind: 'queue-confirm'; value: boolean }
    | { kind: 'queue-prompt'; value: string | null }
    | { kind: 'reset' }
    | { kind: 'set-confirm-default'; value: boolean }
    | { kind: 'set-prompt-default'; value: string | null },
): Promise<void> {
  await page.evaluate((nextUpdate) => {
    const state = (window as DialogHostWindow).__terminayE2E?.dialogs

    if (!state) {
      throw new Error('Dialog stubs are unavailable for this page')
    }

    switch (nextUpdate.kind) {
      case 'clear-calls':
        state.calls.length = 0
        break
      case 'queue-confirm':
        state.confirmQueue.push(nextUpdate.value)
        break
      case 'queue-prompt':
        state.promptQueue.push(nextUpdate.value)
        break
      case 'reset':
        state.calls.length = 0
        state.confirmDefault = true
        state.confirmQueue.length = 0
        state.promptDefault = null
        state.promptQueue.length = 0
        break
      case 'set-confirm-default':
        state.confirmDefault = nextUpdate.value
        break
      case 'set-prompt-default':
        state.promptDefault = nextUpdate.value
        break
    }
  }, update)
}

export async function ensureDialogStubs(page: Page): Promise<void> {
  await page.addInitScript(installDialogStubsInPage)
  await page.evaluate(installDialogStubsInPage)
}

export function createDialogController(page: Page) {
  return {
    async clearCalls(): Promise<void> {
      await updateDialogState(page, { kind: 'clear-calls' })
    },

    async getCalls(): Promise<DialogCall[]> {
      return page.evaluate(() => {
        const state = (window as DialogHostWindow).__terminayE2E?.dialogs

        if (!state) {
          throw new Error('Dialog stubs are unavailable for this page')
        }

        return state.calls
      })
    },

    async reset(): Promise<void> {
      await updateDialogState(page, { kind: 'reset' })
    },

    async setConfirmDefault(value: boolean): Promise<void> {
      await updateDialogState(page, { kind: 'set-confirm-default', value })
    },

    async queueConfirm(value: boolean): Promise<void> {
      await updateDialogState(page, { kind: 'queue-confirm', value })
    },

    async setPromptDefault(value: string | null): Promise<void> {
      await updateDialogState(page, { kind: 'set-prompt-default', value })
    },

    async queuePrompt(value: string | null): Promise<void> {
      await updateDialogState(page, { kind: 'queue-prompt', value })
    },
  }
}

export type DialogController = ReturnType<typeof createDialogController>
