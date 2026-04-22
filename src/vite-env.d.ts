/// <reference types="vite/client" />

import type { TermideApi, TermideTestApi } from './types/termide'

declare global {
  interface Window {
    termide: TermideApi
    termideTest?: TermideTestApi
  }
}

export {}
