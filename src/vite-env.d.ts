/// <reference types="vite/client" />

import type { TermideApi } from './types/termide'

declare global {
  interface Window {
    termide: TermideApi
  }
}

export {}
